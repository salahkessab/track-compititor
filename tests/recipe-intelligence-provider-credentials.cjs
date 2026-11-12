const test=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const {temporary}=require('./helpers/recipe-fixtures.cjs');
const {IntelligenceStore}=require('../.intelligence-build/lib/recipe-intelligence/database.js');
const {ProviderCredentials,OPENAI_CREDENTIAL_SETTING}=require('../.intelligence-build/lib/recipe-intelligence/providerCredentials.js');
const {OpenAIContentProvider,checkModels}=require('../.intelligence-build/lib/recipe-intelligence/provider.js');
const {DEFAULT_CONTENT_SETTINGS}=require('../.intelligence-build/lib/recipe-intelligence/settings.js');
const {handleIntelligence}=require('../.intelligence-build/lib/recipe-intelligence/api.js');
const key='sk-proj-'+ 'a'.repeat(80),replacement='sk-proj-'+ 'b'.repeat(80);
function env(t,root){
 const saved={...process.env},oldFetch=global.fetch;
 Object.assign(process.env,{RECIPE_INTELLIGENCE_MODE:'server',RECIPE_INTELLIGENCE_ROOT:root,RECIPE_INTELLIGENCE_ORIGIN:'https://recipes.example',RECIPE_INTELLIGENCE_SECRET_KEY:randomBytes(32).toString('base64'),APP_PASSWORD:'owner-test',OPENAI_API_KEY:'',R2_ENABLED:'0'});
 delete process.env.VERCEL;delete process.env.RECIPE_INTELLIGENCE_LOCAL;
 t.after(async()=>{global.fetch=oldFetch;for(const p of globalThis.recipeIntelligenceStores?.values()||[])(await p).close();globalThis.recipeIntelligenceStores?.clear();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);});
}
const checked=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return Response.json({data:[]});};
test('OpenAI credentials persist encrypted, rotate without worker restart and never leak through status or failures',async t=>{
 const root=temporary(t);env(t,root);let store=await IntelligenceStore.open(root);t.after(()=>store.close());
 let credentials=new ProviderCredentials(store);assert.equal(credentials.status().configured,false);
 const saved=await credentials.save(key,checked);assert.equal(saved.source,'saved');assert.ok(!JSON.stringify(saved).includes(key));
 const raw=store.db.prepare('SELECT value FROM settings WHERE key=?').get(OPENAI_CREDENTIAL_SETTING).value;
 assert.ok(!raw.includes(key));assert.match(JSON.parse(raw).protectedKey,/^ri1:/);
 await assert.rejects(credentials.save(replacement,async()=>new Response('secret reflected '+replacement,{status:401})),e=>/rejected/.test(e.message)&&!e.message.includes(replacement));
 assert.equal(await credentials.key(),key);store.close();store=await IntelligenceStore.open(root);credentials=new ProviderCredentials(store);assert.equal(await credentials.key(),key);
 process.env.OPENAI_API_KEY='environment-fallback';
 const provider=new OpenAIContentProvider(store),calls=[];global.fetch=async(url,options)=>{calls.push(options.headers.Authorization);return Response.json({output:[]});};
 await provider.request('text',{model:'gpt-5.5'});assert.equal(calls.at(-1),'Bearer '+key);
 await credentials.save(replacement,checked);await provider.request('text',{model:'gpt-5.5'});assert.equal(calls.at(-1),'Bearer '+replacement);
 credentials.remove();assert.equal(credentials.status().source,'environment');await provider.request('text',{});assert.equal(calls.at(-1),'Bearer environment-fallback');
 await credentials.save(key,checked);process.env.RECIPE_INTELLIGENCE_SECRET_KEY=randomBytes(32).toString('base64');
 const before=calls.length;await assert.rejects(provider.request('text',{}),e=>e.definitelyRejected===true&&/unlock/.test(e.message));assert.equal(calls.length,before);
});
test('model checks use the saved key and cannot retain old access checks after key replacement',async t=>{
 const root=temporary(t);env(t,root);const store=await IntelligenceStore.open(root);t.after(()=>store.close());const c=new ProviderCredentials(store);await c.save(key,checked);
 const settings={...DEFAULT_CONTENT_SETTINGS,images:false,textModel:'gpt-5.4-mini'};
 const fetcher=async(url,options)=>{if(url.startsWith('https://api.openai.com/')){assert.equal(options.headers.Authorization,'Bearer '+key);return Response.json({id:settings.textModel});}return new Response('<main>gpt-5.4-mini $0.75 $4.50</main>');};
 const result=await checkModels(store,settings,fetcher);assert.equal(result.checks[0].account,'listed');assert.equal(store.db.prepare('SELECT count(*) n FROM model_checks').get().n,1);
 await c.save(replacement,checked);assert.equal(store.db.prepare('SELECT count(*) n FROM model_checks').get().n,0);
 await assert.rejects(checkModels(store,settings,async(url)=>{if(url.startsWith('https://api.openai.com/'))await c.save(key,checked);return new Response('<main>gpt-5.4-mini $0.75 $4.50</main>');}),/key changed/);
 assert.equal(store.db.prepare('SELECT count(*) n FROM model_checks').get().n,0);
});
test('key endpoints require owner authentication and CSRF, expose no key, and make only a metadata GET',async t=>{
 env(t,temporary(t));const calls=[];global.fetch=async(url,options)=>{calls.push({url,method:options.method});return checked(url,options);};
 const auth='Basic '+Buffer.from('owner:owner-test').toString('base64');
 const api=(route,method='GET',data,headers={})=>handleIntelligence(new Request('https://recipes.example/api/recipe-intelligence/'+route,{method,headers:{host:'recipes.example',origin:'https://recipes.example',authorization:auth,'X-Recipe-Intelligence':'1','Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})}));
 assert.equal((await api('provider-key','POST',{apiKey:key},{authorization:''})).status,401);
 assert.equal((await api('provider-key','POST',{apiKey:key},{origin:'https://evil.example'})).status,403);
 assert.equal((await api('provider-key','DELETE',{}, {'X-Recipe-Intelligence':''})).status,403);assert.equal(calls.length,0);
 const saved=await api('provider-key','POST',{apiKey:key});assert.equal(saved.status,200);assert.equal((await saved.json()).configured,true);
 for(const route of ['provider-key','snapshot','model-check']){const r=await api(route),text=await r.text();assert.equal(r.status,200);assert.ok(!text.includes(key));assert.ok(!text.includes('protectedKey'));}
 const testResult=await api('provider-key/test','POST',{});assert.equal(testResult.status,200);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='GET'&&c.url==='https://api.openai.com/v1/models'));
 const invalid=new Request('https://recipes.example/api/recipe-intelligence/provider-key',{method:'POST',headers:{host:'recipes.example',origin:'https://recipes.example',authorization:auth,'X-Recipe-Intelligence':'1','Content-Type':'application/json'},body:'{"apiKey":"'+key+'",oops}'});
 const bad=await handleIntelligence(invalid);assert.equal(bad.status,400);assert.ok(!(await bad.text()).includes(key));
 assert.equal((await api('provider-key','DELETE',{})).status,200);assert.equal((await(await api('provider-key')).json()).configured,false);
 const store=await [...globalThis.recipeIntelligenceStores.values()][0];assert.equal(store.db.prepare('SELECT count(*) n FROM api_calls').get().n,0);
});
