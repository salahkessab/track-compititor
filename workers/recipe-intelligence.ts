import { randomUUID } from "node:crypto";
import { IntelligenceStore } from "../lib/recipe-intelligence/database";
import { DiscoveryEngine } from "../lib/recipe-intelligence/engine";
import { PublicDiscoveryFetcher, pause } from "../lib/recipe-intelligence/fetch";
import { localRoot } from "../lib/recipe-intelligence/paths";
import { ReportStore, ReportEngine } from "../lib/recipe-intelligence/reports";
import { BatchStore, BatchEngine } from "../lib/recipe-intelligence/batches";
import { OpenAIContentProvider } from "../lib/recipe-intelligence/provider";
import { loadEnvConfig } from "@next/env";
import { ImportStore } from "../lib/recipe-intelligence/imports";
import { objectStorage } from "../lib/recipe-intelligence/r2";
import { ServerBackup } from "../lib/recipe-intelligence/serverBackup";
import { deploymentPause, acknowledgeDeployment } from "../lib/recipe-intelligence/deployment";

async function main() {
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const store = await IntelligenceStore.open(localRoot());
  const owner = randomUUID(); let stopping = false;
  const active = new Map<string, { runId: string; controller: AbortController; promise: Promise<void> }>();
  let reportTask: { job: any; controller: AbortController; promise: Promise<void> } | null = null;
  let contentTask: { controller: AbortController; promise: Promise<void> } | null = null;
  let importTask: { controller: AbortController; promise: Promise<void> } | null = null;
  let storageTask: Promise<void> | null = null;
  let backupTask: Promise<void> | null = null;
  const stop = () => { stopping = true; for (const task of active.values()) task.controller.abort(); reportTask?.controller.abort(); contentTask?.controller.abort(); importTask?.controller.abort(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  process.on("message", message => { if (message === "stop") stop(); });
  process.on("disconnect", stop);
  try {
    while (!stopping && !store.acquireLease(owner)) await pause(1000);
    if (stopping) return;
    await store.backup();
    process.send?.({ type: "ready" });
    const fetcher = new PublicDiscoveryFetcher();
    const engine = new DiscoveryEngine(store, fetcher, owner);
    const reports = new ReportStore(store); const reportEngine = new ReportEngine(reports, fetcher, owner);
    const batches = new BatchStore(store); const batchEngine = new BatchEngine(batches, fetcher, new OpenAIContentProvider(), owner);
    const imports = new ImportStore(store); imports.recover(); reports.recover(); batches.recover();
    const storage = objectStorage(store);
    const backup = new ServerBackup(store);
    let heartbeat = 0;
    let refreshed = 0;
    while (!stopping) {
      if (Date.now() - heartbeat > 10_000) {
        if (!store.heartbeat(owner)) throw new Error("Worker lease was lost.");
        heartbeat = Date.now();
      }
      if (process.env.RECIPE_INTELLIGENCE_WORKER_PAUSED === "1") { await pause(1000); continue; }
      const deployment = deploymentPause(store.root);
      if (deployment) {
        if (!active.size && !reportTask && !contentTask && !importTask && !storageTask && !backupTask) acknowledgeDeployment(store.root, deployment.revision);
        await pause(1000); continue;
      }
      for (const [siteId, task] of active) {
        const run = store.db.prepare("SELECT status FROM scan_runs WHERE id=?").get(task.runId) as { status: string };
        if (store.getSite(siteId).status !== "active" || !["running", "queued"].includes(run.status)) task.controller.abort();
      }
      if (reportTask && (reports.get(reportTask.job.report_id).status !== "running" || store.getSite(reportTask.job.site_id).status !== "active")) reportTask.controller.abort();
      while (active.size < 3) {
        const item = store.claim(owner, [...active.keys()]);
        if (!item) break;
        const controller = new AbortController();
        const promise = engine.process(item, controller.signal).finally(() => active.delete(item.site_id));
        active.set(item.site_id, { runId: item.run_id, controller, promise });
      }
      store.finalizeRuns();
      if (Date.now() - refreshed > 3000) { reports.refresh(); batches.refresh(); refreshed = Date.now(); }
      if (!reportTask) {
        const job = reports.claim(owner);
        if (job) { const controller = new AbortController(); const promise = reportEngine.process(job, controller.signal).finally(() => { reportTask = null; }); reportTask = { job, controller, promise }; }
      }
      if (!contentTask) {
        const stage = batches.claim(owner);
        if (stage) { const controller = new AbortController(); const promise = (async () => {
          try { await storage.ensureStage(stage.item_id); }
          catch { store.db.prepare("UPDATE content_stages SET state='failed',error='A saved file is missing and its cloud copy could not be restored. Retry this stage when storage is available.',owner=NULL WHERE id=?").run(stage.id); return; }
          await batchEngine.process(stage, controller.signal);
        })().finally(() => { contentTask = null; }); contentTask = { controller, promise }; }
      }
      if (!importTask) { const job = imports.claim(owner); if (job) { const controller = new AbortController(); const promise = imports.process(job.id, fetcher, controller.signal).finally(() => { importTask = null; }); importTask = { controller, promise }; } }
      if (!storageTask) storageTask = storage.tick().finally(() => { storageTask = null; });
      if (!backupTask) backupTask = backup.tick().finally(() => { backupTask = null; });
      await Promise.race([pause(active.size || reportTask || contentTask ? 250 : 1000), ...[...active.values()].map(task => task.promise)]);
    }
  } finally {
    stop(); await Promise.allSettled([...active.values()].map(task => task.promise).concat(reportTask ? [reportTask.promise] : [], contentTask ? [contentTask.promise] : [], importTask ? [importTask.promise] : [], storageTask ? [storageTask] : [], backupTask ? [backupTask] : []));
    store.releaseLease(owner); store.close();
  }
}
main().catch(error => { console.error("Recipe Intelligence worker:", error instanceof Error ? error.message : "Worker failed."); process.exitCode = 1; })
  .finally(() => { if (process.connected) process.disconnect(); });
