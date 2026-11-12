const test=require('node:test'),assert=require('node:assert/strict');
const {contentFixture,textResponse,article}=require('./helpers/content-fixtures.cjs');
const {OpenAIContentProvider,ProviderFailure}=require('../.intelligence-build/lib/recipe-intelligence/provider.js');

function mockFetch(t,fetcher) {
  const originalFetch=global.fetch,originalKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='test-only-placeholder';global.fetch=fetcher;
  t.after(()=>{global.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;});
}
test('TLS trust failure is identified before dispatch, without retrying or exposing error secrets',async t=>{
  let requests=0;
  mockFetch(t,async()=>{requests++;throw new TypeError('secret-request-value',{cause:Object.assign(new Error('private-header-value'),{code:'SELF_SIGNED_CERT_IN_CHAIN'})});});
  await assert.rejects(new OpenAIContentProvider().request('text',{model:'gpt-5.5'}),e=>{
    assert.equal(e.definitelyRejected,true);assert.match(e.message,/SELF_SIGNED_CERT_IN_CHAIN/);assert.match(e.message,/request was not sent/);assert.doesNotMatch(e.message,/secret-request|private-header/);return true;
  });assert.equal(requests,1);
});
test('socket loss remains uncertain and sends a durable client request ID without following redirects',async t=>{
  let requests=0;
  mockFetch(t,async(url,init)=>{requests++;assert.equal(init.headers['X-Client-Request-Id'],'durable-call-id');assert.equal(init.redirect,'error');throw new TypeError('fetch failed',{cause:Object.assign(new Error('secret'),{code:'ECONNRESET'})});});
  await assert.rejects(new OpenAIContentProvider().request('text',{model:'gpt-5.5'},undefined,undefined,'durable-call-id'),e=>e.definitelyRejected===false&&/billing outcome is unknown/.test(e.message)&&/ECONNRESET/.test(e.message));
  assert.equal(requests,1);
});
test('worker ties the client request ID to its ledger and releases only a proven pre-request TLS failure',async t=>{
  const f=await contentFixture(t);let sentId;
  mockFetch(t,async(url,init)=>{sentId=init.headers['X-Client-Request-Id'];throw new TypeError('fetch failed',{cause:Object.assign(new Error('certificate chain'),{code:'SELF_SIGNED_CERT_IN_CHAIN'})});});
  f.batchEngine.provider=new OpenAIContentProvider();
  const recipe=f.seed(),batch=f.batches.create([{recipeId:recipe.id}],f.defaults);f.approve(batch);await f.drainBatch();
  const calls=f.store.db.prepare('SELECT * FROM api_calls').all();assert.equal(calls.length,1);assert.equal(calls[0].id,sentId);assert.equal(calls[0].state,'rejected');
  assert.equal(f.batches.budget(batch.id).held,0);assert.equal(f.batches.detail(batch.id).items[0].stages.find(s=>s.kind==='article').state,'failed');
});
test('a receipt-body interruption stays uncertain after headers acknowledge a request',async t=>{
  let acknowledged;
  mockFetch(t,async()=>new Response(new ReadableStream({start(controller){controller.error(Object.assign(new Error('Body interrupted'),{code:'SELF_SIGNED_CERT_IN_CHAIN'}));}}),{headers:{'x-request-id':'provider-received'}}));
  await assert.rejects(new OpenAIContentProvider().request('text',{model:'gpt-5.5'},undefined,id=>{acknowledged=id;}),e=>e.definitelyRejected!==true);
  assert.equal(acknowledged,'provider-received');
});
test('explicit uncertain article retry keeps the old reservation and limit while a fresh attempt succeeds',async t=>{
  let count=0;
  const f=await contentFixture(t,{provider:async()=>{if(++count===1)throw new ProviderFailure('Unknown connection result');return textResponse(article());}});
  const recipe=f.seed(),batch=f.batches.create([{recipeId:recipe.id}],{...f.defaults,correction:false});f.approve(batch,1.69);await f.drainBatch();
  const item=f.batches.detail(batch.id).items[0],old=f.store.db.prepare('SELECT * FROM api_calls').get();
  assert.equal(old.state,'uncertain');assert.equal(old.actual_usd,null);
  assert.throws(()=>f.batches.retry(item.id,'article',true),/uncertain/);
  assert.throws(()=>f.batches.retry(item.id,'article',false,true),/uncertain/);
  f.batches.retry(item.id,'article',true,true);
  assert.equal(f.batches.get(batch.id).limit_usd,1.69);
  assert.equal(f.batches.budget(batch.id).held,old.reserved_usd);
  assert.throws(()=>f.batches.retry(item.id,'article',true,true),/not eligible/,'Repeated clicks cannot queue a second replacement');
  await f.drainBatch();
  const calls=f.store.db.prepare('SELECT * FROM api_calls ORDER BY rowid').all();
  assert.equal(calls.length,2);assert.equal(calls[0].id,old.id);assert.equal(calls[0].state,'uncertain');assert.equal(calls[0].actual_usd,null);
  assert.equal(calls[1].attempt,1);assert.equal(calls[1].state,'succeeded');
  assert.equal(f.batches.budget(batch.id).held,old.reserved_usd);
  assert.equal(f.batches.detail(batch.id).status,'completed');
  assert.ok(f.batches.budget(batch.id).committed<=1.69);
});
test('retained unknown charges cannot be spent again, and recovery distinguishes old attempts from the new attempt',async t=>{
  const f=await contentFixture(t,{provider:async()=>{throw new ProviderFailure('Unknown connection result');}});
  const recipe=f.seed(),batch=f.batches.create([{recipeId:recipe.id}],f.defaults);f.approve(batch);await f.drainBatch();
  const item=f.batches.detail(batch.id).items[0],old=f.store.db.prepare('SELECT * FROM api_calls').get();
  f.store.db.prepare('UPDATE content_batches SET limit_usd=? WHERE id=?').run(old.reserved_usd,batch.id);
  assert.throws(()=>f.batches.retry(item.id,'article',true,true),/no remaining approved budget/);
  f.store.db.prepare('UPDATE content_batches SET limit_usd=? WHERE id=?').run(old.reserved_usd+.000001,batch.id);
  f.batches.retry(item.id,'article',true,true);
  // Crash before the new attempt is dispatched must not inherit the old attempt's uncertain state.
  const stage=f.batches.claim(f.owner);assert.equal(stage.kind,'article');f.batches.recover();
  assert.equal(f.store.db.prepare('SELECT state FROM content_stages WHERE id=?').get(stage.id).state,'queued');
  await f.drainBatch();assert.equal(f.providerCalls.length,1,'Remaining budget is checked before another request');
  assert.equal(f.batches.detail(batch.id).status,'budget_wait');
  assert.equal(f.batches.budget(batch.id).held,old.reserved_usd);
});
test('a known rejection after an uncertain retry remains a normal failed stage with old reservation retained',async t=>{
  let count=0;
  const f=await contentFixture(t,{provider:async()=>{throw new ProviderFailure('Connection error',++count>1);}});
  const recipe=f.seed(),batch=f.batches.create([{recipeId:recipe.id}],f.defaults);f.approve(batch);await f.drainBatch();
  const item=f.batches.detail(batch.id).items[0];f.batches.retry(item.id,'article',true,true);await f.drainBatch();
  const stage=f.batches.detail(batch.id).items[0].stages.find(s=>s.kind==='article');assert.equal(stage.state,'failed');
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM api_calls WHERE state='uncertain'").get().n,1);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM api_calls WHERE state='rejected'").get().n,1);
  assert.doesNotThrow(()=>f.batches.retry(item.id,'article'));
});

test('explicit research retry preserves the unknown charge and recipe version and continues once',async t=>{
  let researchCalls=0;
  const f=await contentFixture(t,{provider:async(op,payload)=>{
    if(payload.tools){if(++researchCalls===1)throw new ProviderFailure('Interrupted research');return textResponse({});}
    return textResponse(article());
  }});
  const recipe=f.seed(),batch=f.batches.create([{recipeId:recipe.id,independentResearch:true}],{...f.defaults,correction:false});
  f.approve(batch,2.04);await f.drainBatch();
  const item=f.batches.detail(batch.id).items[0],old=f.store.db.prepare('SELECT * FROM api_calls').get();
  assert.equal(old.state,'uncertain');
  assert.throws(()=>f.batches.retry(item.id,'research',true),/uncertain/);
  assert.throws(()=>f.batches.retry(item.id,'research',false,true),/uncertain/);
  f.batches.retry(item.id,'research',true,true);
  assert.equal(f.batches.item(item.id).version,item.version);
  assert.equal(f.batches.budget(batch.id).held,old.reserved_usd);
  assert.throws(()=>f.batches.retry(item.id,'research',true,true),/not eligible/);
  await f.drainBatch();
  assert.equal(researchCalls,2);
  const reviewed=f.batches.detail(batch.id).items[0];
  assert.equal(reviewed.review_kind,'research');
  assert.equal(f.providerCalls.filter(c=>!c.payload.tools).length,0);
  f.batches.approveItem(item.id,reviewed.source.url);await f.drainBatch();
  const retained=f.store.db.prepare('SELECT * FROM api_calls WHERE id=?').get(old.id);
  assert.equal(retained.state,'uncertain');assert.equal(retained.actual_usd,null);
  assert.equal(f.batches.detail(batch.id).status,'completed');
  assert.equal(f.batches.get(batch.id).limit_usd,2.04);
  assert.ok(f.batches.budget(batch.id).committed<=2.04);
});
