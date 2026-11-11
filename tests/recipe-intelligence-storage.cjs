const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { fixture, temporary, IntelligenceStore, rss, sitemap } = require('./helpers/recipe-fixtures.cjs');
const { prepareRoot, storagePath, localRoot } = require('../.intelligence-build/lib/recipe-intelligence/paths.js');

test('ten-site cap includes paused websites; archiving keeps and restores identity and history', async t => {
  const { store, responses, drain } = await fixture(t);
  const sites = Array.from({ length: 10 }, (_, i) => store.addSite('', `https://site${i}.example/`));
  store.setSiteStatus(sites[0].id, 'paused');
  assert.throws(() => store.addSite('', 'https://eleventh.example/'), /10 websites/);
  assert.equal(store.addSite('', 'http://www.site1.example').id, sites[1].id);
  responses.set('https://site1.example/feed/', rss(['https://site1.example/soup/']));
  const run = store.createScan(sites[1].id); await drain();
  store.setSiteStatus(sites[1].id, 'archived');
  assert.equal(store.history(sites[1].id).total, 1);
  assert.equal(store.snapshot().sites.length, 9);
  assert.equal(store.addSite('Restored', sites[1].url).id, sites[1].id);
  assert.equal(store.db.prepare('SELECT count(*) n FROM scan_runs WHERE id=?').get(run).n, 1);
  assert.throws(() => store.addSite('', 'https://eleventh.example/'), /10 websites/);
});

test('thousands of baseline URLs and duplicate RSS/sitemap entries remain unverified with raw evidence', async t => {
  const { store, responses, drain } = await fixture(t);
  const site = store.addSite('Kitchen', 'https://kitchen.example');
  const urls = Array.from({ length: 3000 }, (_, i) => `https://kitchen.example/recipe-${i}/`);
  responses.set(`${site.url}feed/`, rss([`${urls[0]}?utm_source=rss#recipe`]));
  responses.set(`${site.url}sitemap.xml`, sitemap(urls));
  const id = store.createScan(site.id); assert.equal(store.createScan(site.id), id);
  await drain();
  assert.equal(store.history(site.id).total, 3000);
  assert.equal(store.db.prepare("SELECT count(*) n FROM recipe_records WHERE published_at IS NOT NULL OR verification_status!='unverified' OR origin!='baseline_existing'").get().n, 0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM recipe_observations').get().n, 3001);
  const evidence = store.db.prepare('SELECT evidence FROM recipe_observations ORDER BY id LIMIT 1').get().evidence;
  assert.match(evidence, /2020|2026/);
  assert.equal(store.db.prepare('SELECT status FROM scan_runs WHERE id=?').get(id).status, 'completed');
  assert.ok(store.getSite(site.id).baseline_completed_at);
  assert.equal(store.history(site.id, 59).rows.length, 50);
  assert.equal(store.history(site.id, 60).rows.length, 0);
});

test('restart restores settings, sites and interrupted jobs; only one live worker can claim work', async t => {
  const { store, root, owner } = await fixture(t);
  const site = store.addSite('Persistent', 'https://persistent.example/');
  store.updateTimezone('Europe/Paris'); const run = store.createScan(site.id);
  const pending = store.claim(owner); assert.equal(pending.kind, 'robots');
  assert.equal(store.acquireLease('duplicate'), false); assert.equal(store.claim('duplicate'), null);
  store.close();
  const reopened = await IntelligenceStore.open(root); t.after(() => reopened.close());
  assert.equal(reopened.snapshot().settings.timezone, 'Europe/Paris');
  assert.equal(reopened.createScan(site.id), run);
  reopened.db.prepare('UPDATE worker_lease SET expires_at=0').run();
  assert.equal(reopened.acquireLease('replacement'), true);
  assert.equal(reopened.canCommit(pending, owner), false);
  assert.equal(reopened.claim('replacement').id, pending.id);
  reopened.releaseLease('replacement');
  assert.equal(reopened.db.prepare('SELECT state FROM scan_items WHERE id=?').get(pending.id).state, 'queued');
});

test('pausing one site leaves other sites runnable and resumes the same checkpoint', async t => {
  const { store, owner } = await fixture(t);
  const a = store.addSite('A', 'https://a.example/'), b = store.addSite('B', 'https://b.example/');
  const arun = store.createScan(a.id), brun = store.createScan(b.id);
  store.setSiteStatus(a.id, 'paused');
  assert.equal(store.claim(owner).run_id, brun);
  assert.throws(() => store.runAction(arun, 'resume'), /Activate/);
  store.setSiteStatus(a.id, 'active'); store.runAction(arun, 'resume');
  assert.equal(store.claim(owner, [b.id]).run_id, arun);
  store.setSiteStatus(a.id, 'archived');
  assert.equal(store.db.prepare('SELECT status FROM scan_runs WHERE id=?').get(arun).status, 'cancelled');
});

test('robots retry backoff prevents other work for that site while allowing another domain', async t => {
  const { store, owner } = await fixture(t);
  const a = store.addSite('A', 'https://a.example/'), b = store.addSite('B', 'https://b.example/');
  store.createScan(a.id); const item = store.claim(owner);
  store.taskState(item, 'queued', 'Backoff', 60_000);
  assert.equal(store.claim(owner), null);
  store.createScan(b.id); assert.equal(store.claim(owner).site_id, b.id);
});

test('bounded source segments pause and can resume without repeating processed tasks', async t => {
  const { store, owner } = await fixture(t);
  const site = store.addSite('', 'https://large.example/'); const run = store.createScan(site.id);
  for (let i = 0; i < 501; i++) store.enqueue(run, site.id, `${site.url}map-${i}.xml`, 'source');
  store.db.prepare("UPDATE scan_items SET state='done' WHERE id IN (SELECT id FROM scan_items WHERE run_id=? ORDER BY id LIMIT 500)").run(run);
  assert.equal(store.claim(owner), null);
  assert.equal(store.db.prepare('SELECT status FROM scan_runs WHERE id=?').get(run).status, 'paused');
  store.runAction(run, 'resume'); const next = store.claim(owner);
  assert.ok(next); assert.equal(next.attempts, 1);
  assert.equal(store.db.prepare("SELECT count(*) n FROM scan_items WHERE run_id=? AND state='done'").get(run).n, 500);
});

test('backup API produces a consistent database that reopens with preserved history', async t => {
  const { store, root } = await fixture(t);
  store.addSite('Backup', 'https://backup.example/');
  const file = await store.backup(); const copy = new Database(path.join(root, 'backups', file), { readonly: true });
  try {
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(copy.prepare('SELECT name FROM tracked_sites').get().name, 'Backup');
    assert.equal(copy.pragma('user_version', { simple: true }), 5);
  } finally { copy.close(); }
  assert.equal(store.integrity(), 'ok');
});

test('unknown existing schemas are backed up before any attempted migration', async t => {
  const root = prepareRoot(temporary(t));
  const db = new Database(storagePath(root, 'database', 'recipe-intelligence.sqlite'));
  db.exec('CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES (\'keep\')'); db.close();
  await assert.rejects(IntelligenceStore.open(root), /not an empty/);
  const backups = fs.readdirSync(path.join(root, 'backups')); assert.equal(backups.length, 1);
  const check = new Database(path.join(root, 'backups', backups[0]));
  assert.equal(check.prepare('SELECT value FROM unrelated').get().value, 'keep'); check.close();
});

test('concurrent Phase 1 database opens back up and apply additive migrations only once', async t => {
  const root = prepareRoot(temporary(t)); const filename = storagePath(root, 'database', 'recipe-intelligence.sqlite');
  const old = new Database(filename);
  old.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE tracked_sites(id TEXT PRIMARY KEY,name TEXT,url TEXT,site_key TEXT,status TEXT,created_at TEXT,baseline_started_at TEXT,baseline_completed_at TEXT,last_scan_at TEXT,last_success_at TEXT);
    CREATE TABLE recipe_records(id INTEGER PRIMARY KEY,site_id TEXT,canonical_url TEXT,title TEXT,first_seen_at TEXT,last_seen_at TEXT,origin TEXT,verification_status TEXT,published_at TEXT,modified_at TEXT,UNIQUE(site_id,canonical_url));
    INSERT INTO settings VALUES('reporting_timezone','Africa/Casablanca');
    INSERT INTO tracked_sites(id,name,url,status) VALUES('old','Existing kitchen','https://old.example/','paused');
    INSERT INTO recipe_records(id,site_id,canonical_url,title,origin,verification_status) VALUES(1,'old','https://old.example/soup','Saved soup','baseline_existing','unverified');
    PRAGMA user_version=1;`); old.close();
  const [upgraded, other] = await Promise.all([IntelligenceStore.open(root), IntelligenceStore.open(root)]);
  t.after(() => { if (upgraded.db.open) upgraded.close(); if (other.db.open) other.close(); });
  assert.equal(upgraded.db.pragma('user_version', { simple: true }), 5);
  assert.equal(upgraded.db.prepare('SELECT title FROM recipe_records WHERE id=1').get().title, 'Saved soup');
  assert.equal(upgraded.db.prepare('SELECT count(*) n FROM content_batches').get().n, 0);
  const backups = fs.readdirSync(path.join(root, 'backups')).filter(n => n.startsWith('before-migration-2')); assert.ok(backups.length >= 1);
  const backup = new Database(path.join(root, 'backups', backups[0]), { readonly: true });
  try { assert.equal(backup.pragma('user_version', { simple: true }), 1); assert.equal(backup.prepare('SELECT title FROM recipe_records').get().title, 'Saved soup'); } finally { backup.close(); }
});

test('storage accepts selected folders with spaces but rejects traversal, network paths and escaping junctions', t => {
  const temp = temporary(t); const root = prepareRoot(path.join(temp, 'Chosen folder', 'Recipe files'));
  assert.equal(fs.statSync(path.join(root, 'database')).isDirectory(), true);
  assert.throws(() => prepareRoot('relative-folder'), /absolute/);
  assert.throws(() => prepareRoot('\\\\server\\share\\recipes'), /local drive/);
  assert.throws(() => prepareRoot(path.parse(temp).root), /drive root/);
  assert.throws(() => storagePath(root, '..', 'outside'), /outside/);
  const outside = path.join(temp, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => storagePath(root, 'escape', 'secret'), /outside/);
  assert.throws(() => localRoot(), /local launcher/);
});
