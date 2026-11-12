const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { contentFixture } = require('./helpers/content-fixtures.cjs');
const { IntelligenceStore } = require('../.intelligence-build/lib/recipe-intelligence/database.js');
const { ObjectStorage, r2Config, removeCloudPaths } = require('../.intelligence-build/lib/recipe-intelligence/r2.js');
const { atomicWrite, digest } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const env = { R2_ENABLED: '1', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET_NAME: 'test-recipes', R2_ACCESS_KEY_ID: 'b'.repeat(32), R2_SECRET_ACCESS_KEY: 'c'.repeat(64) };
async function setup(t) {
  const f = await contentFixture(t), objects = new Map(), calls = [], behavior = {};
  const remote = {
    async head(key) { calls.push(['head',key]); if (behavior.denied) throw Object.assign(new Error(env.R2_SECRET_ACCESS_KEY), { $metadata: { httpStatusCode: 403 } }); const row = objects.get(key); return row ? { size: row.bytes.length, sha256: row.sha } : null; },
    async put(key, bytes, type, sha) { calls.push(['put',key]); objects.set(key, { bytes:Buffer.from(bytes), type, sha }); if (behavior.timeout) throw new Error(env.R2_SECRET_ACCESS_KEY); },
    async get(key, max) { calls.push(['get',key]); const bytes = objects.get(key).bytes; assert.ok(bytes.length <= max); return behavior.corrupt ? Buffer.alloc(bytes.length) : bytes; },
    async remove(key) { calls.push(['remove',key]); objects.delete(key); },
  };
  const storage = new ObjectStorage(f.store, env, remote);
  return {...f,storage,remote,objects,calls,behavior};
}

test('R2 is opt-in, uses only environment credentials and rejects credential exfiltration endpoints', () => {
  assert.equal(r2Config({}), null); assert.equal(r2Config({ ...env, R2_ENABLED:'0' }),null);
  const config=r2Config(env); assert.equal(config.endpoint,`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  for(const value of ['https://evil.example','http://localhost','https://'+env.R2_ACCOUNT_ID+'.r2.cloudflarestorage.com/path']) assert.throws(()=>r2Config({...env,R2_ENDPOINT:value}));
  for(const prefix of ['../secret','/public','a//b','a\\b']) assert.throws(()=>r2Config({...env,R2_PREFIX:prefix}));
  assert.throws(()=>r2Config({...env,R2_SECRET_ACCESS_KEY:''}),/R2_SECRET_ACCESS_KEY/);
});

test('R2 sync stores only approved asset folders, survives restart and restores missing files byte-for-byte', async t => {
  const f=await setup(t), bytes=Buffer.from('saved article bytes');
  atomicWrite(f.root,'articles/recipe/v1/article.html',bytes);
  atomicWrite(f.root,'research/references/import/photo.webp',Buffer.from('reference fixture'));
  atomicWrite(f.root,'logs/private.log',Buffer.from('must remain local'));
  atomicWrite(f.root,'articles/recipe/v1/secret.key',Buffer.from('must remain local'));
  await f.storage.tick(); await f.storage.tick();
  assert.equal(f.objects.size,2); assert.equal(f.storage.status().synced,2);
  assert.ok([...f.objects.keys()].every(k=>k.startsWith('track-competitor/')&&!/database|logs|secret/.test(k)));
  const row=f.store.db.prepare("SELECT * FROM r2_objects WHERE relative_path LIKE '%article.html'").get();
  assert.equal(f.objects.get(row.object_key).type,'text/html'); assert.equal(row.sha256,digest(bytes));
  const filename=path.join(f.root,row.relative_path);fs.unlinkSync(filename);
  const restarted=new ObjectStorage(f.store,env,f.remote); await restarted.ensure(row.relative_path,row.sha256);
  assert.ok(fs.readFileSync(filename).equals(bytes));
  await restarted.tick(); assert.equal(f.calls.filter(c=>c[0]==='put').length,2);
  assert.doesNotMatch(JSON.stringify(restarted.status()),new RegExp(env.R2_ACCESS_KEY_ID+'|'+env.R2_SECRET_ACCESS_KEY));
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM api_calls').get().n,0);
});

test('an accepted R2 PUT with a lost response is reconciled through HEAD without another PUT', async t => {
  const f=await setup(t);atomicWrite(f.root,'reports/test.json','{"report":1}');
  f.behavior.timeout=true;await f.storage.tick();assert.equal(f.storage.status().failed,1);
  assert.ok(fs.existsSync(path.join(f.root,'reports/test.json')));
  assert.doesNotMatch(JSON.stringify(f.storage.status()),new RegExp(env.R2_SECRET_ACCESS_KEY));
  fs.unlinkSync(path.join(f.root,'reports/test.json'));
  f.behavior.timeout=false;f.storage.requestSync();await f.storage.tick();
  assert.equal(f.storage.status().synced,1);assert.equal(f.calls.filter(c=>c[0]==='put').length,1);
  await f.storage.ensure('reports/test.json');assert.equal(fs.readFileSync(path.join(f.root,'reports/test.json'),'utf8'),'{"report":1}');
});

test('private cloud restore rejects tampered data, traversal and deleted files without invoking generation', async t => {
  const f=await setup(t);atomicWrite(f.root,'articles/recipe/v1/article.md','Original article');await f.storage.tick();
  fs.unlinkSync(path.join(f.root,'articles/recipe/v1/article.md'));f.behavior.corrupt=true;
  await assert.rejects(f.storage.ensure('articles/recipe/v1/article.md'),/safely/);
  assert.equal(fs.existsSync(path.join(f.root,'articles/recipe/v1/article.md')),false);
  await assert.rejects(f.storage.ensure('../private.key'),/path/);
  removeCloudPaths(f.store,['articles/recipe']);f.behavior.corrupt=false;
  await assert.rejects(f.storage.ensure('articles/recipe/v1/article.md'),/missing/);
  await f.storage.tick();assert.equal(f.objects.size,0);
  await f.storage.tick();assert.equal(f.calls.filter(c=>c[0]==='remove').length,1);
  assert.equal(f.providerCalls.length,0);
});

test('versioned objects do not overwrite old bytes and destination changes never reuse another bucket', async t => {
  const f=await setup(t);atomicWrite(f.root,'articles/recipe/v1/article.md','one');await f.storage.tick();
  atomicWrite(f.root,'articles/recipe/v1/article.md','second version');await f.storage.discover();await f.storage.tick();
  assert.equal(f.objects.size,2);assert.deepEqual([...f.objects.values()].map(o=>o.bytes.toString()),['one','second version']);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM r2_objects WHERE is_current=1').get().n,1);
  const second=new ObjectStorage(f.store,{...env,R2_BUCKET_NAME:'another-bucket'},f.remote);
  assert.equal(second.status().synced,0);await second.discover();assert.equal(second.status().pending,1);
});

test('bad R2 configuration and rejected uploads preserve local processing and expose no secret values', async t => {
  const f=await setup(t);const bad=new ObjectStorage(f.store,{...env,R2_ENDPOINT:'https://evil.example'},f.remote);
  assert.equal(bad.status().enabled,false);await bad.tick();assert.equal(f.calls.length,0);
  atomicWrite(f.root,'reports/test.json','{}');f.behavior.denied=true;await f.storage.tick();
  assert.match(f.storage.status().error,/denied access/);assert.equal(f.storage.status().failed,1);
  assert.equal(fs.readFileSync(path.join(f.root,'reports/test.json'),'utf8'),'{}');
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM api_calls').get().n,0);
});

test('a file restored to a superseded version is queued again instead of silently omitted', async t => {
  const f=await setup(t);
  atomicWrite(f.root,'reports/revised.json','original');await f.storage.discover();
  atomicWrite(f.root,'reports/revised.json','new version');await f.storage.discover();
  await f.storage.tick(); // Original bytes disappeared before their pending upload.
  assert.equal(f.store.db.prepare("SELECT state FROM r2_objects WHERE sha256=?").get(digest('original')).state,'superseded');
  await f.storage.tick();
  atomicWrite(f.root,'reports/revised.json','original');await f.storage.discover();await f.storage.tick();
  assert.equal(f.objects.size,2);
  assert.equal(f.store.db.prepare("SELECT state FROM r2_objects WHERE is_current=1").get().state,'synced');
});

test('one invalid transfer cannot block other queued cloud files', async t => {
  const f=await setup(t);atomicWrite(f.root,'reports/a.json','{}');atomicWrite(f.root,'reports/b.json','{}');
  await f.storage.discover();
  f.store.db.prepare("UPDATE r2_objects SET object_key='outside-workspace' WHERE relative_path='reports/a.json'").run();
  await f.storage.tick();await f.storage.tick();
  assert.equal(f.storage.status().failed,1);assert.equal(f.storage.status().synced,1);
  assert.ok(!f.calls.some(call=>call[1]==='outside-workspace'));
});

test('R2 migration backs up the existing SQLite database and leaves tracking and artifact records intact', async t => {
  const f=await contentFixture(t);f.seed();
  const rows=f.store.db.prepare('SELECT * FROM recipe_records').all();
  f.store.db.exec('ALTER TABLE content_items DROP COLUMN archived_at; DROP TABLE r2_objects; DROP TABLE r2_deleted_paths; PRAGMA user_version=6');f.store.close();
  const store=await IntelligenceStore.open(f.root);t.after(()=>store.close());
  assert.equal(store.db.pragma('user_version',{simple:true}), 8);
  assert.deepEqual(store.db.prepare('SELECT * FROM recipe_records').all(),rows);
  const name=fs.readdirSync(path.join(f.root,'backups')).find(n=>n.startsWith('before-migration-7'));
  assert.ok(name);const backup=new Database(path.join(f.root,'backups',name),{readonly:true});
  try { assert.equal(backup.pragma('user_version',{simple:true}),6);assert.deepEqual(backup.prepare('SELECT * FROM recipe_records').all(),rows); }finally{backup.close();}
});
