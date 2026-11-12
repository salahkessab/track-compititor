'use strict';
// Uses a disposable database, no valid provider key, and no paid requests.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function availablePort(){const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));return port;}
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'recipe-server-smoke-')),port=await availablePort(),origin='https://server-smoke.example';
 const env={...process.env,R2_ENABLED:'0',OPENAI_API_KEY:'',FAL_KEY:'',RECIPE_INTELLIGENCE_MODE:'server',RECIPE_INTELLIGENCE_ROOT:root,RECIPE_INTELLIGENCE_ORIGIN:origin,RECIPE_INTELLIGENCE_ALLOW_EMPTY:'1',RECIPE_INTELLIGENCE_SECRET_KEY:randomBytes(32).toString('base64'),APP_PASSWORD:'smoke-owner-password',PORT:String(port),NEXT_TELEMETRY_DISABLED:'1'};
 for(const key of ['VERCEL','RECIPE_INTELLIGENCE_LOCAL','RECIPE_INTELLIGENCE_BUILD','RECIPE_INTELLIGENCE_MIGRATION_KEY','RECIPE_INTELLIGENCE_WORKER_PAUSED'])delete env[key];
 const log=fs.openSync(path.join(root,'smoke.log'),'a');let child;
 const start=()=>{child=spawn(process.execPath,['scripts/recipe-intelligence-server.cjs'],{cwd:path.resolve(__dirname,'..'),env,windowsHide:true,stdio:['ignore',log,log,'ipc']});};
 const stop=async()=>{if(!child||child.exitCode!==null)return;child.send('stop');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server did not stop cleanly.')),35000);child.once('exit',()=>{clearTimeout(timer);resolve();});});};
 // node:http permits an explicit upstream Host, as the production TLS reverse
 // proxy does. Fetch implementations may replace that header with loopback.
 const api=(route,method='GET',body,auth=true)=>new Promise((resolve,reject)=>{
   const request=http.request({hostname:'127.0.0.1',port,path:'/api/recipe-intelligence/'+route,method,headers:{Host:'server-smoke.example',Origin:origin,'X-Recipe-Intelligence':'1','Content-Type':'application/json',...(auth?{Authorization:'Basic '+Buffer.from('owner:'+env.APP_PASSWORD).toString('base64')}:{})}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode})));});request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
 });
 const ready=async()=>{for(let i=0;i<90;i++){if(child.exitCode!==null)throw Error('Server exited; inspect '+path.join(root,'smoke.log'));try{if((await fetch(`http://127.0.0.1:${port}/api/server-health`)).ok)return;}catch{}await sleep(1000);}throw Error('Server readiness timed out.');};
 try{
 start();await ready();assert.equal((await api('snapshot','GET',undefined,false)).status,401);
 const firstResponse=await api('snapshot');const first=await firstResponse.json();assert.equal(firstResponse.status,200,JSON.stringify(first));assert.equal(first.runtime,'server');assert.equal(first.worker.online,true);
 const imported=await(await api('imports','POST',{})).json();assert.ok(imported.id);
 const marker=path.join(root,'deployment-maintenance.json'),revision='d'.repeat(40);
 fs.writeFileSync(marker,JSON.stringify({revision,expiresAt:Date.now()+60000}));
 let drained=false;for(let i=0;i<20;i++){try{if(JSON.parse(fs.readFileSync(path.join(root,'deployment-drained.json'))).revision===revision){drained=true;break;}}catch{}await sleep(500);}
 assert.ok(drained,'Worker acknowledges maintenance without stopping its heartbeat');
 assert.equal((await api('imports','POST',{})).status,503);assert.equal((await api('snapshot')).status,200);fs.unlinkSync(marker);
 await stop();start();await ready();const second=await(await api('snapshot')).json();assert.ok(second.imports.some(i=>i.id===imported.id));assert.equal(second.settings.workspaceId,first.settings.workspaceId);
 await stop();const db=new Database(path.join(root,'database/recipe-intelligence.sqlite'),{readonly:true});assert.equal(db.prepare('SELECT count(*) n FROM api_calls').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM worker_lease').get().n,0);db.close();
 console.log(JSON.stringify({passed:true,passwordRequired:true,persistedImports:true,persistedWorkspace:true,controlledShutdown:true,paidCalls:0,logs:root}));
 }finally{if(child?.exitCode===null)await stop();fs.closeSync(log);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
