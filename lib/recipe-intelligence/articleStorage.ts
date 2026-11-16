import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IntelligenceStore } from './database';
import { assertInside, storagePath } from './paths';
import { removeCloudPaths } from './r2';

const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const sha = /^[a-f0-9]{64}$/;
// Content directories only: never database, settings, app code, reports, backups
// or independent design projects. Old versions and abandoned imports count too.
const contentRoots = ['articles', 'research/references', 'research/browser', 'research/requests', 'research/api-receipts', 'exports/wordpress-receipts', 'editorial-trials-v5', 'editorial-trials-v5-reviewed'];
function checked(root: string, relative: string) {
  const target = storagePath(root, relative);
  if (path.resolve(root) === target) throw new Error('Cannot remove the workspace root.');
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('A linked content folder prevents safe deletion.');
      assertInside(root, fs.realpathSync(cursor));
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
  return target;
}
function table(store: IntelligenceStore, name: string) { return !!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); }
function records(store: IntelligenceStore) {
  const recipes = store.db.prepare("SELECT i.id,i.state,i.version,i.archived_at,b.status FROM content_items i JOIN content_batches b ON b.id=i.batch_id WHERE i.state<>'deleted' AND b.status<>'deleted' ORDER BY i.id").all() as any[];
  const decor = table(store, 'decor_jobs') ? store.db.prepare("SELECT id,state,updated_at,json_extract(data_json,'$.archived') archived FROM decor_jobs WHERE state<>'deleted' ORDER BY id").all() as any[] : [];
  return { recipes, decor };
}
export function articleStorageSummary(store: IntelligenceStore) {
  const { recipes, decor } = records(store);
  const archived = recipes.filter(r => !!r.archived_at).length + decor.filter(r => !!r.archived).length;
  return { total: recipes.length + decor.length, recipes: recipes.length, decor: decor.length, archived,
    active: recipes.length + decor.length - archived, completed: [...recipes, ...decor].filter(r => r.state === 'completed').length };
}
function assertIdle(store: IntelligenceStore) {
  const busy = store.db.prepare("SELECT 1 FROM content_stages WHERE state='running' LIMIT 1").get()
    || store.db.prepare("SELECT 1 FROM api_calls WHERE state IN ('reserved','dispatched') LIMIT 1").get()
    || store.db.prepare("SELECT 1 FROM wordpress_exports WHERE state='sending' LIMIT 1").get()
    || store.db.prepare("SELECT 1 FROM wordpress_media WHERE state='uploading' LIMIT 1").get()
    || store.db.prepare("SELECT 1 FROM recipe_imports WHERE status IN ('running','capturing') LIMIT 1").get()
    || store.db.prepare("SELECT 1 FROM content_items WHERE state='running' LIMIT 1").get()
    || (table(store, 'decor_jobs') && store.db.prepare("SELECT 1 FROM decor_jobs WHERE state IN ('running','importing','capturing') LIMIT 1").get())
    || (table(store, 'decor_calls') && store.db.prepare("SELECT 1 FROM decor_calls WHERE state IN ('reserved','dispatched') LIMIT 1").get());
  if (busy) throw new Error('Wait for the current generation, import or WordPress request to finish before deleting all articles.');
  const locks = checked(store.root, 'verified-images/locks');
  if (fs.existsSync(locks) && fs.readdirSync(locks).length) throw new Error('Image preparation is in progress. Retry deletion when it finishes.');
}
type File = { relative: string; size: number; modified: number };
function plan(store: IntelligenceStore) {
  assertIdle(store);
  const files = new Map<string, File>(), directories = new Set<string>(), roots = [...contentRoots];
  const visit = (relative: string) => {
    relative = relative.replaceAll('\\', '/');
    const target = checked(store.root, relative);
    let stat: fs.Stats; try { stat = fs.lstatSync(target); } catch (e: any) { if (e.code === 'ENOENT') return; throw e; }
    if (stat.isDirectory()) { for (const name of fs.readdirSync(target)) visit(`${relative}/${name}`); directories.add(relative); }
    else if (stat.isFile()) files.set(relative, { relative, size: stat.size, modified: stat.mtimeMs });
    else throw new Error('Unsupported content file. Nothing has been deleted.');
  };
  for (const root of roots) visit(root);
  // Trace article-owned outputs through source pointers, all variants and private
  // preparation records. Never wipe the shared image store indiscriminately.
  const pendingPath = checked(store.root, 'database/article-clear-state.json');
  const pending = fs.existsSync(pendingPath) ? JSON.parse(fs.readFileSync(pendingPath, 'utf8')) : { outputs: [], privateJobs: [] };
  const owned = new Set<string>((pending.outputs || []).filter((s: string) => sha.test(s))), keep = new Set<string>();
  for (const file of files.values()) if (/\.(?:png|jpe?g|webp)$/i.test(file.relative)) owned.add(hash(fs.readFileSync(checked(store.root, file.relative))));
  const names = (relative: string) => { const dir = checked(store.root, relative); return fs.existsSync(dir) ? fs.readdirSync(dir) : []; };
  const read = (relative: string) => JSON.parse(fs.readFileSync(checked(store.root, relative), 'utf8'));
  const pointers = names('verified-images/sources').filter(n => /^[a-f0-9]{64}\.json$/.test(n));
  for (const name of pointers) { const p = read(`verified-images/sources/${name}`); if (sha.test(p.id)) owned.add(p.id); }
  const proofs = new Map<string, any>();
  for (const name of names('verified-images/proofs').filter(n => /^[a-f0-9]{64}\.json$/.test(n))) proofs.set(name.slice(0, -5), read(`verified-images/proofs/${name}`));
  const expand = (set: Set<string>) => { for (const id of set) for (const value of Object.values(proofs.get(id)?.variants || {})) if (typeof value === 'string' && sha.test(value)) set.add(value); };
  expand(owned);
  const jobs = names('verified-images/private').filter(n => sha.test(n)).map(id => {
    const base = `verified-images/private/${id}`;
    let job: any;
    try { job = read(`${base}/job.json`); } catch (e: any) { if (e.code !== 'ENOENT' || !pending.privateJobs?.includes(id)) throw e; job = { owner: 'articles' }; }
    const input = checked(store.root, `${base}/input`), original = checked(store.root, `${base}/original`);
    const hashes = [input, original].filter(p => fs.existsSync(p)).map(p => hash(fs.readFileSync(p)));
    return { id, job, hashes, owned: job.owner === 'articles' || !!pending.privateJobs?.includes(id) };
  });
  // Persist ownership before unlinking so a failed/partial cleanup remains retryable.
  for (const j of jobs.filter(j => j.owned)) if (sha.test(j.job.output)) owned.add(j.job.output);
  let changed = true;
  while (changed) { changed = false; for (const j of jobs) if (!j.owned && !['other', 'shared'].includes(j.job.owner) && (owned.has(j.job.output) || j.hashes.some(h => owned.has(h)))) { j.owned = true; if (sha.test(j.job.output)) owned.add(j.job.output); changed = true; } expand(owned); }
  for (const j of jobs) if (!j.owned && sha.test(j.job.output)) keep.add(j.job.output);
  // Independent studio projects may reference a shared verified variant.
  if (table(store, 'studio_records')) for (const row of store.db.prepare('SELECT value_json FROM studio_records').all() as any[]) for (const id of row.value_json.match(/[a-f0-9]{64}/g) || []) keep.add(id);
  expand(keep);
  for (const j of jobs.filter(j => j.owned)) roots.push(`verified-images/private/${j.id}`);
  for (const id of owned) if (!keep.has(id)) roots.push(`verified-images/outputs/${id}`, `verified-images/proofs/${id}.json`);
  for (const name of pointers) roots.push(`verified-images/sources/${name}`);
  for (const root of roots.slice(contentRoots.length)) visit(root);
  const snapshot = records(store), imports = store.db.prepare("SELECT id,status FROM recipe_imports WHERE status<>'deleted' ORDER BY id").all();
  const revision = hash(JSON.stringify({ snapshot, imports, files: [...files.values()] }));
  return { files: [...files.values()], directories: [...directories].sort((a, b) => b.split('/').length - a.split('/').length), roots, owned: [...owned], jobs: jobs.filter(j => j.owned),
    summary: { ...articleStorageSummary(store), revision, fileCount: files.size, bytes: [...files.values()].reduce((n, f) => n + f.size, 0) } };
}
export function previewArticleStorageDeletion(store: IntelligenceStore) { return plan(store).summary; }
export function deleteAllArticles(store: IntelligenceStore, confirmed: unknown, revision: unknown) {
  if (confirmed !== true) throw new Error('Confirm deletion of all articles and their images.');
  // One SQLite write transaction prevents a worker claim or a concurrent import
  // between revalidation and deleting files. No network calls or WP deletion.
  return store.db.transaction(() => {
    const deletion = plan(store);
    if (typeof revision !== 'string' || revision !== deletion.summary.revision) throw new Error('The saved articles changed. Review the current count before deleting.');
    store.db.prepare("UPDATE content_items SET state='delete_failed',error='Library cleanup is pending.' WHERE state<>'deleted'").run();
    store.db.prepare("UPDATE content_stages SET state='deleted',owner=NULL WHERE state<>'deleted'").run();
    store.db.prepare("UPDATE content_batches SET status='paused' WHERE status<>'deleted'").run();
    store.db.prepare("UPDATE recipe_imports SET status='delete_pending' WHERE status<>'deleted'").run();
    if (table(store, 'decor_jobs')) store.db.prepare("UPDATE decor_jobs SET state='delete_failed' WHERE state<>'deleted'").run();
    let bytesFreed = 0;
    try {
      fs.writeFileSync(checked(store.root, 'database/article-clear-state.json'), JSON.stringify({ outputs: deletion.owned, privateJobs: deletion.jobs.map(j => j.id) }), { mode: 0o600 });
      // Tombstone exact existing paths, never a reusable content root: new
      // articles must still be able to sync after the library is cleared.
      const cloudPaths = new Set(deletion.files.map(f => f.relative).filter(p => /^(articles|research|exports|verified-images)\//.test(p)));
      for (const row of store.db.prepare("SELECT relative_path FROM r2_objects WHERE state<>'deleted'").all() as any[]) if (contentRoots.some(r => row.relative_path.startsWith(r + '/'))) cloudPaths.add(row.relative_path);
      removeCloudPaths(store, [...cloudPaths]);
      for (const file of deletion.files) { try { fs.unlinkSync(checked(store.root, file.relative)); bytesFreed += file.size; } catch (e: any) { if (e.code !== 'ENOENT') throw e; } }
      for (const dir of deletion.directories) { try { fs.rmdirSync(checked(store.root, dir)); } catch (e: any) { if (e.code !== 'ENOENT') throw e; } }
      store.db.exec(`DELETE FROM artifacts; DELETE FROM wordpress_exports; DELETE FROM wordpress_media; DELETE FROM content_photos; DELETE FROM reference_photos;
        UPDATE api_calls SET response_path=NULL;
        UPDATE content_stages SET state='deleted',request_path=NULL,result_json=NULL,error=NULL,owner=NULL;
        UPDATE content_items SET state='deleted',source_json=NULL,research_json='[]',article_json=NULL,config_json=NULL,warnings_json='[]',selection_reason=NULL,review_kind=NULL,error=NULL;
        UPDATE content_batches SET status='deleted',error=NULL;
        UPDATE recipe_imports SET status='deleted',url=NULL,title='Deleted recipe',recipe_json=NULL,error=NULL,owner=NULL;`);
      if (table(store, 'decor_calls')) store.db.prepare('UPDATE decor_calls SET receipt=NULL,error=NULL').run();
      if (table(store, 'decor_jobs')) store.db.prepare("UPDATE decor_jobs SET state='deleted',data_json='{}',updated_at=?").run(new Date().toISOString());
      fs.unlinkSync(checked(store.root, 'database/article-clear-state.json'));
      return { deleted: true, deletedArticles: deletion.summary.total, bytesFreed, ...articleStorageSummary(store) };
    } catch {
      return { deleted: false, bytesFreed, error: 'Some article files could not be removed. Retry deletion to finish. No generation will restart.', ...articleStorageSummary(store) };
    }
  }).immediate();
}
