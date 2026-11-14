import { randomUUID } from "node:crypto";
import type { BatchStore } from "./batches";

function itemLines(batch: any, item: any) {
  return batch.quote.lines.filter((line: any) => line.itemId ? line.itemId === item.id : line.recipeId === item.recipe_id);
}

// A click starts only this article. Expensive quotes need a second, explicit
// confirmation; the server computes the cap rather than trusting browser totals.
export function generateLibraryItem(b: BatchStore, itemId: string, quoteVersion: string, confirmedHighCost = false) {
  return b.store.db.transaction(() => {
    const item = b.item(itemId), batch = b.detail(item.batch_id);
    if (batch.approved_at) throw new Error('This article has already started. Open it to view progress.');
    if (quoteVersion !== batch.quote.createdAt || item.state !== 'queued') throw new Error('The estimate changed. Refresh this article before generating.');
    const lines = itemLines(batch, item);
    if (!lines.length) throw new Error('Review the photos and prepare the estimate first.');
    const estimated = lines.reduce((sum: number, line: any) => sum + line.estimated, 0);
    const limit = Math.ceil(Math.max(estimated, lines.reduce((sum: number, line: any) => sum + line.reservation, 0)) * 100) / 100;
    if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) throw new Error('This estimate is unavailable. Refresh it before generating.');
    if (Math.max(estimated, limit) >= 2.5 && confirmedHighCost !== true) return { confirmationRequired: true as const, estimated, limit, quoteVersion };
    return { ...approveLibraryItem(b, itemId, limit, quoteVersion), confirmationRequired: false as const };
  }).immediate();
}
export function archiveLibraryItem(b: BatchStore, id: string, archived: unknown) {
  if (typeof archived !== 'boolean') throw new Error('Choose Archive or Restore.');
  return b.store.db.transaction(() => {
    b.item(id);
    b.store.db.prepare("UPDATE content_items SET archived_at=? WHERE id=?").run(archived ? new Date().toISOString() : null, id);
    return { archived };
  }).immediate();
}

export function articleLibrary(b: BatchStore, page = 0, search = "", archived = false) {
  page = Number.isInteger(page) && page >= 0 ? Math.min(page, 100000) : 0;
  const query = `%${search.slice(0, 150)}%`;
  const from = `FROM content_items i JOIN content_batches b ON b.id=i.batch_id
    LEFT JOIN recipe_records r ON r.id=i.recipe_id LEFT JOIN recipe_imports m ON m.id=i.import_id
    WHERE i.state<>'deleted' AND b.status<>'deleted' AND i.archived_at IS ${archived ? 'NOT NULL' : 'NULL'} AND COALESCE(json_extract(i.source_json,'$.title'),r.title,m.title,'Recipe') LIKE ?`;
  const total = (b.store.db.prepare(`SELECT count(*) n ${from}`).get(query) as any).n;
  const records = b.store.db.prepare(`SELECT i.id,i.batch_id ${from} ORDER BY b.created_at DESC,i.rowid DESC LIMIT 20 OFFSET ?`).all(query, page * 20) as any[];
  const batches = new Map<string, any>();
  const rows = records.map(record => {
    if (!batches.has(record.batch_id)) batches.set(record.batch_id, b.detail(record.batch_id));
    const batch = batches.get(record.batch_id), item = batch.items.find((i: any) => i.id === record.id);
    const calls = batch.calls.filter((c: any) => item.stages.some((s: any) => s.id === c.stage_id));
    const lines = itemLines(batch, item);
    const estimated = lines.reduce((n: number, l: any) => n + l.estimated, 0);
    const suggestedLimit = Math.ceil(lines.reduce((n: number, l: any) => n + l.reservation, 0) * 100) / 100;
    const publications = (b.store.db.prepare("SELECT site_url,state,result_json,updated_at FROM wordpress_exports WHERE item_id=? ORDER BY site_url").all(item.id) as any[]).map(saved => {
      let result: any = {}; try { result = JSON.parse(saved.result_json || '{}'); } catch { /* Unknown saved result stays unconfirmed. */ }
      const labels: Record<string, string> = { draft: 'Draft', publish: 'Published', pending: 'Pending review', private: 'Private', future: 'Scheduled' };
      let postUrl: string | null = null;
      if (saved.state === 'ready' && result.status === 'publish') {
        try {
          const url = new URL(result.postUrl), site = new URL(saved.site_url);
          if (['http:', 'https:'].includes(url.protocol) && url.origin === site.origin && !url.username && !url.password) postUrl = url.href;
        } catch { /* Older exports may have no confirmed public URL. */ }
      }
      return { site: new URL(saved.site_url).hostname, postUrl, status: saved.state === 'ready' ? labels[result.status] || 'Unconfirmed' : saved.state === 'sending' ? 'Sending' : 'Unconfirmed', scheduledAt: result.status === 'future' ? result.scheduledAt || null : null, checkedAt: saved.updated_at };
    });
    return { id: item.id, batchId: batch.id, title: item.source?.title || item.title || "Recipe", state: item.state,
      archived: !!item.archived_at, deletion: item.deletion, publications,
      createdAt: batch.created_at, error: item.error, approved: !!batch.approved_at, sharedBudget: !!batch.approved_at && batch.items.length > 1,
      estimated, suggestedLimit, limit: batch.limit_usd, quoteVersion: batch.quote.createdAt,
      canApprove: !batch.approved_at && lines.length > 0 && item.state === 'queued',
      actual: calls.reduce((n: number, c: any) => n + (c.actual_usd || 0), 0),
      held: calls.reduce((n: number, c: any) => n + (c.actual_usd === null && ['reserved','dispatched','uncertain','usage_pending'].includes(c.state) ? c.reserved_usd : 0), 0),
      files: item.files.filter((f: any) => f.media_type.startsWith('image/') || f.name === 'article.html'),
      photos: item.photos.map((p: any) => ({ referenceId: p.reference_id, position: p.position, state: p.state })),
      currentStage: item.stages.find((s: any) => s.state === 'running')?.kind || null,
      reviewKind: item.review_kind };
  });
  return { rows, total, page, pageSize: 20 };
}

// Isolate a not-yet-approved recipe before spending, so one row's approval can
// never start its neighbours. Existing approved batches retain their ledger.
export function approveLibraryItem(b: BatchStore, itemId: string, limit: number, quoteVersion: string) {
  return b.store.db.transaction(() => {
    const item = b.item(itemId), batch = b.detail(item.batch_id);
    if (batch.approved_at) throw new Error("This recipe already has an approved budget. Open its details to continue.");
    if (quoteVersion !== batch.quote.createdAt || item.state !== 'queued') throw new Error("The estimate changed or is not ready. Refresh this recipe before approving.");
    if (b.store.db.prepare("SELECT 1 FROM api_calls WHERE batch_id=?").get(batch.id)) throw new Error("This batch already has usage. Review its saved budget.");
    if (batch.items.length === 1) { b.approve(batch.id, limit, quoteVersion); return { batchId: batch.id }; }
    const lines = itemLines(batch, item);
    if (!lines.length) throw new Error("Prepare this recipe's estimate first.");
    const quoteFor = (lines: any[]) => ({ ...batch.quote, lines, pending: 0, estimated: lines.reduce((n, l) => n + l.estimated, 0), recommendedLimit: Math.ceil(lines.reduce((n, l) => n + l.reservation, 0) * 100) / 100 });
    const id = randomUUID();
    b.store.db.prepare("INSERT INTO content_batches(id,created_at,status,settings_json,quote_json) VALUES(?,?,'awaiting_cost_approval',?,?)").run(id, new Date().toISOString(), JSON.stringify(batch.settings), JSON.stringify(quoteFor(lines)));
    b.store.db.prepare("UPDATE content_items SET batch_id=? WHERE id=?").run(id, itemId);
    const remaining = batch.quote.lines.filter((line: any) => !lines.includes(line));
    b.store.db.prepare("UPDATE content_batches SET quote_json=? WHERE id=?").run(JSON.stringify({ ...quoteFor(remaining), pending: batch.quote.pending || 0 }), batch.id);
    b.approve(id, limit, quoteVersion);
    return { batchId: id };
  }).immediate();
}
