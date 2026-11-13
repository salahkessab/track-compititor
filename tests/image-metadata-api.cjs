const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),sharp=require('sharp');
function route(name){
  const filename=path.join(__dirname,'../app/api',name,'route.ts'),module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',code)(id=>id.startsWith('@/lib/')?require(path.join(__dirname,'../.intelligence-build/lib',id.slice(6)+'.js')):require(id),module,module.exports);
  return module.exports;
}
test('origin validation handles Next internal localhost routing without allowing a foreign origin',()=>{
  const { imageRequestAllowed }=require('../.intelligence-build/lib/imageFinalization.js');
  const previous=process.env.RECIPE_INTELLIGENCE_ORIGIN; process.env.RECIPE_INTELLIGENCE_ORIGIN='http://127.0.0.1:55543';
  try {
    assert.equal(imageRequestAllowed(new Request('http://localhost:55543/api/image-assets',{headers:{host:'127.0.0.1:55543',origin:'http://127.0.0.1:55543'}})),true);
    assert.equal(imageRequestAllowed(new Request('http://localhost:55543/api/image-assets',{headers:{host:'127.0.0.1:55543',origin:'https://foreign.example'}})),false);
  } finally {if(previous===undefined)delete process.env.RECIPE_INTELLIGENCE_ORIGIN;else process.env.RECIPE_INTELLIGENCE_ORIGIN=previous;}
});
test('asset and download endpoints refuse private or failed images; retry releases only verified variants',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ri-image-api-')),savedRoot=process.env.RECIPE_INTELLIGENCE_ROOT,savedTool=process.env.EXIFTOOL_PATH;
  process.env.RECIPE_INTELLIGENCE_ROOT=root;
  t.after(()=>{if(savedRoot===undefined)delete process.env.RECIPE_INTELLIGENCE_ROOT;else process.env.RECIPE_INTELLIGENCE_ROOT=savedRoot;if(savedTool===undefined)delete process.env.EXIFTOOL_PATH;else process.env.EXIFTOOL_PATH=savedTool;fs.rmSync(root,{recursive:true,force:true});});
  const bytes=await sharp({create:{width:6,height:4,channels:4,background:'#33445588'}}).png().toBuffer();
  const create=route('image-assets'),asset=route('image-assets/[id]'),download=route('download');
  const form=new FormData();form.set('image',new Blob([bytes],{type:'image/png'}),'photo.png');form.set('formats','png,webp');
  process.env.EXIFTOOL_PATH=path.join(root,'missing-exiftool');
  const failure=await create.POST(new Request('http://localhost:3000/api/image-assets',{method:'POST',headers:{Origin:'http://localhost:3000'},body:form}));
  assert.equal(failure.status,422);const failed=await failure.json();assert.equal(failed.retryable,true);assert.equal(failed.imageUrl,undefined);
  const context={params:Promise.resolve({id:failed.assetId})};
  assert.equal((await asset.GET(new Request('http://localhost:3000'),context)).status,409);
  assert.equal((await download.GET(new Request('http://localhost:3000/api/download?url='+encodeURIComponent('/api/image-assets/'+failed.assetId)))).status,409);
  assert.equal((await download.GET(new Request('http://localhost:3000/api/download?url='+encodeURIComponent('https://fal.media/raw.png')))).status,409);
  if(savedTool===undefined)delete process.env.EXIFTOOL_PATH;else process.env.EXIFTOOL_PATH=savedTool;
  const retry=await asset.POST(new Request('http://localhost:3000/api/image-assets/'+failed.assetId,{method:'POST',headers:{Origin:'http://localhost:3000'}}),context);
  assert.equal(retry.status,200);const ready=await retry.json();assert.equal(ready.metadata.state,'verified');
  for(const format of ['png','webp']){const response=await download.GET(new Request('http://localhost:3000/api/download?url='+encodeURIComponent(ready.variants[format])));assert.equal(response.status,200);assert.equal(response.headers.get('X-Image-Metadata'),'verified');assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format,format);}
  assert.deepEqual(fs.readFileSync(path.join(root,'verified-images/private',failed.assetId,'original')),bytes);
});
