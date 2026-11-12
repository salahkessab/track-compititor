const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const {temporary}=require('./helpers/recipe-fixtures.cjs');
const {IntelligenceStore}=require('../.intelligence-build/lib/recipe-intelligence/database.js');
const {handleIntelligence}=require('../.intelligence-build/lib/recipe-intelligence/api.js');
const {deploymentPause}=require('../.intelligence-build/lib/recipe-intelligence/deployment.js');
const workspace=require('../scripts/deployment-workspace.cjs');
const {preserved,revision}=require('../scripts/deploy-instabox.cjs');
function environment(t,root){const saved={...process.env};t.after(()=>{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);});delete process.env.VERCEL;delete process.env.RECIPE_INTELLIGENCE_LOCAL;Object.assign(process.env,{RECIPE_INTELLIGENCE_MODE:'server',RECIPE_INTELLIGENCE_ROOT:root,RECIPE_INTELLIGENCE_SECRET_KEY:randomBytes(32).toString('base64'),RECIPE_INTELLIGENCE_ORIGIN:'https://deployment.example',APP_PASSWORD:'test-secret',R2_ENABLED:'0'});}
test('a deployment blocks new mutations while authenticated reads remain available; expired markers recover',async t=>{
 const root=temporary(t);environment(t,root);const store=await IntelligenceStore.open(root);store.close();
 const marker=path.join(root,'deployment-maintenance.json'),sha='a'.repeat(40);fs.writeFileSync(marker,JSON.stringify({revision:sha,expiresAt:Date.now()+60000}));
 assert.equal(deploymentPause(root).revision,sha);
 const headers={Host:'deployment.example',Origin:'https://deployment.example',Authorization:'Basic '+Buffer.from('owner:test-secret').toString('base64'),'X-Recipe-Intelligence':'1','Content-Type':'application/json'};
 const blocked=await handleIntelligence(new Request('https://deployment.example/api/recipe-intelligence/imports',{method:'POST',headers,body:'{}'}));assert.equal(blocked.status,503);assert.equal(blocked.headers.get('Retry-After'),'30');
 assert.equal((await handleIntelligence(new Request('https://deployment.example/api/recipe-intelligence/snapshot',{headers}))).status,200);
 fs.writeFileSync(marker,JSON.stringify({revision:sha,expiresAt:Date.now()-1}));assert.equal(deploymentPause(root),null);
 assert.equal((await handleIntelligence(new Request('https://deployment.example/api/recipe-intelligence/imports',{method:'POST',headers,body:'{}'}))).status,202);
 process.env.RECIPE_INTELLIGENCE_MODE='local';fs.writeFileSync(marker,JSON.stringify({revision:sha,expiresAt:Date.now()+60000}));assert.equal(deploymentPause(root),null);
 for(const entry of globalThis.recipeIntelligenceStores?.values()||[])try{(await entry).close();}catch{}globalThis.recipeIntelligenceStores?.clear();
});
test('deployment backup is encrypted, restores saved identity, and rejects tampering without replacing live data',async t=>{
 const root=temporary(t);environment(t,root);const store=await IntelligenceStore.open(root);store.addSite('Saved recipe website','https://recipes.example');store.close();
 const id='deploy-'+'b'.repeat(40)+'-'+Date.now(),before=await workspace.backup(root,id),file=workspace.backupFile(root,id);
 assert.ok(!fs.readFileSync(file).includes(Buffer.from('Saved recipe website')));assert.equal(fs.existsSync(file+'.sqlite'),false);
 const changed=await IntelligenceStore.open(root);changed.addSite('New data','https://another.example');changed.close();
 const restored=workspace.restore(root,id);preserved(before,restored);assert.equal(restored.counts.tracked_sites,1);
 const bytes=fs.readFileSync(file);bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);
 assert.throws(()=>workspace.restore(root,id),/checksum/);assert.equal(workspace.inspect(root).counts.tracked_sites,1);
 assert.throws(()=>workspace.backupFile(root,'../private'),/Invalid/);
});
test('deployment refuses changed workspace identity, lost records, and unsafe commit input',()=>{
 const before={workspaceId:'workspace-one',integrity:'ok',counts:{api_calls:5,artifacts:12}};
 assert.throws(()=>preserved(before,{...before,workspaceId:'workspace-two'}),/identity/);
 assert.throws(()=>preserved(before,{...before,counts:{api_calls:5,artifacts:11}}),/artifacts/);
 for(const input of ['main','../path','a'.repeat(40)+';echo unsafe'])assert.throws(()=>revision(input),/SHA/);
 assert.equal(revision('c'.repeat(40)),'c'.repeat(40));
});
