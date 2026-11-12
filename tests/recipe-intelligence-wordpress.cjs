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
    const type = /Content-Type: (image\/(?:jpeg|png|webp))\r\n/.exec(init.body.toString())[1];
    const media = { id: nextId++, slug, source_url: u.origin + '/wp-content/uploads/' + slug + (type === 'image/jpeg' ? '.jpg' : '.' + type.split('/')[1]), mime_type: type };
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
const uploadedWebP = post => {
  const header = Buffer.from('Content-Type: image/webp\r\n\r\n');
  const start = post.body.indexOf(header); assert.ok(start >= 0, 'upload MIME type is WebP');
  assert.match(post.body.subarray(0, start).toString(), /filename="ri-[a-f0-9]+\.webp"/);
  return post.body.subarray(start + header.length, post.body.lastIndexOf(Buffer.from('\r\n--')));
};
async function samePixels(a, b) {
  const decode = bytes => sharp(bytes, { ignoreIcc: true }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const before = await decode(a), after = await decode(b);
  assert.deepEqual(after.info, before.info); assert.ok(after.data.equals(before.data), 'all decoded pixels are identical');
  const x = await sharp(a).metadata(), y = await sharp(b).metadata();
  assert.deepEqual(x.icc, y.icc); assert.equal(y.format, 'webp');
}

test('lossless WebP uploads keep exact bytes, extension, featured order and receipt reuse', async t => {
  const f = await fixture(t, 0), c = await f.connect();
  const source = JSON.parse(f.item.source_json);
  const bytes = await sharp({ create: { width: 80, height: 50, channels: 4, background: '#44556680' } }).webp({ lossless: true }).toBuffer();
  f.artifacts.put(f.item, 'featured.webp', bytes, 'image/webp');
  f.artifacts.put(f.item, 'alternate.webp', bytes, 'image/webp');
  f.artifacts.article(f.item, article(), source);
  const plan = f.wp.plan(f.item.id, c.id);
  assert.equal(plan.images.length, 1, 'identical masters under two names share one upload');
  assert.equal(plan.images[0].name, 'featured.webp');
  await upload(f, c, plan, plan.images[0]);
  const posts = f.calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 1);
  assert.ok(posts[0].body.includes(bytes));
  assert.match(posts[0].body.toString(), /filename="ri-[a-f0-9]+\.webp"\r\nContent-Type: image\/webp/);
  const ready = f.wp.plan(f.item.id, c.id); assert.equal(ready.ready, true);
  assert.equal((ready.html.match(/src="https:[^"]+\.webp"/g) || []).length, 2);
  assert.deepEqual(ready.mediaIds, [1]);
  await upload(f, c, plan, plan.images[0]); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  const newer = await sharp({ create: { width: 80, height: 50, channels: 3, background: '#bb8877' } }).webp({ lossless: true }).toBuffer();
  f.artifacts.put(f.item, 'featured.webp', newer, 'image/webp');
  assert.notEqual(f.wp.plan(f.item.id, c.id).documentHash, plan.documentHash, 'same filename with new pixels invalidates the reviewed export');
  await assert.rejects(upload(f, c, plan, plan.images[0]), /article changed/);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(f.providerCalls.length, 0);
});

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

test('finished images upload as lossless WebP, reuse uploads after restart, and retain local originals', async t => {
  const f = await fixture(t, 3); const c = await f.connect(); const plan = f.wp.plan(f.item.id, c.id);
  assert.equal(plan.images.length, 3); assert.equal(plan.html, null);
  const savedBefore = f.store.db.prepare('SELECT name,sha256 FROM artifacts ORDER BY name').all();
  for (const image of plan.images) await upload(f, c, plan, image);
  const posts = f.calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 3);
  for (let i = 0; i < posts.length; i++) {
    const original = f.store.db.prepare('SELECT id FROM artifacts WHERE name=?').get(plan.images[i].name);
    await samePixels(f.artifacts.read(original.id).data, uploadedWebP(posts[i]));
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

test('older inline JPEG and PNG articles upload WebP even when the lossless file is larger', async t => {
  const f = await fixture(t, 0), c = await f.connect();
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/approved-recipe-photos/08-skillet-approved.jpg'));
  const png = await sharp(photo).withIccProfile('p3').png().toBuffer();
  f.artifacts.put(f.item, 'featured.jpg', photo, 'image/jpeg');
  f.artifacts.put(f.item, 'alternate.png', png, 'image/png');
  f.artifacts.put(f.item, 'article.html', `<article><img src="data:image/jpeg;base64,${photo.toString('base64')}"><img src="data:image/png;base64,${png.toString('base64')}"></article>`, 'text/html');
  const before = f.store.db.prepare('SELECT name,sha256,size_bytes FROM artifacts ORDER BY name').all();
  const p = f.wp.plan(f.item.id, c.id);
  for (const image of p.images) await upload(f, c, p, image);
  const posts = f.calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 2);
  const first = uploadedWebP(posts[0]); assert.ok(first.length > photo.length, 'WebP is required even if the old JPEG was smaller');
  await samePixels(photo, first); await samePixels(png, uploadedWebP(posts[1]));
  assert.deepEqual(f.store.db.prepare('SELECT name,sha256,size_bytes FROM artifacts ORDER BY name').all(), before);
  assert.equal((f.wp.plan(f.item.id, c.id).html.match(/\.webp"/g) || []).length, 2);
  const receiptRow = f.store.db.prepare('SELECT receipt_path FROM wordpress_media WHERE sha256=?').get(p.images[0].sha256);
  const receipt = JSON.parse(fs.readFileSync(path.join(f.root, receiptRow.receipt_path), 'utf8'));
  assert.equal(receipt.upload.sha256, digest(first)); assert.equal(receipt.upload.sourceSha256, digest(photo));
  assert.equal(receipt.upload.storage.pixelsVerified, true);
  assert.equal(f.providerCalls.length, 0);
});

test('non-lossless conversion is blocked without an upload or a lossy fallback; other images continue', async t => {
  const f = await fixture(t, 0), c = await f.connect();
  const image = sharp({ create: { width: 80, height: 50, channels: 3, background: '#124567' } });
  const deep = await image.clone().toColourspace('rgb16').png().toBuffer();
  const good = await image.clone().png().toBuffer();
  f.artifacts.put(f.item, 'featured.png', deep, 'image/png');
  f.artifacts.put(f.item, 'alternate.png', good, 'image/png');
  f.artifacts.put(f.item, 'article.html', '<article><img src="featured.png"><img src="alternate.png"></article>', 'text/html');
  const p = f.wp.plan(f.item.id, c.id);
  await assert.rejects(upload(f, c, p, p.images[0]), /cannot be exported as lossless WebP/);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM wordpress_media').get().n, 0);
  await upload(f, c, p, p.images[1]);
  await samePixels(good, uploadedWebP(f.calls.find(c => c.method === 'POST')));
  assert.equal(f.providerCalls.length, 0);
});

test('a pre-upgrade JPEG upload with uncertain outcome reconciles without creating a second attachment', async t => {
  const f = await fixture(t, 1), c = await f.connect(), p = f.wp.plan(f.item.id, c.id), image = p.images[0];
  const slug = `ri-${image.sha256}`;
  f.store.db.prepare("INSERT INTO wordpress_media(site_url,sha256,slug,state,updated_at) VALUES(?,?,?,'uncertain',?)").run(c.siteUrl, image.sha256, slug, new Date().toISOString());
  f.remote.set('https://first.example', [{ id: 12, slug, source_url: `https://first.example/uploads/${slug}.jpg`, mime_type: 'image/jpeg' }]);
  await upload(f, c, p, image);
  const restarted = new WordPressStore(f.store, async () => { throw new Error('Confirmed uploads must be reused'); }, secrets);
  await restarted.upload(f.item.id, { connectionId: c.id, documentHash: p.documentHash, sha256: image.sha256 });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(restarted.plan(f.item.id, c.id).ready, true);
  assert.deepEqual(restarted.plan(f.item.id, c.id).mediaIds, [12]);
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

test('featured-image selection follows article order rather than filenames or media upload order', async t => {
  const f = await fixture(t, 3), c = await f.connect(); const original = f.wp.plan(f.item.id, c.id);
  for (const image of original.images) await upload(f, c, original, image);
  const oldIds = f.wp.plan(f.item.id, c.id).mediaIds;
  const row = f.store.db.prepare("SELECT id FROM artifacts WHERE item_id=? AND name='article.html'").get(f.item.id);
  const html = f.artifacts.read(row.id).data.toString(); const figures = html.match(/<figure>[\s\S]*?<\/figure>/g);
  assert.equal(figures.length, 3);
  let index = 0; const order = [2, 0, 1];
  f.artifacts.put(f.item, 'article.html', html.replace(/<figure>[\s\S]*?<\/figure>/g, () => figures[order[index++]]), 'text/html');
  const reordered = f.wp.plan(f.item.id, c.id);
  assert.deepEqual(reordered.mediaIds, [oldIds[2], oldIds[0], oldIds[1]]);
  assert.equal(reordered.images[0].name, 'pinterest.jpg');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 3, 'existing media reused');
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
  assert.throws(() => f.wp.plan(f.item.id, c.id), /saved edited image/);
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

test('Site Token connections encrypt credentials, survive restart and upload WebP only through scoped bridge routes', async t => {
  const f = await fixture(t, 1), token = 'ri_' + 'b'.repeat(64), calls = [];
  const transport = async (url, options) => {
    calls.push({url,...options}); assert.equal(options.authorization, undefined);
    assert.equal(options.bridgeToken, token); assert.equal(options.userSlug, 'site-editor');
    assert.ok(new URL(url).pathname.startsWith('/wp-json/recipe-intelligence/v1/'));
    if (url.endsWith('/profile')) return json({ protocol:1,version:'1.1.0',revision:'a'.repeat(64),recipeCard:'builtin',recipeCardLabel:'Recipe Intelligence card',ready:true,canPublish:true,tokenAuth:true,user:{id:7,username:'editor-login',slug:'site-editor',displayName:'Site Editor'} });
    return f.transport(url, options);
  };
  const wp = new WordPressStore(f.store, transport, secrets);
  const input = {siteUrl:'https://first.example',authMethod:'bridge_token',siteToken:token,userSlug:'site-editor'};
  const c = (await wp.connect(input)).connections[0];
  assert.equal(c.username,'editor-login'); assert.equal(c.authMethod,'bridge_token');
  const stored = f.store.db.prepare("SELECT value FROM settings WHERE key LIKE 'wordpress_connection:%'").get().value;
  assert.ok(!stored.includes(token)); assert.ok(!JSON.stringify(wp.status()).includes(token));
  const plan = wp.plan(f.item.id,c.id); await wp.upload(f.item.id,{connectionId:c.id,documentHash:plan.documentHash,sha256:plan.images[0].sha256});
  const post = calls.find(c=>c.method==='POST'); assert.ok(post.url.endsWith('/recipe-intelligence/v1/media')); uploadedWebP(post);
  const restarted = new WordPressStore(f.store,transport,secrets); await restarted.sync(c.id);
  assert.equal(restarted.plan(f.item.id,c.id).ready,true); await restarted.connect(input);
  assert.equal(restarted.status().connections.length,1); assert.equal(calls.filter(c=>c.method==='POST').length,1);
  assert.equal(f.providerCalls.length,0);
});

test('invalid tokens, unauthorized users and remote error bodies never leak credentials or replace a working connection', async t => {
  const f = await fixture(t,0), before = await f.connect(), token='ri_'+'c'.repeat(64);
  const input={siteUrl:'https://first.example',authMethod:'bridge_token',siteToken:token,userSlug:'owner'};
  let count=0;
  const wp = new WordPressStore(f.store,async()=>{count++;return json({code:'ri_invalid_token',message:token},401)},secrets);
  await assert.rejects(wp.connect({...input,siteToken:'another-plugin-key'}),/complete Site Token/);
  await assert.rejects(wp.connect({...input,userSlug:'owner\r\ninjection'}),/User Slug/); assert.equal(count,0);
  await assert.rejects(wp.connect(input),e=>/Site Token was rejected/.test(e.message)&&!e.message.includes(token));
  assert.equal(wp.status().connections[0].id,before.id); assert.equal(wp.status().connections[0].authMethod,'application_password');
  for (const [code,expected] of [['ri_user_forbidden',/User Slug is not authorized/],['rest_not_logged_in',/Authorization header/],['incorrect_password',/rejected the Application Password/],['application_passwords_disabled',/disabled Application Passwords/],[token,/denied access/]]) {
    const rejected = new WordPressStore(f.store,async()=>json({code,message:token,data:{private:secret}},403),secrets);
    await assert.rejects(rejected.connect(input),e=>expected.test(e.message)&&!e.message.includes(token)&&!e.message.includes(secret));
  }
});

test('version 4 migration backs up existing articles and adds an independent WordPress ledger', async t => {
  const f = await fixture(t, 1); const hashes = f.store.db.prepare('SELECT name,sha256 FROM artifacts ORDER BY name').all();
  f.store.db.exec('DROP TABLE r2_deleted_paths; DROP TABLE r2_objects; DROP TABLE wordpress_exports; DROP TABLE wordpress_media; PRAGMA user_version=4'); f.store.close();
  const updated = await IntelligenceStore.open(f.root); t.after(() => updated.close());
  assert.equal(updated.db.pragma('user_version', { simple: true }), 7);
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
  const token = 'ri_'+'d'.repeat(64);
  await wordpressRequest('https://first.example/wp-json/recipe-intelligence/v1/profile', {method:'GET',bridgeToken:token,userSlug:'owner'});
  assert.equal(calls[1].options.headers['X-Recipe-Intelligence-Key'],token);
  assert.equal(calls[1].options.headers['X-Recipe-Intelligence-User'],'owner');
  assert.equal(calls[1].options.headers.Authorization,undefined);
  await assert.rejects(wordpressRequest('https://first.example/wp-json/wp/v2/users/me',{method:'GET',bridgeToken:token,userSlug:'owner'}),/only be sent to Recipe Intelligence Bridge/);
  await assert.rejects(wordpressRequest('https://first.example/wp-json/recipe-intelligence/v1/profile',{method:'GET',bridgeToken:token,userSlug:'owner\r\ninjected'}),/Invalid WordPress bridge credentials/);
  calls[0].options.lookup('first.example', { all: true }, (error, selected) => { assert.equal(error, null); assert.equal(selected, addresses); });
  await assert.rejects(wordpressRequest('http://first.example', { method: 'GET' }), /HTTPS/);
  await assert.rejects(wordpressRequest('https://127.0.0.1', { method: 'GET' }), /public HTTP/);
});
