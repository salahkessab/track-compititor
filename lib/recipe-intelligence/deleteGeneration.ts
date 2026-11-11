import fs from "node:fs";
import path from "node:path";
import type { IntelligenceStore } from "./database";
import { assertInside, storagePath } from "./paths";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const removing = new Set(["deleting", "delete_failed"]);
function itemRow(store: IntelligenceStore, id: string): any {
  if (!uuid.test(id)) throw new Error("Invalid recipe ID.");
  const item = store.db.prepare("SELECT i.*,b.status batch_status FROM content_items i JOIN content_batches b ON b.id=i.batch_id WHERE i.id=?").get(id);
  if (!item) throw new Error("Recipe item not found.");
  return item;
}
export function deletionAvailability(store: IntelligenceStore, item: any) {
  const busy = store.db.prepare("SELECT 1 FROM content_stages WHERE item_id=? AND state='running'").get(item.id)
    || store.db.prepare("SELECT 1 FROM api_calls WHERE stage_id IN (SELECT id FROM content_stages WHERE item_id=?) AND state IN ('reserved','dispatched')").get(item.id)
    || store.db.prepare("SELECT 1 FROM wordpress_exports WHERE item_id=? AND state='sending'").get(item.id);
  if (busy || item.state === "running") return { allowed: false, reason: "Wait for this recipe's current request to finish before deleting it." };
  if (!["completed", "failed", "partial", "deleted"].includes(item.state) && !removing.has(item.state) && item.batch_status !== "cancelled") return { allowed: false, reason: "Finish generation or cancel pending work before deleting this recipe." };
  return { allowed: true, reason: "" };
}

// Only canonical, generation-owned paths are eligible. Never follow a junction,
// symlink, or a path supplied by the browser or a saved artifact record.
function checkedPath(root: string, relative: string) {
  const target = storagePath(root, relative);
  if (path.resolve(target) === path.resolve(root)) throw new Error("Cannot delete the storage root.");
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error("A linked folder or file prevents safe deletion. Move the link out of this recipe's folder first.");
      assertInside(root, fs.realpathSync(cursor));
    } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  }
  return target;
}
function plan(store: IntelligenceStore, id: string) {
  const item = itemRow(store, id), availability = deletionAvailability(store, item);
  if (!availability.allowed) throw new Error(availability.reason);
  if (item.state === "deleted") throw new Error("This recipe has already been deleted.");
  const roots = [path.join("articles", id)];
  const exports = store.db.prepare("SELECT export_id,receipt_path FROM wordpress_exports WHERE item_id=? AND receipt_path IS NOT NULL").all(id) as { export_id: string; receipt_path: string }[];
  for (const row of exports) {
    if (!/^exports\/wordpress-receipts\/[a-f0-9]{32}\/post-[a-f0-9]{64}-[a-f0-9-]{36}\.json$/.test(row.receipt_path)) throw new Error("Invalid WordPress receipt path.");
    if (!/^[a-f0-9]{64}$/.test(row.export_id)) throw new Error("Invalid WordPress export ID.");
    const receiptDirectory = path.dirname(row.receipt_path);
    const receiptFolder = checkedPath(store.root, receiptDirectory);
    if (fs.existsSync(receiptFolder)) for (const name of fs.readdirSync(receiptFolder)) {
      if (name.startsWith(`post-${row.export_id}-`) && /^[a-z0-9.-]+\.json(?:\.[a-f0-9-]+\.tmp)?$/.test(name)) roots.push(path.join(receiptDirectory, name));
    }
  }
  const addMatching = (directory: string, matches: (name: string) => boolean) => {
    const target = checkedPath(store.root, directory);
    if (fs.existsSync(target)) for (const name of fs.readdirSync(target)) if (matches(name)) roots.push(path.join(directory, name));
  };
  addMatching("research/requests", name => name.startsWith(id + "-") && /\.json(?:\.[a-f0-9-]+\.tmp)?$/i.test(name));
  const calls = store.db.prepare("SELECT id FROM api_calls WHERE stage_id IN (SELECT id FROM content_stages WHERE item_id=?)").all(id) as { id: string }[];
  const receiptNames = new Set(calls.map(call => { if (!uuid.test(call.id)) throw new Error("Invalid saved request ID."); return call.id + ".json"; }));
  addMatching("research/api-receipts", name => receiptNames.has(name) || [...receiptNames].some(base => name.startsWith(base + ".") && name.endsWith(".tmp")));
  let removeImport = false;
  if (item.import_id) {
    if (!uuid.test(item.import_id)) throw new Error("Invalid saved import ID.");
    const shared = store.db.prepare("SELECT 1 FROM content_items WHERE import_id=? AND id<>? AND state<>'deleted'").get(item.import_id, id)
      || store.db.prepare("SELECT 1 FROM content_photos p JOIN reference_photos r ON r.id=p.reference_id WHERE r.import_id=? AND p.item_id<>?").get(item.import_id, id);
    removeImport = !shared;
    if (removeImport) {
      const imported = store.db.prepare("SELECT status FROM recipe_imports WHERE id=?").get(item.import_id) as any;
      if (["queued", "running", "capturing"].includes(imported?.status)) throw new Error("The source is still importing. Wait for it to finish before deleting.");
      roots.push(path.join("research", "references", item.import_id));
      addMatching("research/browser", name => name === item.import_id + ".json" || name.startsWith(item.import_id + ".json.") && name.endsWith(".tmp"));
    }
  }
  const files: { relative: string; size: number }[] = [], directories: string[] = [];
  const visit = (relative: string) => {
    const target = checkedPath(store.root, relative);
    let info; try { info = fs.lstatSync(target); } catch (error: any) { if (error.code === "ENOENT") return; throw error; }
    if (info.isDirectory()) {
      for (const name of fs.readdirSync(target)) visit(path.join(relative, name));
      directories.push(relative);
    } else if (info.isFile()) files.push({ relative, size: info.size });
    else throw new Error("An unsupported file prevents safe deletion.");
  };
  for (const relative of roots) visit(relative);
  const source = item.source_json ? JSON.parse(item.source_json) : null;
  return { item, files, directories, removeImport, summary: { id, title: source?.title || "this recipe", bytes: files.reduce((sum, file) => sum + file.size, 0), fileCount: files.length, sharedSource: !!item.import_id && !removeImport } };
}
export function previewGenerationDeletion(store: IntelligenceStore, id: string) { return plan(store, id).summary; }

export function deleteGeneration(store: IntelligenceStore, id: string, confirmed: unknown) {
  if (confirmed !== true) throw new Error("Confirm permanent deletion before removing this recipe.");
  // The write lock prevents worker claims and shared-import changes throughout
  // planning/removal. Failed removals remain visible and can be retried safely.
  const result = store.db.transaction(() => {
    const current = itemRow(store, id);
    if (current.state === "deleted") return { deleted: true, bytesFreed: 0, batchId: current.batch_id, batchEmpty: !store.db.prepare("SELECT 1 FROM content_items WHERE batch_id=? AND state<>'deleted'").get(current.batch_id) };
    const deletion = plan(store, id);
    store.db.prepare("UPDATE content_items SET state='deleting',error=NULL WHERE id=?").run(id);
    let bytesFreed = 0;
    try {
      for (const file of deletion.files) {
        const target = checkedPath(store.root, file.relative);
        try { fs.unlinkSync(target); bytesFreed += file.size; } catch (error: any) { if (error.code !== "ENOENT") throw error; }
      }
      for (const directory of deletion.directories) {
        const target = checkedPath(store.root, directory);
        try { fs.rmdirSync(target); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
      }
      store.db.prepare("DELETE FROM artifacts WHERE item_id=?").run(id);
      store.db.prepare("DELETE FROM wordpress_exports WHERE item_id=?").run(id);
      store.db.prepare("DELETE FROM content_photos WHERE item_id=?").run(id);
      // Keep tiny billing records, including unknown charges, so deleting an
      // output can never refund or increase another item's approved budget.
      store.db.prepare("UPDATE api_calls SET response_path=NULL WHERE stage_id IN (SELECT id FROM content_stages WHERE item_id=?)").run(id);
      store.db.prepare("UPDATE content_stages SET state='deleted',request_path=NULL,result_json=NULL,error=NULL,owner=NULL WHERE item_id=?").run(id);
      store.db.prepare("UPDATE content_items SET state='deleted',source_json=NULL,research_json='[]',article_json=NULL,config_json=NULL,warnings_json='[]',selection_reason=NULL,review_kind=NULL,error=NULL WHERE id=?").run(id);
      if (deletion.removeImport) {
        store.db.prepare("DELETE FROM reference_photos WHERE import_id=?").run(current.import_id);
        store.db.prepare("UPDATE recipe_imports SET status='deleted',url=NULL,title='Deleted recipe',recipe_json=NULL,error=NULL,owner=NULL WHERE id=?").run(current.import_id);
      }
      const batchEmpty = !store.db.prepare("SELECT 1 FROM content_items WHERE batch_id=? AND state<>'deleted'").get(current.batch_id);
      if (batchEmpty) store.db.prepare("UPDATE content_batches SET status='deleted',error=NULL WHERE id=?").run(current.batch_id);
      return { deleted: true, bytesFreed, batchId: current.batch_id, batchEmpty };
    } catch {
      const error = "Some files could not be removed. Close any open recipe files, then click Retry deletion. No generation will restart.";
      store.db.prepare("UPDATE content_items SET state='delete_failed',error=? WHERE id=?").run(error, id);
      return { deleted: false, bytesFreed, batchId: current.batch_id, batchEmpty: false, error };
    }
  }).immediate();
  return result;
}
