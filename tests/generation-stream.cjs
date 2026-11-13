const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(name,requireModule=require){const output=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const module={exports:{}};new Function('module','exports','require',output)(module,module.exports,requireModule);return module.exports;}
const {streamGeneration}=load('generationStream');
const {readGenerationPayload}=load('generationResponse',name=>name==='./preparedImageClient'?{}:require(name));
const request=()=>new Request('https://studio.example/api/generate',{method:'POST',headers:{accept:'application/x-ndjson'}});
const decode=part=>JSON.parse(new TextDecoder().decode(part.value));
test('long image work sends heartbeats and a single verified terminal result without repeating work',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let finish,calls=0;
 const result=streamGeneration(request(),async phase=>{calls++;await new Promise(resolve=>finish=resolve);phase('preparing');return Response.json({imageUrl:'/api/image-assets/verified',metadata:{state:'verified'}});});
 const reader=result.body.getReader();assert.deepEqual(decode(await reader.read()),{type:'status',phase:'generating'});
 t.mock.timers.tick(130_000);
 for(let i=0;i<8;i++)assert.deepEqual(decode(await reader.read()),{type:'heartbeat'});
 assert.equal(calls,1);finish();assert.deepEqual(decode(await reader.read()),{type:'status',phase:'preparing'});
 const final=decode(await reader.read());assert.equal(final.type,'result');assert.equal(final.data.metadata.state,'verified');assert.equal((await reader.read()).done,true);
 t.mock.timers.tick(30_000);assert.equal(calls,1);
});
test('streaming keeps error status, uncertain billing outcome and preparation retry metadata',async()=>{
 const payload={error:'Preparation failed',assetId:'private-reference',retryable:true,outcome:'unknown',usage:{cost:0.1}};
 const result=await readGenerationPayload(streamGeneration(request(),async()=>Response.json(payload,{status:422})));
 assert.equal(result.response.status,422);for(const [key,value] of Object.entries(payload))assert.deepEqual(result.data[key],value);
});
test('cancelling the reader clears keepalives without starting another provider request',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let finish,calls=0;
 const response=streamGeneration(request(),async()=>{calls++;await new Promise(resolve=>finish=resolve);return Response.json({saved:true});});
 const reader=response.body.getReader();await reader.read();await reader.cancel();t.mock.timers.tick(180_000);finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
});
test('legacy JSON callers keep the original HTTP error and unapproved requests stay unapproved',async()=>{
 const result=await streamGeneration(new Request('https://studio.example/api/generate'),async()=>Response.json({error:'Approve first',dispatched:false},{status:400}));
 assert.equal(result.status,400);assert.deepEqual(await result.json(),{error:'Approve first',dispatched:false});
});
test('a heartbeat-only disconnect cannot become a successful image response',async()=>{
 const response=new Response('{"type":"status","phase":"generating"}\n{"type":"heartbeat"}\n',{headers:{'content-type':'application/x-ndjson'}});
 await assert.rejects(readGenerationPayload(response),/interrupted before the final result/);
});
