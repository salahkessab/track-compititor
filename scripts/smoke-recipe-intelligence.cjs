'use strict';
// Isolated Windows/local launcher test. Creates no approved batch and makes no AI calls.
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict'); const {spawn} = require('node:child_process');
const {readJson,controlRequest} = require('./recipe-intelligence-launcher.cjs');
const repo=path.resolve(__dirname,'..');const base=fs.mkdtempSync(path.join(os.tmpdir(),'recipe-launcher-smoke-'));const config=path.join(base,'settings');const root=path.join(base,'Selected recipe folder');
const env={...process.env,RECIPE_INTELLIGENCE_CONFIG_DIR:config,OPENAI_API_KEY:'smoke-no-paid-requests',NEXT_TELEMETRY_DISABLED:'1'};delete env.VERCEL;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const launch=(withRoot=true)=>spawn(process.execPath,[path.join(__dirname,'recipe-intelligence-launcher.cjs'),'--no-browser',...(withRoot?['--root',root]:[])],{cwd:repo,env,windowsHide:true,stdio:'ignore'});
async function healthy(){for(let i=0;i<180;i++){const instance=readJson(path.join(config,'instance.json'));try{if(instance){const health=await controlRequest(instance);if(health.ready)return{instance,health};}}catch{}await sleep(1000);}throw new Error('Launcher smoke startup timed out. Logs: '+config);}
async function stop(instance){await controlRequest(instance,'stop');for(let i=0;i<150;i++){await sleep(100);try{await controlRequest(instance);}catch{return;}}throw new Error('Controlled shutdown timed out.');}
async function main(){let current;const children=[];try{
  children.push(launch());current=await healthy();assert.equal(current.health.root,root);assert.equal(current.health.children.length,2);
  const api=async(route,method='GET',body)=>{const origin='http://127.0.0.1:'+current.health.appPort;const response=await fetch(origin+'/api/recipe-intelligence/'+route,{method,headers:{Origin:origin,'X-RI-Key':current.instance.token,'X-Recipe-Intelligence':'1','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
  const initial=await api('snapshot');assert.equal(initial.worker.online,true);const prepared=await api('imports','POST',{});assert.equal(prepared.status,'ready');
  const duplicate=launch();children.push(duplicate);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Duplicate launcher did not reuse the healthy instance.')),10000);duplicate.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Duplicate launch failed.'));});});
  const reused=await healthy();assert.equal(reused.health.instanceId,current.health.instanceId);assert.deepEqual(reused.health.children,current.health.children);
  await stop(current.instance);current=null;children.push(launch(false));current=await healthy();assert.equal(current.health.root,root);assert.ok((await api('snapshot')).imports.some(i=>i.id===prepared.id));
  const db=new(require('better-sqlite3'))(path.join(root,'database','recipe-intelligence.sqlite'),{readonly:true});try{assert.equal(db.pragma('user_version',{simple:true}), 5);assert.equal(db.prepare('SELECT count(*) n FROM api_calls').get().n,0);assert.deepEqual(db.pragma('foreign_key_check'),[]);}finally{db.close();}
  await stop(current.instance);current=null;
  console.log(JSON.stringify({passed:true,selectedFolder:true,persistedImports:true,duplicateWorkerPrevented:true,controlledShutdown:true,schema:5,paidCalls:0,logs:base},null,2));
}finally{if(current)await stop(current.instance).catch(()=>{});for(const child of children)if(child.exitCode===null)child.kill();}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
