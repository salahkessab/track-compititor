const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { contentFixture, article } = require('./helpers/content-fixtures.cjs');
const { IntelligenceStore } = require('../.intelligence-build/lib/recipe-intelligence/database.js');
const { ArtifactStore, digest } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { WordPressStore } = require('../.intelligence-build/lib/recipe-intelligence/wordpress.js');
const { wordpressSite } = require('../.intelligence-build/lib/recipe-intelligence/wordpress-http.js');
const { windowsSecrets } = require('../.intelligence-build/lib/recipe-intelligence/local-secrets.js');
const secret = 'abcdefghijklmnopqrstuvwx';
const secrets = { async protect(v) { return 'protected:' + Buffer.from(v).toString('base64'); }, async unprotect(v) { return Buffer.from(v.slice(10), 'base64').toString(); } };
const json = (body, status = 200) => ({ status, body: Buffer.from(JSON.stringify(body)) });

async function fixture(t, count = 2) {
  const f = await contentFixture(t); const recipe = f.seed(); const batch = f.batches.create([{ recipeId: recipe.id }], f.defaults);
  const item = f.batches.item(batch.items[0].id); const artifacts = new ArtifactStore(f.store);
  const source = JSON.parse(f.store.db.prepare('SELECT recipe_json FROM recipe_records WHERE id=?').get(recipe.id).recipe_json);
  for (let i = 0; i < count; i++) artifacts.put(item, ['featured.jpg', 'alternate.jpg', 'pinterest.jpg'][i], await sharp({ create: { width: 24, height: 24, channels: 3, background: ['#aa2211', '#445511', '#4433aa'][i] } }).jpeg().toBuffer(), 'image/jpeg');
  artifacts.article(item, article(), source);
  const calls = []; const remote = new Map(); let nextId = 1; const behavior = {};
  const transport = async (url, init) => {
    calls.push({ url, ...init }); const u = new URL(url);
    if (u.pathname.endsWith('/users/me')) return behavior.denied ? json({}, 401) : json({ id: 1, name: 'Recipe Owner', capabilities: { upload_files: true } });
    assert.ok(u.pathname.endsWith('/media'), 'Only user lookup and media endpoints are used');
    if (init.method === 'GET') return json([...(remote.get(u.origin) || [])].filter(m => m.slug === u.searchParams.get('slug')));
    const slug = /name="slug"\r\n\r\n([^\r]+)/.exec(init.body.toString())[1];
    const media = { id: nextId++, slug, source_url: u.origin + '/wp-content/uploads/' + slug + '.jpg', mime_type: 'image/jpeg' };
    if (behavior.rejectUpload) return json({ message: 'Refused' }, 413);
    if (!behavior.dropUpload) remote.set(u.origin, [...(remote.get(u.origin) || []), media]);
    if (behavior.timeout) throw new Error('simulated connection interruption');
    return json(media, 201);
  };
  const wp = new WordPressStore(f.store, transport, secrets);
  async function connect(siteUrl = 'https://first.example/') { const s = await wp.connect({ siteUrl, username: 'owner', applicationPassword: secret }); return s.connections.find(c => c.siteUrl === siteUrl); }
  return { ...f, item, artifacts, wp, calls, remote, behavior, transport, connect };
}
const upload = (f, c, p, image) => f.wp.upload(f.item.id, { connectionId: c.id, documentHash: p.documentHash, sha256: image.sha256 });

test('WordPress connections support multiple arbitrary HTTPS sites and expose no passwords', async t => {
  const f = await fixture(t); const a = await f.connect(); const b = await f.connect('https://second.example/blog/');
  assert.equal(f.wp.status().connections.length, 2); assert.notEqual(a.id, b.id);
  assert.doesNotMatch(JSON.stringify(f.wp.status()), /protectedPassword|abcdefghijklmnopqrstuvwx|protected:/);
  const stored = f.store.db.prepare("SELECT value FROM settings WHERE key LIKE 'wordpress_connection:%'").all();
  assert.ok(stored.every(r => !r.value.includes(secret)));
  await f.connect(); assert.equal(f.wp.status().connections.length, 2);
  f.wp.disconnect(a.id); assert.deepEqual(f.wp.status().connections.map(c => c.id), [b.id]);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM tracked_sites').get().n, 1);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM api_calls').get().n, 0);
  f.store.close(); const reopened = await IntelligenceStore.open(f.root); t.after(() => reopened.close());
  assert.deepEqual(new WordPressStore(reopened, f.transport, secrets).status().connections.map(c => c.id), [b.id]);
});

test('only finished image bytes are uploaded, reused after restart, and replaced with destination URLs', async t => {
  const f = await fixture(t, 3); const c = await f.connect(); const plan = f.wp.plan(f.item.id, c.id);
  assert.equal(plan.images.length, 3); assert.equal(plan.html, null);
  const savedBefore = f.store.db.prepare('SELECT name,sha256 FROM artifacts ORDER BY name').all();
  for (const image of plan.images) await upload(f, c, plan, image);
  const posts = f.calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 3);
  for (let i = 0; i < posts.length; i++) {
    const original = f.store.db.prepare('SELECT id FROM artifacts WHERE name=?').get(plan.images[i].name);
    assert.ok(posts[i].body.includes(f.artifacts.read(original.id).data));
    assert.match(posts[i].contentType, /^multipart\/form-data; boundary=ri-/);
  }
  const ready = f.wp.plan(f.item.id, c.id); assert.equal(ready.ready, true);
  assert.doesNotMatch(ready.html, /Recipe source|food\.example/);
  assert.match(ready.html, /https:\/\/first.example\/wp-content\/uploads/); assert.doesNotMatch(ready.html, /data:image|<script|reference only/i);
  assert.match(ready.html, /wp-image-\d/); assert.match(ready.html, /<h[12]>/); assert.match(ready.html, /<ol>/);
  const restarted = new WordPressStore(f.store, f.transport, secrets);
  for (const image of plan.images) await restarted.upload(f.item.id, { connectionId: c.id, documentHash: plan.documentHash, sha256: image.sha256 });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 3);
  assert.deepEqual(f.store.db.prepare('SELECT name,sha256 FROM artifacts ORDER BY name').all(), savedBefore);
  const second = await f.connect('https://second.example/'); const secondPlan = f.wp.plan(f.item.id, second.id);
  assert.equal(secondPlan.ready, false);
  for (const image of secondPlan.images) await upload(f, second, secondPlan, image);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 6);
  assert.doesNotMatch(f.wp.plan(f.item.id, second.id).html, /first.example/);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM api_calls').get().n, 0);
});

test('duplicate images and simultaneous export requests make a single media upload', async t => {
  const f = await fixture(t, 1); const c = await f.connect();
  const a = f.store.db.prepare("SELECT id FROM artifacts WHERE name='article.html'").get(); const html = f.artifacts.read(a.id).data.toString();
  const tag = html.match(/<figure>.*?<\/figure>/)[0]; f.artifacts.put(f.item, 'article.html', html.replace('</article>', tag + '</article>'), 'text/html');
  const p = f.wp.plan(f.item.id, c.id); assert.equal(p.images.length, 1);
  await Promise.all([upload(f, c, p, p.images[0]), upload(f, c, p, p.images[0])]);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal((f.wp.plan(f.item.id, c.id).html.match(/wp-image-1/g) || []).length, 2);
});

test('uncertain uploads reconcile by stable slug without retrying POST, while other images continue', async t => {
  const f = await fixture(t); const c = await f.connect(); const p = f.wp.plan(f.item.id, c.id);
  f.behavior.timeout = true; await assert.rejects(upload(f, c, p, p.images[0]), /could not be confirmed/);
  f.behavior.timeout = false; await upload(f, c, p, p.images[1]);
  assert.equal(f.wp.plan(f.item.id, c.id).ready, false);
  await upload(f, c, p, p.images[0]); assert.equal(f.wp.plan(f.item.id, c.id).ready, true);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});

test('an unknown upload with no remote match never repeats automatically', async t => {
  const f = await fixture(t, 1); const c = await f.connect(); const p = f.wp.plan(f.item.id, c.id);
  f.behavior.timeout = true; f.behavior.dropUpload = true;
  await assert.rejects(upload(f, c, p, p.images[0]), /could not be confirmed/);
  await assert.rejects(upload(f, c, p, p.images[0]), /uncertain outcome/);
  await assert.rejects(upload(f, c, p, p.images[0]), /uncertain outcome/);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});

test('saved upload receipts repair a missing database result without a new network request', async t => {
  const f = await fixture(t, 1); const c = await f.connect(); const p = f.wp.plan(f.item.id, c.id); await upload(f, c, p, p.images[0]);
  f.store.db.prepare("UPDATE wordpress_media SET state='uncertain',media_id=NULL,source_url=NULL").run();
  const recovered = new WordPressStore(f.store, async () => { throw new Error('Network must not be needed'); }, secrets);
  await recovered.upload(f.item.id, { connectionId: c.id, documentHash: p.documentHash, sha256: p.images[0].sha256 });
  assert.equal(recovered.plan(f.item.id, c.id).ready, true);
  const receipt = f.store.db.prepare('SELECT receipt_path FROM wordpress_media').get().receipt_path;
  assert.doesNotMatch(fs.readFileSync(path.join(f.root, receipt), 'utf8'), /Authorization|abcdefghijklmnopqrstuvwx/);
});

test('known refused uploads are retryable without repeating successful uploads', async t => {
  const f = await fixture(t); const c = await f.connect(); const p = f.wp.plan(f.item.id, c.id);
  f.behavior.rejectUpload = true; await assert.rejects(upload(f, c, p, p.images[0]), /HTTP 413/);
  f.behavior.rejectUpload = false; await upload(f, c, p, p.images[1]); await upload(f, c, p, p.images[0]);
  assert.equal(f.wp.plan(f.item.id, c.id).ready, true); assert.equal(f.calls.filter(c => c.method === 'POST').length, 3);
});

test('WordPress exports reject reference images, external URLs, stale article versions and foreign image IDs', async t => {
  const f = await fixture(t, 1); const c = await f.connect(); const p = f.wp.plan(f.item.id, c.id); const before = f.calls.length;
  await assert.rejects(f.wp.upload(f.item.id, { connectionId: c.id, documentHash: p.documentHash, sha256: 'x' }), /saved article/);
  await assert.rejects(f.wp.upload(f.item.id, { connectionId: c.id, documentHash: 'old', sha256: p.images[0].sha256 }), /article changed/);
  assert.equal(f.calls.length, before);
  f.artifacts.put(f.item, 'article.html', '<article><img src="https://competitor.example/original.jpg"></article>', 'text/html');
  assert.throws(() => f.wp.plan(f.item.id, c.id), /saved edited JPEG/);
  const other = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).jpeg().toBuffer();
  f.artifacts.put(f.item, 'article.html', '<article><img src="data:image/jpeg;base64,' + other.toString('base64') + '"></article>', 'text/html');
  assert.throws(() => f.wp.plan(f.item.id, c.id), /Only saved generated or edited/);
});

test('unsafe destinations and credentials fail before requests; authentication errors are redacted', async t => {
  for (const url of ['http://site.example','https://127.0.0.1','https://10.1.2.3','https://user:pass@site.example','https://site.example:444','https://site.example/wp-admin/','https://site.example/?query=1']) assert.throws(() => wordpressSite(url));
  assert.equal(wordpressSite('example.com/blog'), 'https://example.com/blog/');
  const f = await fixture(t, 0);
  await assert.rejects(f.wp.connect({ siteUrl: 'https://first.example', username: 'owner:bad', applicationPassword: secret }), /username/);
  await assert.rejects(f.wp.connect({ siteUrl: 'https://first.example', username: 'owner', applicationPassword: 'login-password' }), /Application Password/);
  assert.equal(f.calls.length, 0);
  const wp = new WordPressStore(f.store, async () => json({ error: secret }, 401), secrets);
  await assert.rejects(wp.connect({ siteUrl: 'https://first.example', username: 'owner', applicationPassword: secret }), e => !e.message.includes(secret) && /denied access/.test(e.message));
  assert.equal(wp.status().connections.length, 0);
  const redirected = new WordPressStore(f.store, async () => json({}, 302), secrets);
  await assert.rejects(redirected.connect({ siteUrl: 'https://first.example', username: 'owner', applicationPassword: secret }), /redirected/);
});

test('version 4 migration backs up existing articles and adds an independent WordPress ledger', async t => {
  const f = await fixture(t, 1); const hashes = f.store.db.prepare('SELECT name,sha256 FROM artifacts ORDER BY name').all();
  f.store.db.exec('DROP TABLE wordpress_media; PRAGMA user_version=4'); f.store.close();
  const updated = await IntelligenceStore.open(f.root); t.after(() => updated.close());
  assert.equal(updated.db.pragma('user_version', { simple: true }), 5);
  assert.deepEqual(updated.db.prepare('SELECT name,sha256 FROM artifacts ORDER BY name').all(), hashes);
  const backup = fs.readdirSync(path.join(f.root, 'backups')).find(n => n.startsWith('before-migration-5'));
  assert.ok(backup); const db = new (require('better-sqlite3'))(path.join(f.root, 'backups', backup), { readonly: true });
  try { assert.equal(db.pragma('user_version', { simple: true }), 4); assert.deepEqual(db.prepare('SELECT name,sha256 FROM artifacts ORDER BY name').all(), hashes); } finally { db.close(); }
});

test('Windows credentials survive a DPAPI round trip without storing plaintext', { skip: process.platform !== 'win32' }, async () => {
  const protectedValue = await windowsSecrets.protect(secret); assert.ok(!protectedValue.includes(secret));
  assert.equal(await windowsSecrets.unprotect(protectedValue), secret);
});

test('WordPress transport pins public DNS results, retains TLS verification and never follows redirects', async t => {
  const https = require('node:https'); const { EventEmitter } = require('node:events');
  const fetchModule = require('../.intelligence-build/lib/recipe-intelligence/fetch.js');
  const { wordpressRequest } = require('../.intelligence-build/lib/recipe-intelligence/wordpress-http.js');
  const previousRequest = https.request, previousResolve = fetchModule.resolvePublic;
  t.after(() => { https.request = previousRequest; fetchModule.resolvePublic = previousResolve; });
  const addresses = [{ address: '93.184.216.34', family: 4 }]; const calls = [];
  fetchModule.resolvePublic = async hostname => { assert.equal(hostname, 'first.example'); return addresses; };
  https.request = (url, options, callback) => {
    calls.push({ url, options }); const req = new EventEmitter();
    req.end = () => queueMicrotask(() => { const response = new EventEmitter(); response.statusCode = 302; response.headers = { location: 'https://other.example/' }; callback(response); response.emit('data', Buffer.from('{}')); response.emit('end'); req.emit('close'); });
    req.destroy = error => { req.emit('error', error); req.emit('close'); }; return req;
  };
  const response = await wordpressRequest('https://first.example/wp-json/wp/v2/media', { method: 'POST', authorization: 'Basic fixture', body: Buffer.from('fixture') });
  assert.equal(response.status, 302); assert.equal(calls.length, 1); assert.equal(calls[0].url.hostname, 'first.example');
  assert.notEqual(calls[0].options.rejectUnauthorized, false); assert.equal(calls[0].options.agent, false);
  calls[0].options.lookup('first.example', { all: true }, (error, selected) => { assert.equal(error, null); assert.equal(selected, addresses); });
  await assert.rejects(wordpressRequest('http://first.example', { method: 'GET' }), /HTTPS/);
  await assert.rejects(wordpressRequest('https://127.0.0.1', { method: 'GET' }), /public HTTP/);
});
