const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { contentFixture, article } = require('./helpers/content-fixtures.cjs');
const { losslessImage, IMAGE_STORAGE_VERSION } = require('../.intelligence-build/lib/recipe-intelligence/imageStorage.js');
const { ImportStore } = require('../.intelligence-build/lib/recipe-intelligence/imports.js');
const { DEFAULT_CONTENT_SETTINGS } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');
const sample = path.join(__dirname, 'fixtures/approved-recipe-photos/08-skillet-approved.jpg');
const pixels = b => sharp(b, { ignoreIcc: true }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
async function identical(a, b) {
  const x = await pixels(a), y = await pixels(b);
  assert.deepEqual(x.info, y.info); assert.ok(x.data.equals(y.data), 'Every decoded colour and alpha sample is unchanged');
}

test('lossless WebP preserves every pixel and dimension of an approved photograph and is smaller', async () => {
  const png = await sharp(sample).png().toBuffer(), result = await losslessImage(png);
  assert.equal(result.extension, 'webp'); assert.equal(result.mediaType, 'image/webp');
  assert.ok(result.data.length < png.length); assert.equal(result.storage.pixelsVerified, true);
  await identical(png, result.data);
});

test('lossless storage preserves alpha and colour profiles and keeps unsupported 16-bit data intact', async () => {
  const translucent = await sharp({ create: { width: 100, height: 70, channels: 4, background: '#126d9c80' } }).png().toBuffer();
  const alpha = await losslessImage(translucent); await identical(translucent, alpha.data);
  const profile = await sharp(sample).withIccProfile('p3').png().toBuffer();
  const profiled = await losslessImage(profile); await identical(profile, profiled.data);
  assert.deepEqual((await sharp(profile).metadata()).icc, (await sharp(profiled.data).metadata()).icc);
  const sixteen = await sharp(sample).toColourspace('rgb16').png().toBuffer();
  assert.equal((await sharp(sixteen).metadata()).depth, 'ushort');
  const retained = await losslessImage(sixteen); assert.ok(retained.data.equals(sixteen)); assert.equal(retained.storage.converted, false);
  await assert.rejects(losslessImage(Buffer.from('not an image')));
  await assert.rejects(losslessImage(profile.subarray(0, 200)));
});

test('small originals and existing WebP are retained instead of increasing storage', async () => {
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).webp({ lossless: true }).toBuffer();
  const result = await losslessImage(tiny); assert.ok(result.data.equals(tiny)); assert.equal(result.storage.converted, false);
});

test('new reference jobs save one lossless master; PNG downloads, HTML and ZIP reuse it without paid calls', async t => {
  const f = await contentFixture(t), imports = new ImportStore(f.store), imported = imports.create();
  await imports.add(imported.id, fs.readFileSync(sample), 'photo.jpg');
  imports.select(imported.id, imports.detail(imported.id).photos.filter(p => p.state === 'ready').map(p => p.id));
  const b = f.batches.create([{ importId: imported.id }], { ...DEFAULT_CONTENT_SETTINGS, output: 'images_only' });
  const item = f.batches.item(b.items[0].id), photo = b.items[0].photos[0];
  assert.equal(JSON.parse(item.config_json).imageStorage, IMAGE_STORAGE_VERSION);
  const png = await sharp(sample).png().toBuffer();
  await f.batches.artifacts.referenceImage(item, photo, png.toString('base64'), 'Saved prompt');
  const images = f.batches.detail(b.id).items[0].files.filter(f => f.media_type.startsWith('image/'));
  assert.equal(images.length, 1); assert.match(images[0].name, /\.webp$/);
  const master = f.batches.artifacts.read(images[0].id);
  const before = f.store.db.prepare('SELECT * FROM artifacts ORDER BY id').all();
  const download = await f.batches.artifacts.download(master.id, 'png');
  assert.match(download.name, /\.png$/); assert.equal(download.media_type, 'image/png');
  await identical(png, download.data);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM artifacts ORDER BY id').all(), before);
  await assert.rejects(f.batches.artifacts.download(master.id, 'jpeg'), /has not passed metadata verification/);
  const seeded = f.seed(), recipe = JSON.parse(f.store.db.prepare('SELECT recipe_json FROM recipe_records WHERE id=?').get(seeded.id).recipe_json);
  f.store.db.prepare('UPDATE content_photos SET analysis_json=? WHERE item_id=?').run(JSON.stringify({ placement: 'hero', visibleFood: 'Soup' }), item.id);
  f.batches.artifacts.article(item, article(), recipe);
  const row = f.store.db.prepare("SELECT id FROM artifacts WHERE item_id=? AND name='article.html'").get(item.id);
  const html = f.batches.artifacts.read(row.id).data.toString();
  assert.ok(html.includes(`src="${master.name}"`)); assert.ok(!html.includes('base64,'));
  const standalone = await f.batches.artifacts.download(row.id);
  assert.ok(standalone.data.includes(Buffer.from('data:image/webp;base64,' + master.data.toString('base64'))));
  assert.ok((await f.batches.artifacts.zip(item)).includes(Buffer.from(master.name)));
  assert.equal(f.providerCalls.length, 0);
  const result = JSON.parse(f.store.db.prepare("SELECT result_json FROM content_stages WHERE item_id=? AND kind LIKE 'photo:%'").get(item.id).result_json);
  assert.equal(result.storage.pixelsVerified, true);
});

test('unsupported replacement format is blocked and previous artifact versions survive', async t => {
  const f = await contentFixture(t), r = f.seed(), b = f.batches.create([{ recipeId: r.id }], f.defaults);
  let item = f.batches.item(b.items[0].id);
  // Simulate a native-format change on a reference photo after a versioned retry.
  const photo = { reference_id: '11111111-1111-1111-1111-111111111111' };
  const png = await sharp(sample).png().toBuffer();
  await f.batches.artifacts.referenceImage(item, photo, png.toString('base64'), 'first');
  const old = f.batches.detail(b.id).items[0].files.find(f => f.name.endsWith('.webp'));
  const oldPath = f.batches.artifacts.read(old.id).relative_path;
  f.batches.artifacts.forkVersion(item); item = f.batches.item(item.id);
  const deep = await sharp(sample).toColourspace('rgb16').png().toBuffer();
  await assert.rejects(f.batches.artifacts.referenceImage(item, photo, deep.toString('base64'), 'second'), /cannot preserve every pixel and the source bit depth/);
  const files = f.batches.detail(b.id).items[0].files.filter(f => f.media_type.startsWith('image/'));
  assert.equal(files.length, 1); assert.match(files[0].name, /\.webp$/);
  assert.ok(fs.existsSync(path.join(f.root, oldPath)), 'Previous version remains recoverable');
  await identical(f.batches.artifacts.read(files[0].id).data, png);
});

test('an older text-image batch repairs into verified output without another provider call', async t => {
  const f = await contentFixture(t), r = f.seed(), b = f.batches.create([{ recipeId: r.id }], f.defaults);
  const settings = { ...b.settings }; delete settings.imageStorage;
  f.store.db.prepare('UPDATE content_batches SET settings_json=? WHERE id=?').run(JSON.stringify(settings), b.id);
  const item = f.batches.item(b.items[0].id);
  await f.batches.artifacts.image(item, 'featured', f.image.toString('base64'));
  const images = f.batches.detail(b.id).items[0].files.filter(f => f.media_type.startsWith('image/'));
  assert.deepEqual(images.map(f => f.name), ['featured.webp']);
  assert.equal((await sharp(f.batches.artifacts.read(images[0].id).data).metadata()).format, 'webp');
  assert.equal(images[0].metadataVerified, true);
  assert.equal(f.providerCalls.length, 0);
});
