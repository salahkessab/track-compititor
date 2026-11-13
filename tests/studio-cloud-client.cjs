const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function client(fetch){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/cloudStudioStorage.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('module','exports','fetch',code)(module,module.exports,fetch);return module.exports;}
test('cloud studio round-trips Blob bytes and does not fall back to local storage after a server failure',async()=>{
 let failing=false,wire;const bytes=Buffer.from([0,255,12,49]);
 const api=client(async(url,options)=>{
  if(url.endsWith('/capabilities'))return Response.json({enabled:true,mode:'server'});
  if(failing)return Response.json({error:'Server unavailable'},{status:503});
  if(url.includes('/blob/'))return new Response(url.endsWith('b'.repeat(64))?'saved editable scene':bytes);
  wire=JSON.parse(options.body);
  if(wire.action==='get')return Response.json({value:{image:{$studioFile:1,sha256:'a'.repeat(64),type:'image/png'},scene:{$studioText:1,sha256:'b'.repeat(64)}}});
  return Response.json({saved:true});
 });
 assert.equal(await api.cloudStudioEnabled(),true);
 await api.cloudStudio('save','recipe-designs','history','id',{image:new Blob([bytes],{type:'image/png'})});assert.equal(wire.value.image.base64,bytes.toString('base64'));
 const loaded=await api.cloudStudio('get','recipe-designs','history','id');assert.ok(loaded.value.image instanceof Blob);assert.deepEqual(Buffer.from(await loaded.value.image.arrayBuffer()),bytes);
 assert.equal(loaded.value.scene,'saved editable scene');
 failing=true;await assert.rejects(api.cloudStudio('list','recipe-designs','history'),/Server unavailable/);assert.equal(await api.cloudStudioEnabled(),true);
});
test('storage capability failures are retryable and local mode remains supported',async()=>{
 let requests=0;const api=client(async()=>{if(++requests===1)throw Error('offline');return Response.json({enabled:true});});
 await assert.rejects(api.cloudStudioEnabled(),/offline/);assert.equal(await api.cloudStudioEnabled(),false);assert.equal(requests,2);
});
