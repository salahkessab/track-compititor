const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { contentFixture, article, textResponse, html } = require('./helpers/content-fixtures.cjs');
const { sourceReading, boundedSourceReading } = require('../.intelligence-build/lib/recipe-intelligence/recipe-context.js');
const { editorialPayload, validateEditorialBrief } = require('../.intelligence-build/lib/recipe-intelligence/editorial.js');
const { ProviderFailure } = require('../.intelligence-build/lib/recipe-intelligence/provider.js');
const { articleDocument } = require('../.intelligence-build/lib/recipe-intelligence/article-document.js');
const { writingPayload } = require('../.intelligence-build/lib/recipe-intelligence/prompts.js');
const { validateArticle } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { publicationIngredient } = require('../.intelligence-build/lib/recipe-intelligence/article-document.js');
const brief = () => ({sourceFormat:'Practical technique guide',readerNeed:'Understand how blending changes carrot soup.',angle:'Texture from carrots and cooking liquid',openingApproach:'Technique decision',openingBrief:'Lead with blending the carrots in their cooking water.',focusPoints:['Keep the cooking liquid.'],sectionOrder:['serving','proTips'],omitSections:['faqs'],avoidPatterns:['Generic comforting soup opening'],sourceLimitations:[]});
const draft = () => ({...article(),articleTitle:'Carrot soup',editorialNotes:[],blog:{whyMake:[],ingredientNotes:[{ingredientIndex:0,text:'Blended carrots give the soup body.',evidenceIds:[],basis:'culinary_knowledge'}],timeNote:[],variations:[],serving:[{text:'Serve the soup in bowls.',evidenceIds:[],basis:'culinary_knowledge'}],storage:[],proTips:[{text:'Blend until smooth.',evidenceIds:['S2'],basis:'source'}],faqs:[{question:'What thickens this soup?',text:'The blended carrots give it body.',evidenceIds:['I1','S2'],basis:'source'}],conclusion:''}});
const settings = f => ({...f.defaults,articleFormat:'master_recipe_v1',output:'article_only',correction:false});
const responder = (operation,payload) => {assert.equal(operation,'text');return textResponse(payload.text.format.name==='recipe_editorial_brief'?brief():draft());};

test('source reading excludes related modules, keeps prose and bounds Unicode without breaking characters',()=>{
  const reading=sourceReading(load('<main><h1>Carrot soup</h1><p>Use the cooking liquid when blending the carrots for a smooth texture.</p><aside><p>Unrelated roast</p></aside><div class="related-posts"><p>Other recipe</p></div></main>'));
  assert.match(reading.text,/cooking liquid/);assert.doesNotMatch(reading.text,/Unrelated|Other recipe/);
  const bounded=boundedSourceReading('🥕'.repeat(5000));assert.equal(Buffer.byteLength(bounded.text),10000);assert.equal(bounded.truncated,true);assert.doesNotMatch(bounded.text,/�/);
});

test('approved master jobs plan before writing, use recent openings and keep the brief private',async t=>{
  const f=await contentFixture(t,{provider:responder}),row=f.seed(),config=settings(f);
  const first=f.batches.create([{recipeId:row.id}],config);
  assert.ok(first.quote.lines.some(l=>l.kind==='editorial'&&l.estimated>0));
  assert.equal(await f.batches.claim(f.owner),null);assert.equal(f.providerCalls.length,0);
  f.approve(first);await f.drainBatch();
  const item=f.batches.detail(first.id).items[0];assert.equal(item.state,'completed');
  assert.deepEqual(f.providerCalls.map(c=>c.payload.text.format.name),['recipe_editorial_brief','recipe_article']);
  assert.match(f.providerCalls[1].payload.input,/Texture from carrots/);
  assert.equal(f.providerCalls[0].payload.tools,undefined);assert.equal(f.providerCalls[0].payload.max_output_tokens,1800);
  assert.deepEqual(item.source.ingredients,JSON.parse(row.recipe_json||f.store.db.prepare('SELECT recipe_json FROM recipe_records WHERE id=?').get(row.id).recipe_json).ingredients);
  assert.deepEqual(item.article.blog.faqs,[]);assert.deepEqual(item.article.sectionOrder,['serving','proTips']);
  const document=articleDocument(item.article,item.source);assert.ok(document.html.indexOf('Serving Suggestions')<document.html.indexOf('Tips for the Best'));
  assert.doesNotMatch(document.html,/readerNeed|Texture from carrots and cooking liquid|food\.example/);
  assert.ok(item.files.some(file=>file.name==='editorial-brief.json'));assert.equal(item.editorialBrief.angle,brief().angle);
  const second=f.batches.create([{recipeId:row.id}],config);f.approve(second);await f.drainBatch();
  const history=JSON.parse(f.providerCalls[2].payload.input).recentArticles;assert.equal(history.length,1);assert.equal(history[0].angle,brief().angle);
});

test('a saved analysis receipt repairs a malformed result without making another paid request',async t=>{
  let bad=true;const f=await contentFixture(t,{provider:()=>textResponse(bad?{}:draft())}),row=f.seed();
  const batch=f.batches.create([{recipeId:row.id}],settings(f));f.approve(batch);await f.drainBatch();
  assert.equal(f.providerCalls.length,1);const item=f.batches.detail(batch.id).items[0];assert.equal(item.stages.find(s=>s.kind==='editorial').state,'failed');
  f.batches.retry(item.id,'editorial');await f.drainBatch();assert.equal(f.providerCalls.length,1,'Local repair reuses the receipt even when validation still fails');
});

test('uncertain analysis never dispatches writing or automatically repeats payment',async t=>{
  const f=await contentFixture(t,{provider:()=>{throw new ProviderFailure('Connection lost after dispatch.');}}),row=f.seed();
  const batch=f.batches.create([{recipeId:row.id}],settings(f));f.approve(batch);await f.drainBatch();await f.drainBatch();
  const item=f.batches.detail(batch.id).items[0];assert.equal(f.providerCalls.length,1);assert.equal(item.stages.find(s=>s.kind==='editorial').state,'uncertain');assert.equal(item.article,null);
});

test('legacy frozen master jobs without the new stage keep their original writing request',async t=>{
  const f=await contentFixture(t,{provider:responder}),row=f.seed(),batch=f.batches.create([{recipeId:row.id}],settings(f)),item=batch.items[0];
  f.store.db.prepare("DELETE FROM content_stages WHERE item_id=? AND kind='editorial'").run(item.id);
  const frozen=writingPayload(item.source,batch.settings);frozen.input='OLD FROZEN V4 REQUEST';
  f.store.db.prepare('UPDATE content_items SET config_json=? WHERE id=?').run(JSON.stringify({writingProfile:'recipe-master-v4',sourceUrl:item.source.url,writingRequest:frozen}),item.id);
  f.approve(batch);await f.drainBatch();assert.equal(f.providerCalls.length,1);assert.equal(f.providerCalls[0].payload.input,'OLD FROZEN V4 REQUEST');
});

test('missing full text is disclosed and arbitrary section keys are rejected',()=>{
  const valid=validateEditorialBrief({...brief(),sectionOrder:['serving','constructor','serving'],omitSections:['instructions','faqs']});assert.deepEqual(valid.sectionOrder,['serving']);assert.deepEqual(valid.omitSections,['faqs']);
  const recipe=require('../.intelligence-build/lib/recipe-intelligence/article.js').extractArticle(html(),'https://food.example/soup').recipe;
  const payload=editorialPayload(recipe,{textModel:'gpt-5.4-mini'});assert.match(payload.input,/Only the saved recipe/);assert.match(payload.instructions,/untrusted reference data/);
});

test('prepared imports freeze analysis settings and include its cost in article-only approval',async t=>{
  const f=await contentFixture(t,{provider:responder});
  const {ImportStore}=require('../.intelligence-build/lib/recipe-intelligence/imports.js');
  const imports=new ImportStore(f.store),imported=imports.createFromText('https://food.example/soup','Carrot soup\nIngredients\n500 g carrots\n750 ml water\n1 tsp salt\nInstructions\nSimmer 500 g carrots in 750 ml water for 20 minutes.\nBlend the carrots with the cooking water and 1 tsp salt.');
  const batch=f.batches.create([{importId:imported.id}],{...settings(f),imageWorkflow:'reference'});
  const config=JSON.parse(batch.items[0].config_json);assert.equal(config.editorialProfile,'recipe-editorial-v1');assert.equal(config.writingProfile,'recipe-master-v5');
  assert.deepEqual(batch.quote.lines.map(l=>l.kind),['editorial','article']);
  assert.ok(batch.quote.recommendedLimit>=batch.quote.lines.reduce((sum,l)=>sum+l.reservation,0));
  f.approve(batch);await f.drainBatch();assert.equal(f.batches.detail(batch.id).items[0].state,'completed');assert.equal(f.providerCalls.length,2);
  assert.equal(f.providerCalls[0].payload.instructions,config.editorialRequest.instructions);assert.equal(f.providerCalls[1].payload.instructions,config.writingRequest.instructions);
});

test('a title above the article body still yields scoped supporting evidence',()=>{
  const {recipeContext}=require('../.intelligence-build/lib/recipe-intelligence/recipe-context.js');
  const $=load('<h1>Carrot soup</h1><main><article><div class="entry-content"><h2>Helpful tips</h2><p>Blend the cooked carrots with their cooking water until smooth.</p><article><h2>Storage</h2><p>Unrelated recommendation content must not become evidence.</p></article></div></article></main>');
  const evidence=recipeContext($);assert.equal(evidence.length,1);assert.match(evidence[0].text,/Blend/);
});

test('source narration triggers neutral-step correction, private claims are omitted, and FAQ questions appear once',()=>{
  const recipe=require('../.intelligence-build/lib/recipe-intelligence/article.js').extractArticle(html(),'https://food.example/soup').recipe;
  recipe.instructions[1]='I suggest blending the carrots with the cooking water and 1 tsp salt.';
  const raw=draft();raw.instructions=[...recipe.instructions];raw.blog.storage=[{text:'The source specifically recommends keeping this soup covered.',evidenceIds:['S2'],basis:'source'}];raw.blog.faqs[0].text=raw.blog.faqs[0].question+' '+raw.blog.faqs[0].text;
  const checked=validateArticle(raw,recipe,'master_recipe_v1');assert.ok(checked.warnings.some(w=>/Step 2.*first-person/.test(w)));assert.deepEqual(checked.article.blog.storage,[]);assert.doesNotMatch(checked.article.blog.faqs[0].text,/What thickens/);
  assert.equal(publicationIngredient('2 cups shredded cooked chicken ((I used rotisserie))'),'2 cups shredded cooked chicken (rotisserie)');
  assert.equal(publicationIngredient('1/2 teaspoon salt + pepper to taste'),'1/2 teaspoon salt + pepper to taste');
  assert.match(recipe.instructions[1],/^I suggest/,'Private authoritative facts are not rewritten');
});

test('an example abbreviation is not mistaken for grams and does not restore a personal source sentence',()=>{
  const recipe=require('../.intelligence-build/lib/recipe-intelligence/article.js').extractArticle(html(),'https://food.example/soup').recipe;
  recipe.instructions[1]='I suggest blending the carrots with 1 tsp salt (e.g. before serving).';
  const raw=draft();raw.instructions[1]='Blend the carrots with 1 tsp salt before serving.';
  const checked=validateArticle(raw,recipe,'master_recipe_v1');assert.equal(checked.article.instructions[1],raw.instructions[1]);assert.ok(!checked.warnings.some(w=>/Step 2/.test(w)));
  raw.instructions[1]='Blend the carrots with 1 g salt before serving.';
  assert.equal(validateArticle(raw,recipe,'master_recipe_v1').article.instructions[1],recipe.instructions[1],'Real unit changes remain rejected');
  const document=articleDocument({...checked.article,sectionOrder:['storage'],blog:{...checked.article.blog,storage:[{text:'Keep covered in the refrigerator.',evidenceIds:[],basis:'culinary_knowledge'}]}},recipe);
  assert.match(document.html,/<strong>Storage<\/strong>/);assert.doesNotMatch(document.html,/Storage and Reheating/);
});
