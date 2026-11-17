const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {refinementPlan,validateRefinement,refineArticle,HUMANIZER_REVISION,REFINEMENT_INPUT_LIMIT}=require('../.intelligence-build/lib/recipe-intelligence/refinement.js');
const {contentFixture,article,textResponse}=require('./helpers/content-fixtures.cjs');
const {articleDocument}=require('../.intelligence-build/lib/recipe-intelligence/article-document.js');
const intro='It is worth noting that carrots give this smooth soup its colour. Blend the cooked carrots with their cooking water to finish it, and keep the stated salt quantity unchanged.';
const original=()=>({article:{...article(),introduction:intro,headings:['Ingredients','Instructions'],jsonLd:{recipeIngredient:['500 g carrots','750 ml water','1 tsp salt (optional)'],cookTime:'PT20M'},imageReferences:['https://images.example/photo.webp'],citations:['https://food.example/reference'],nutrition:{calories:'100 kcal'}},recipe:{ingredients:['500 g carrots','750 ml water','1 tsp salt (optional)'],instructions:['Simmer for 20 minutes.','Blend.'],cookTime:'PT20M',yield:'4 servings'}});
const accepted=payload=>{assert.equal(payload.text.format.name,'editorial_refinement');assert.ok(Buffer.byteLength(JSON.stringify(payload))<=REFINEMENT_INPUT_LIMIT);return Promise.resolve(textResponse({approvedEdits:JSON.parse(payload.input).edits.map(e=>e.id)}).body);};

test('pinned Humanizer source and MIT attribution are retained',()=>{
  assert.match(fs.readFileSync(path.join(__dirname,'../vendor/humanizer/NOTICE.md'),'utf8'),new RegExp(HUMANIZER_REVISION));
  assert.match(fs.readFileSync(path.join(__dirname,'../vendor/humanizer/LICENSE'),'utf8'),/Copyright \(c\) 2025 Siqi Chen/);
  // Git/Windows may convert line endings; pin the upstream text canonically.
  const source=fs.readFileSync(path.join(__dirname,'../vendor/humanizer/SKILL.md'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'804a119e924ac30295b298213e0b71b3e38b2667b8ef4fb7b69e9246369b9045');
});
for(const [name,mutate] of [
  ['ingredient substitutions',c=>c.recipe.ingredients[0]='500 g potatoes'],
  ['quantity changes',c=>c.recipe.ingredients[1]='900 ml water'],
  ['omitted ingredients',c=>c.recipe.ingredients.pop()],
  ['altered cooking times',c=>c.recipe.cookTime='PT10M'],
  ['reordered steps',c=>c.recipe.instructions.reverse()],
  ['optional labels removed',c=>c.recipe.ingredients[2]='1 tsp salt'],
  ['changed recipe cards',c=>c.article.jsonLd.cookTime='PT10M'],
  ['changed nutrition',c=>c.article.nutrition.calories='50 kcal'],
  ['renamed headings',c=>c.article.headings[0]='My ingredients'],
  ['changed citations',c=>c.article.citations[0]='https://invented.example/'],
  ['changed images',c=>c.article.imageReferences[0]='https://images.example/other.webp'],
  ['invented personal testing',c=>c.article.introduction='I tested this recipe with my family.'],
  ['new facts in prose',c=>c.article.introduction=intro.replace('carrots','potatoes')],
])test('validation rejects '+name,()=>{const canonical=original(),candidate=structuredClone(canonical);mutate(candidate);assert.equal(validateRefinement(canonical,candidate,'recipe').valid,false);});

test('model can approve only bounded prose edits; all protected fields and canonical input remain exact',async()=>{
  const canonical=original(),copy=structuredClone(canonical);let payload;
  const result=await refineArticle(canonical,'recipe','gpt-5.4-mini',p=>{payload=p;return accepted(p);});
  assert.equal(result.report.status,'accepted');assert.match(result.article.introduction,/^Carrots/);assert.deepEqual(canonical,copy);
  assert.deepEqual({...result.article,introduction:intro},canonical.article);
  assert.doesNotMatch(payload.input,/500 g|PT20M|750 ml|jsonLd|imageReferences/,'protected sections are withheld');
  assert.equal(payload.model,'gpt-5.4-mini');assert.equal(payload.tools,undefined);
});

test('already good, quoted and formatted passages stay unchanged without paid editing',async()=>{
  for(const introduction of [article().introduction,'<p>'+intro+'</p>','“'+intro+'”',intro+' [source](https://example.com)']){
    const canonical={article:{...article(),introduction}};
    const result=await refineArticle(canonical,'recipe','gpt-5.4-mini',()=>assert.fail('No call for protected or already-good prose'));
    assert.equal(result.report.status,'unchanged');assert.deepEqual(result.article,canonical.article);
  }
});

test('malformed rewrites and provider failures retain the original with a recorded rejection',async()=>{
  for(const response of [{...article(),introduction:'Use potatoes instead.'},{approvedEdits:['ingredient:0']},{approvedEdits:['e1'],article:article()},{approvedEdits:['e1','e1']}]){
    const canonical=original(),result=await refineArticle(canonical,'recipe','gpt-5.4-mini',async()=>textResponse(response).body);
    assert.equal(result.report.status,'rejected');assert.deepEqual(result.article,canonical.article);assert.equal(result.report.canonicalHash,result.report.acceptedHash);
  }
  const result=await refineArticle(original(),'recipe','gpt-5.4-mini',async()=>{throw Error('Saved request has an uncertain outcome.');});assert.equal(result.report.status,'rejected');assert.match(result.report.reason,/uncertain/);
});

test('recipe worker refines once after writing and uses accepted prose for preview, export and WordPress',async t=>{
  const f=await contentFixture(t,{provider:(_op,p)=>p.text.format.name==='editorial_refinement'?textResponse({approvedEdits:JSON.parse(p.input).edits.map(e=>e.id)}):textResponse({...article(),introduction:intro})});
  const row=f.seed(),batch=f.batches.create([{recipeId:row.id}],{...f.defaults,correction:false});assert.ok(batch.quote.lines.some(l=>l.kind==='refinement'));
  f.approve(batch);await f.drainBatch();const item=f.batches.detail(batch.id).items[0];assert.equal(item.state,'completed');assert.equal(f.providerCalls.length,2);
  const canonical=JSON.parse(f.batches.artifacts.read(item.files.find(x=>x.name==='article-canonical.json').id).data);assert.equal(canonical.article.introduction,intro);
  const report=JSON.parse(f.batches.artifacts.read(item.files.find(x=>x.name==='editorial-refinement.json').id).data);assert.equal(report.status,'accepted');
  assert.match(item.article.introduction,/^Carrots/);
  const html=(await f.batches.artifacts.download(item.files.find(x=>x.name==='article.html').id)).data.toString();
  assert.match(html,/<p>Carrots give/);
  assert.equal(JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)[1]).description,intro,'JSON-LD remains canonical');
  for(const name of ['article.md','article.txt'])assert.doesNotMatch(f.batches.artifacts.read(item.files.find(x=>x.name===name).id).data.toString(),/It is worth noting/);
  const {WordPressStore}=require('../.intelligence-build/lib/recipe-intelligence/wordpress.js');
  const wp=new WordPressStore(f.store,async()=>({status:200,body:Buffer.from(JSON.stringify({id:1,name:'Test',capabilities:{upload_files:true}}))}),{protect:async v=>v,unprotect:async v=>v});
  const connection=(await wp.connect({siteUrl:'https://wordpress.example/',username:'owner',applicationPassword:'abcdefghijklmnopqrstuvwx'})).connections[0];
  assert.match(wp.plan(item.id,connection.id).html,/<p>Carrots give/);
  f.batches.retry(item.id,'save_article');await f.drainBatch();assert.equal(f.providerCalls.length,2,'Repair does not rewrite or re-edit');
  assert.equal(f.batches.artifacts.read(item.files.find(x=>x.name==='article-canonical.json').id).data.toString(),JSON.stringify(canonical,null,2));
});

test('rejected recipe editing keeps writer output and records a visible warning without failing the article',async t=>{
  const f=await contentFixture(t,{provider:(_op,p)=>textResponse(p.text.format.name==='editorial_refinement'?{instructions:['Simmer for 2 minutes.']}:{...article(),introduction:intro})});
  const row=f.seed(),batch=f.batches.create([{recipeId:row.id}],{...f.defaults,correction:false});f.approve(batch);await f.drainBatch();const item=f.batches.detail(batch.id).items[0];assert.equal(item.state,'completed');assert.equal(item.article.introduction,intro);assert.ok(item.warnings.some(w=>/refinement rejected/i.test(w)));
});

test('explicit article regeneration uses a new canonical draft and preserves the previous version',async t=>{
  let drafts=0;const second=intro.replace('carrots give this smooth soup its colour','the cooking water stays with the carrots during blending');
  const f=await contentFixture(t,{provider:(_op,p)=>textResponse(p.text.format.name==='editorial_refinement'?{approvedEdits:JSON.parse(p.input).edits.map(e=>e.id)}:{...article(),introduction:++drafts===1?intro:second})});
  const row=f.seed(),batch=f.batches.create([{recipeId:row.id}],{...f.defaults,correction:false});f.approve(batch);await f.drainBatch();let item=f.batches.detail(batch.id).items[0];
  const oldFile=f.store.db.prepare("SELECT relative_path FROM artifacts WHERE item_id=? AND name='article-canonical.json'").get(item.id).relative_path;
  f.batches.retry(item.id,'article',true);await f.drainBatch();item=f.batches.detail(batch.id).items[0];
  assert.equal(item.version,2);assert.equal(drafts,2);assert.match(item.article.introduction,/^The cooking water/);
  assert.equal(JSON.parse(f.batches.artifacts.read(item.files.find(x=>x.name==='article-canonical.json').id).data).article.introduction,second);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,oldFile))).article.introduction,intro);
  assert.equal(f.providerCalls.length,4,'One writer and one refinement per explicitly requested version');
});

test('Home & Decor uses the same final pass while preserving headings and image plans',async t=>{
  const f=await contentFixture(t),{DecorStore}=require('../.intelligence-build/lib/recipe-intelligence/decor.js'),decor=new DecorStore(f.store);
  const intro='It is worth noting that linen and wood bring quiet texture to this room. Place the main seats around a shared focal point while keeping the doorway clear.';
  const draft={title:'Small living room',seoTitle:'Small living room ideas',slug:'small-living-room',metaDescription:'Arrange the seating.',introduction:intro,sections:[{heading:'Seating',paragraphs:['Place the sofa along the wall.']},{heading:'Textures',paragraphs:['Use linen and wood.']}],notes:[],imagePlans:[]};
  const job=decor.create('https://decor.example/room','Small living room\n'+intro.repeat(4));const quote=decor.select(job.id,{brief:'Keep the room layout.',photos:[]}).quote;assert.ok(quote.lines.some(l=>l.stage==='refinement'));decor.approve(job.id,quote.version);decor.claim();let calls=0;
  await decor.process(job.id,f.fetcher,{request:async(_op,p)=>{calls++;return textResponse(p.text.format.name==='editorial_refinement'?{approvedEdits:['e1']}:draft);}});
  const view=decor.detail(job.id);assert.equal(view.state,'completed');assert.equal(view.refinement.status,'accepted');assert.equal(calls,2);assert.deepEqual(view.article.sections,draft.sections.map((s,i)=>({...s,id:`section-${i+1}`})));assert.deepEqual(view.article.imagePlans,draft.imagePlans);assert.match((await decor.document(job.id)).toString(),/<p>Linen and wood/);
});
