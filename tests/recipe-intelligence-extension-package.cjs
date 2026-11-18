const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {buildCaptureExtensionPackage}=require('../.intelligence-build/lib/recipe-intelligence/extensionPackage.js');
function readStoredEntries(bytes) {
  const entries=new Map();let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset+8),0);
    const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString();
    const start=offset+30+nameLength+extra;assert.ok(start+size<=bytes.length);assert.equal(entries.has(name),false);
    entries.set(name,bytes.subarray(start,start+size));offset=start+size;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);return entries;
}
test('extension download contains only installable source files, with valid flat paths and no local configuration',async()=>{
  const archive=await buildCaptureExtensionPackage(),entries=readStoredEntries(archive.bytes);
  const expected=['manifest.json','background.js','capture.html','capture.css','capture.js','connection.js','content.js','shared.js','page-tools.js','prepare.js','readme.md','icon16.png','icon48.png','icon128.png'];
  assert.deepEqual([...entries.keys()].sort(),expected.sort());
  assert.equal(archive.version,'2.8.0');assert.equal(archive.filename,'recipe-intelligence-capture.zip');
  const manifest=JSON.parse(entries.get('manifest.json').toString());assert.equal(manifest.version,archive.version);
  assert.equal(manifest.content_scripts,undefined);assert.equal(manifest.externally_connectable,undefined);
  for(const [size,name] of Object.entries(manifest.icons)){
    assert.ok(entries.has(name));assert.equal(manifest.action.default_icon[size],name);
    const image=await require('sharp')(entries.get(name)).metadata();assert.equal(image.width,Number(size));
  }
  const html=entries.get('capture.html').toString();
  for(const [,name] of html.matchAll(/(?:src|href)="([a-z-]+\.(?:js|css))"/g)) assert.ok(entries.has(name),name);
  assert.ok(entries.has(manifest.background.service_worker));
  const original=fs.readFileSync(path.join(__dirname,'../extensions/recipe-intelligence-capture/manifest.json'),'utf8');
  assert.equal(JSON.parse(original).icons['16'],'icons/icon16.png','Packaging must not modify the unpacked installation');
  assert.ok(!Object.keys(require.cache).some(file=>file.includes('better-sqlite3')),'Download must not load the local database');
});
