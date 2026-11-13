const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { cleanImageMetadata, runExifTool, imagePayload, EXIFTOOL_VERSION } = require('../.intelligence-build/lib/imageMetadata.js');
const { prepareImage, readVerifiedImage, verifiedImage, retryImage } = require('../.intelligence-build/lib/verifiedImages.js');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-metadata-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
async function inspect(file) { return JSON.parse((await runExifTool(['-j', '-G1', '-a', '-n', file])).toString())[0]; }
async function fixture(t, format, alpha = false) {
  const dir = temp(t), file = path.join(dir, 'image.' + format);
  let input = sharp({ create: { width: 21, height: 13, channels: alpha ? 4 : 3, background: {r:34,g:120,b:220,alpha:0.4} } }).withIccProfile('p3').withMetadata({ orientation: 6 });
  fs.writeFileSync(file, await input[format](format === 'webp' ? { lossless: true } : {}).toBuffer());
  await runExifTool(['-overwrite_original', '-GPSLatitude=35.5', '-GPSLongitude=-6.5', '-BodySerialNumber=private-123', '-Software=Test generator', '-XMP-xmp:CreatorTool=Generator 1', '-DateTimeOriginal=2025:01:02 03:04:05', '-UserComment=optional comment', '-Copyright=Copyright Example Studio', '-XMP-dc:Creator=Example Studio', '-XMP-photoshop:Credit=Example Studio', file]);
  return { file, bytes: fs.readFileSync(file), dir };
}
for (const [format, alpha] of [['jpeg',false],['png',true],['webp',true]]) test('ExifTool cleans ' + format + ' without changing pixels, transparency, orientation, ICC or attribution', async t => {
  const f = await fixture(t, format, alpha), before = await sharp(f.bytes).metadata();
  const out = await cleanImageMetadata(f.bytes), after = await sharp(out.data).metadata();
  assert.equal(out.report.toolVersion, EXIFTOOL_VERSION); assert.equal(out.report.state, 'verified');
  assert.deepEqual(fs.readFileSync(f.file), f.bytes, 'original unchanged');
  assert.equal(imagePayload(f.bytes, format), imagePayload(out.data, format), 'compressed payload is byte-identical');
  assert.equal(after.orientation, 6); assert.equal(after.width, 21); assert.equal(after.height, 13);
  assert.equal(after.hasAlpha, before.hasAlpha); assert.deepEqual(after.icc, before.icc);
  fs.writeFileSync(path.join(f.dir, 'clean.'+format), out.data);
  const tags = await inspect(path.join(f.dir, 'clean.'+format));
  for (const key of Object.keys(tags)) assert.doesNotMatch(key, /GPS|SerialNumber|UserComment|Software|CreatorTool|DateTimeOriginal/);
  assert.equal(tags['IFD0:Copyright'], 'Copyright Example Studio');
  assert.equal(tags['XMP-dc:Creator'], 'Example Studio');
  assert.equal(out.report.c2pa.present, false);
});
test('PNG generation details are removed, including common custom fields', async t => {
  const dir = temp(t), file = path.join(dir, 'input.png');
  fs.writeFileSync(file, await sharp({create:{width:4,height:4,channels:4,background:'#12345678'}}).png().toBuffer());
  const names = ['Prompt','NegativePrompt','Workflow','parameters','Seed','ModelName','ModelHash','Sampler','Steps','CFG','CFGScale'];
  await runExifTool(['-overwrite_original', ...names.map(n => '-PNG:'+n+'=private test'), file]);
  const original = fs.readFileSync(file), out = await cleanImageMetadata(original);
  assert.ok(out.report.removed.length >= names.length);
  assert.equal(out.data.includes(Buffer.from('private test')), false);
  assert.deepEqual(fs.readFileSync(file), original);
});
test('a metadata-free image is still reinspected and remains byte-identical', async () => {
  const original = await sharp({create:{width:7,height:5,channels:3,background:'#223344'}}).jpeg().toBuffer();
  const out = await cleanImageMetadata(original); assert.deepEqual(out.data, original); assert.deepEqual(out.report.removed, []);
});
test('failed preparation never exposes an original; retry works without regenerating', async t => {
  const root = temp(t), bytes = await sharp({create:{width:9,height:6,channels:4,background:'#11335588'}}).png().toBuffer();
  const saved = process.env.EXIFTOOL_PATH; process.env.EXIFTOOL_PATH = path.join(root, 'missing-exiftool');
  let failure;
  try { await prepareImage(bytes, { root }); } catch (e) { failure = e; }
  if (saved === undefined) delete process.env.EXIFTOOL_PATH; else process.env.EXIFTOOL_PATH = saved;
  assert.ok(failure?.assetId); assert.throws(() => verifiedImage(bytes, root), /not verified/);
  assert.throws(() => readVerifiedImage(failure.assetId, root));
  const ready = await retryImage(failure.assetId, root); assert.deepEqual(readVerifiedImage(ready.id, root).data, bytes);
});
test('each final format is verified and cached; corruption blocks access', async t => {
  const root = temp(t), bytes = await sharp({create:{width:9,height:6,channels:4,background:'#11335588'}}).png().toBuffer();
  const ready = await prepareImage(bytes, { root, formats:['png','webp'] });
  for (const format of ['png','webp']) assert.equal(readVerifiedImage(ready.variants[format], root).format, format);
  const again = await prepareImage(bytes, { root, formats:['png','webp'] }); assert.equal(again.verifiedAt, ready.verifiedAt);
  await prepareImage(bytes, { root });
  assert.equal(readVerifiedImage(ready.id, root).variants.webp, ready.variants.webp, 'a narrower request retains prepared variants');
  fs.appendFileSync(path.join(root,'verified-images','outputs',ready.id), 'damage');
  assert.throws(() => readVerifiedImage(ready.id, root), /checksum/);
});
function chunk(type, payload) {
  const b = Buffer.alloc(payload.length+12); b.writeUInt32BE(payload.length); b.write(type,4); payload.copy(b,8);
  let crc=0xffffffff; for(const value of b.subarray(4,-4)) { crc^=value; for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); } b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4); return b;
}
const pngChunk = (png, type, data) => Buffer.concat([png.subarray(0,33),chunk(type,data),png.subarray(33)]);
test('unsupported optional metadata blocks preparation instead of claiming success', async t => {
  const root=temp(t), png=await sharp({create:{width:5,height:3,channels:3,background:'#123456'}}).png().toBuffer();
  const bytes=pngChunk(png,'tEXt',Buffer.from('private_workflow\0keep-private-data'));
  await assert.rejects(prepareImage(bytes,{root}),/ExifTool|Unsupported|remaining metadata/);
  assert.throws(()=>verifiedImage(bytes,root),/not verified/);
});
test('a comment containing required attribution is reported as a conflict and is preserved privately', async t => {
  const root=temp(t), png=await sharp({create:{width:5,height:3,channels:3,background:'#123456'}}).png().toBuffer();
  const bytes=pngChunk(png,'tEXt',Buffer.from('Comment\0Copyright Example Studio'));
  await assert.rejects(prepareImage(bytes,{root}),/attribution/);
  const dirs=fs.readdirSync(path.join(root,'verified-images','private'));
  assert.deepEqual(fs.readFileSync(path.join(root,'verified-images','private',dirs[0],'original')),bytes);
});
function c2paFixture(claim = {test_claim:'fixture only, not a signed assertion'}) {
  const box=(type,payload)=>{ const b=Buffer.alloc(payload.length+8); b.writeUInt32BE(b.length); b.write(type,4); payload.copy(b,8); return b; };
  const descriptor=Buffer.concat([Buffer.from('6332706100110010800000aa00389b71','hex'),Buffer.from([3]),Buffer.from('c2pa\0')]);
  return box('jumb',Buffer.concat([box('jumd',descriptor),box('json',Buffer.from(JSON.stringify(claim)))]));
}
test('generic provider claim filename is not attribution; real titles and credits remain protected', async t => {
  const png=await sharp({create:{width:5,height:3,channels:3,background:'#123456'}}).png().toBuffer();
  const bytes=pngChunk(png,'caBX',c2paFixture({title:'image.png'}));
  const out=await cleanImageMetadata(bytes);
  assert.equal(out.report.c2pa.action,'removed');
  assert.equal(imagePayload(bytes,'png'),imagePayload(out.data,'png'));
  for(const claim of [{title:'A photographer’s original work'},{copyright:'Copyright Example Studio'},{title:'image.png',credit:'Example Studio'}]) {
    await assert.rejects(cleanImageMetadata(pngChunk(png,'caBX',c2paFixture(claim))),/attribution/);
  }
});
for (const format of ['png','jpeg','webp']) test('C2PA is removed from '+format+' copies and independently verified', async t => {
  const manifest=c2paFixture();
  const original=await sharp({create:{width:5,height:3,channels:format==='jpeg'?3:4,background:'#12345688'}}).withIccProfile('p3').withMetadata({orientation:6})[format](format==='webp'?{lossless:true}:{}).toBuffer();
  let bytes;
  if(format==='png')bytes=pngChunk(pngChunk(original,'caBX',manifest),'tEXt',Buffer.from('Software\0Fixture generator'));
  else if(format==='jpeg') {const payload=Buffer.concat([Buffer.from('4a50000100000001','hex'),manifest]);const header=Buffer.alloc(4);header.writeUInt16BE(0xffeb);header.writeUInt16BE(payload.length+2,2);bytes=Buffer.concat([original.subarray(0,2),header,payload,original.subarray(2)]);}
  else {const header=Buffer.alloc(8);header.write('C2PA');header.writeUInt32LE(manifest.length,4);bytes=Buffer.concat([original,header,manifest,Buffer.alloc(manifest.length%2)]);bytes.writeUInt32LE(bytes.length-8,4);}
  const preserved=Buffer.from(bytes);
  const out=await cleanImageMetadata(bytes);
  assert.equal(out.report.c2pa.present,false); assert.equal(out.report.c2pa.detectedBefore,true); assert.equal(out.report.c2pa.action,'removed');
  assert.equal(out.report.c2pa.signatureValidity,'not-validated'); assert.equal(out.data.includes(manifest),false);
  assert.deepEqual(bytes,preserved); assert.equal(imagePayload(bytes,format),imagePayload(out.data,format));
  assert.equal(out.data.includes(Buffer.from('Fixture generator')),false);
  const root=temp(t),ready=await prepareImage(bytes,{root,formats:['png','webp']});
  for(const id of Object.values(ready.variants)){const saved=readVerifiedImage(id,root);assert.equal(saved.c2pa.present,false);assert.equal(saved.c2pa.action,'removed');assert.equal(saved.data.includes(manifest),false);}
});

test('external C2PA manifest references are removed without fetching their URLs', async t => {
  const file=path.join(temp(t),'external.png'); fs.writeFileSync(file,await sharp({create:{width:3,height:3,channels:3,background:'#abc'}}).png().toBuffer());
  await runExifTool(['-overwrite_original','-XMP-dcterms:Provenance=https://credentials.example/private/manifest',file]);
  const out=await cleanImageMetadata(fs.readFileSync(file));assert.equal(out.report.c2pa.action,'removed');assert.equal(out.report.c2pa.present,false);assert.equal(out.data.includes(Buffer.from('credentials.example')),false);
});

test('a prior C2PA-preserving receipt cannot bypass the new removal policy', async t => {
  const root=temp(t),bytes=await sharp({create:{width:4,height:4,channels:3,background:'#abc'}}).png().toBuffer();
  const ready=await prepareImage(bytes,{root}),file=path.join(root,'verified-images/proofs',ready.id+'.json');
  const stale=JSON.parse(fs.readFileSync(file));stale.policy='optional-metadata-v2';fs.writeFileSync(file,JSON.stringify(stale));
  assert.throws(()=>readVerifiedImage(ready.id,root),/stale/);
});
