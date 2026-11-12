const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contentFixture, article } = require('./helpers/content-fixtures.cjs');
const { ArtifactStore } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { IntelligenceStore } = require('../.intelligence-build/lib/recipe-intelligence/database.js');
const { WordPressStore } = require('../.intelligence-build/lib/recipe-intelligence/wordpress.js');
const { WordPressPublisher } = require('../.intelligence-build/lib/recipe-intelligence/wordpress-publish.js');
const { buildWordPressPackage } = require('../.intelligence-build/lib/recipe-intelligence/wordpressPackage.js');
const secrets = { async protect(v) { return v; }, async unprotect(v) { return v; } };
const json = (value, status = 200) => ({ status, body: Buffer.from(JSON.stringify(value)) });
async function fixture(t, tokenMode = false) {
  const f = await contentFixture(t), recipe = f.seed();
  const batch = f.batches.create([{ recipeId: recipe.id }], f.defaults), item = f.batches.item(batch.items[0].id);
  const artifacts = new ArtifactStore(f.store);
  artifacts.article(item, article(), JSON.parse(f.store.db.prepare('SELECT recipe_json FROM recipe_records WHERE id=?').get(recipe.id).recipe_json));
  const calls = [], remote = new Map(), behavior = {};
  const profile = { protocol: 1, version: '1.1.0', recipeCard: 'wprm', recipeCardLabel: 'WP Recipe Maker', revision: 'a'.repeat(64), ready: true, canPublish: true, tokenAuth: true, user: { id: 1, username: 'owner', slug: 'site-owner' } };
  const transport = async (url, init) => {
    calls.push({ url, ...init });
    if (tokenMode) { assert.equal(init.bridgeToken, 'ri_' + 'a'.repeat(64)); assert.equal(init.userSlug, 'site-owner'); assert.equal(init.authorization, undefined); assert.ok(url.includes('/recipe-intelligence/v1/')); }
    if (url.includes('/users/me')) return json({ id: 1, capabilities: { upload_files: true } });
    if (url.endsWith('/profile')) return behavior.noPlugin ? json({}, 404) : json(profile);
    if (init.method === 'GET') return remote.has(url.split('/').pop()) ? json(remote.get(url.split('/').pop())) : json({}, 404);
    const body = JSON.parse(init.body.toString());
    const saved = { postId: 77, status: body.status, editUrl: 'https://kitchen.example/wp-admin/post.php?post=77&action=edit', postUrl: 'https://kitchen.example/soup/', recipeCard: body.recipeCard, recipeId: 80 };
    if (!behavior.drop) remote.set(body.exportId, saved);
    if (behavior.timeout) throw new Error('Timed out');
    return json(saved);
  };
  const wp = new WordPressStore(f.store, transport, secrets);
  const c = (await wp.connect(tokenMode ? { siteUrl: 'https://kitchen.example/', authMethod: 'bridge_token', userSlug: 'site-owner', siteToken: 'ri_' + 'a'.repeat(64) } : { siteUrl: 'https://kitchen.example/', username: 'owner', applicationPassword: 'abcdefghijklmnopqrstuvwx' })).connections[0];
  const publisher = new WordPressPublisher(wp);
  const prepare = () => publisher.prepare(item.id, c.id);
  const send = (p, status = 'draft') => publisher.send(item.id, { connectionId: c.id, reviewHash: p.reviewHash, status, confirmPublish: status === 'publish' });
  return { ...f, wp, c, item, artifacts, calls, remote, behavior, profile, publisher, prepare, send };
}
test('site card settings sync independently and export uses saved recipe facts without AI calls', async t => {
  const f = await fixture(t); assert.equal(f.c.bridge.recipeCard, 'wprm');
  const p = await f.prepare();
  assert.deepEqual(p.payload.recipe.recipeIngredient, ['500 g carrots', '750 ml water', '1 tsp salt']);
  assert.equal((p.payload.content.match(/<!--ri-recipe-card-->/g) || []).length, 1);
  assert.doesNotMatch(p.payload.content, /<h1|<script|data:image/);
  const sent = await f.send(p); assert.equal(sent.status, 'draft');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  const row = f.store.db.prepare('SELECT * FROM wordpress_exports').get();
  assert.equal(JSON.parse(row.profile_json).recipeCard, 'wprm'); assert.equal(row.state, 'ready');
  assert.ok(fs.existsSync(path.join(f.root, row.receipt_path)));
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM api_calls').get().n, 0);
});
test('duplicate sends reconcile, and an explicit live action publishes the same draft', async t => {
  const f = await fixture(t), p = await f.prepare();
  await f.send(p); await f.send(p); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  await assert.rejects(f.publisher.send(f.item.id, { connectionId: f.c.id, reviewHash: p.reviewHash, status: 'publish' }), /Confirm/);
  const live = await f.send(p, 'publish'); assert.equal(live.postId, 77); assert.equal(live.status, 'publish');
  await f.send(p, 'publish'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
  await f.send(p); assert.equal(f.remote.get(p.exportId).status, 'publish');
});
test('changed card settings or article revisions need another review and never duplicate an exported post', async t => {
  const f = await fixture(t), p = await f.prepare(); f.profile.revision = 'b'.repeat(64); f.profile.recipeCard = 'builtin';
  await assert.rejects(f.send(p), /changed/); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  const q = await f.prepare(); await f.send(q);
  f.profile.revision = 'c'.repeat(64);
  await assert.rejects(f.send(await f.prepare()), /already sent with different/);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('uncertain publication requests only look up remote status and never repeat missing POSTs', async t => {
  const f = await fixture(t), p = await f.prepare(); f.behavior.timeout = true; f.behavior.drop = true;
  await assert.rejects(f.send(p), /Timed out/); await assert.rejects(f.send(p), /uncertain outcome/);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(f.store.db.prepare('SELECT state FROM wordpress_exports').get().state, 'uncertain');
});
test('a lost publication response is recovered by lookup and receipts repair local results', async t => {
  const f = await fixture(t), p = await f.prepare(); f.behavior.timeout = true;
  await assert.rejects(f.send(p), /Timed out/); f.behavior.timeout = false;
  const recovered = await f.publisher.check(f.item.id, f.c.id); assert.equal(recovered.postId, 77);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  const f2 = await fixture(t), p2 = await f2.prepare(); await f2.send(p2);
  f2.store.db.prepare("UPDATE wordpress_exports SET state='uncertain',result_json=NULL").run();
  const before = f2.calls.length; await f2.publisher.check(f2.item.id, f2.c.id); assert.equal(f2.calls.length, before);
});
test('missing bridge or unsupported card never publishes; read-only publishers can only save drafts', async t => {
  const f = await fixture(t); f.behavior.noPlugin = true;
  await assert.rejects(f.prepare(), /Install and activate/); assert.equal(f.wp.status().connections[0].bridge, undefined);
  f.behavior.noPlugin = false; f.profile.recipeCard = 'tasty';
  await assert.rejects(f.send(await f.prepare()), /supported default/);
  f.profile.recipeCard = 'wprm'; f.profile.canPublish = false;
  await assert.rejects(f.send(await f.prepare(), 'publish'), /cannot publish/);
  await f.send(await f.prepare());
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('v5 migration backs up existing media receipts before adding publication records', async t => {
  const f = await fixture(t); const hashes = f.store.db.prepare('SELECT name,sha256 FROM artifacts ORDER BY name').all();
  f.store.db.exec('DROP TABLE r2_deleted_paths; DROP TABLE r2_objects; DROP TABLE wordpress_exports; PRAGMA user_version=5'); f.store.close();
  const upgraded = await IntelligenceStore.open(f.root); t.after(() => upgraded.close());
  assert.equal(upgraded.db.pragma('user_version', { simple: true }), 7);
  assert.deepEqual(upgraded.db.prepare('SELECT name,sha256 FROM artifacts ORDER BY name').all(), hashes);
  assert.ok(fs.readdirSync(path.join(f.root, 'backups')).some(n => n.startsWith('before-migration-6')));
  assert.deepEqual(upgraded.db.pragma('foreign_key_check'), []);
});
test('installable plugin package includes only the distributable PHP file', async () => {
  const archive = await buildWordPressPackage(); assert.equal(archive.version, '1.1.0');
  assert.match(archive.bytes.toString(), /Plugin Name: Recipe Intelligence Bridge/);
  assert.doesNotMatch(archive.bytes.toString(), /OPENAI_API_KEY|protectedPassword|\.env\.local/);
});

test('Site Token publishing keeps the default recipe card, draft/live approval and idempotent export', async t => {
  const f = await fixture(t, true), p = await f.prepare();
  assert.equal(f.c.authMethod, 'bridge_token'); assert.equal(f.c.username, 'owner');
  assert.equal(p.profile.recipeCard, 'wprm');
  const saved = await f.send(p); assert.equal(saved.status, 'draft');
  const live = await f.send(p, 'publish'); assert.equal(live.postId, saved.postId);
  await f.send(p, 'publish'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM api_calls').get().n, 0);
});

test('native card replaces the previous card without losing galleries or numbered cooking steps', async t => {
  const f = await fixture(t); const old = f.store.db.prepare("SELECT id FROM artifacts WHERE item_id=? AND name='article.html'").get(f.item.id);
  const doc = f.artifacts.read(old.id).data.toString().replace('</article>', '<ol start="2"><li>Second step</li></ol><section data-ri-recipe-card="1"><h2>Complete Recipe Card</h2><p>Repeated recipe facts</p></section><h2>Photo gallery</h2><p>Keep this gallery</p></article>');
  f.artifacts.put(f.item, 'article.html', doc, 'text/html');
  const p = await f.prepare(); assert.match(p.payload.content, /<ol start="2">/); assert.doesNotMatch(p.payload.content, /Repeated recipe facts|Complete Recipe Card/);
  assert.match(p.payload.content, /Keep this gallery/); assert.equal(p.payload.content.split('<!--ri-recipe-card-->').length, 2);
});
