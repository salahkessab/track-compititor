const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { contentFixture, html, article, textResponse } = require('./helpers/content-fixtures.cjs');
const { extractArticle } = require('../.intelligence-build/lib/recipe-intelligence/article.js');
const { articleDocument } = require('../.intelligence-build/lib/recipe-intelligence/article-document.js');
const { validateArticle } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { MASTER_PROMPT_VERSION, MASTER_RECIPE_PROMPT, articleSchema, writingPayload } = require('../.intelligence-build/lib/recipe-intelligence/prompts.js');
const { DEFAULT_CONTENT_SETTINGS, validateContentSettings } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');
const format = 'master_recipe_v1';
const source = () => extractArticle(html(), 'https://food.example/soup').recipe;
const supported = (text, ...evidenceIds) => ({text,evidenceIds,basis:'source'});
const general = text => ({text,evidenceIds:[],basis:'culinary_knowledge'});
const draft = () => ({...article(), articleTitle:'Carrot soup', editorialNotes:[], blog:{
  whyMake:[], ingredientNotes:[{ingredientIndex:0,...general('Carrots give the soup body when blended.')}],
  timeNote:[], variations:[], serving:[], storage:[], proTips:[], faqs:[], conclusion:''
}});

test('new default runs the complete master brief with a strict schema and no legacy length target', () => {
  assert.equal(DEFAULT_CONTENT_SETTINGS.articleFormat,format);
  assert.equal(validateContentSettings({}).articleFormat,format);
  const payload=writingPayload(source(),DEFAULT_CONTENT_SETTINGS);
  assert.ok(payload.input.startsWith(MASTER_RECIPE_PROMPT));
  assert.equal(MASTER_PROMPT_VERSION,'recipe-master-v5');
  assert.match(payload.input,/MASTER PROMPT V4 — PREMIUM RECIPE ARTICLE WRITER/);
  assert.match(payload.input,/Quality matters more than word count/);
  assert.match(payload.input,/18\. SOURCE PRIVACY AND EDITORIAL INDEPENDENCE/);
  assert.match(payload.input,/Never remove attribution in a way that falsely presents/);
  assert.doesNotMatch(payload.input,/Plan for approximately 1,100|add about \d+ useful words|1,000–1,200-word target/);
  assert.equal(payload.text.format.schema,articleSchema(format));
  const strict=schema=>{if(schema.type==='object'){assert.equal(schema.additionalProperties,false);assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());Object.values(schema.properties).forEach(strict);}if(schema.items)strict(schema.items);};
  strict(payload.text.format.schema);
  const corrected=writingPayload(source(),DEFAULT_CONTENT_SETTINGS,{draft:{...draft(),wordCount:400},warnings:['Check a source fact']});
  assert.doesNotMatch(corrected.input,/add about 700|Aim for about 1,100/);
});

test('master renderer follows section order, keeps full ingredients in the card, and omits empty optional sections',()=>{
  const recipe=source(),raw=draft();
  raw.blog.whyMake=[supported('The carrots are blended with their cooking water.','S2')];
  raw.blog.proTips=[general('Blend until the texture is even.')];
  raw.blog.serving=[general('Serve in bowls.')];
  raw.blog.storage=[general('Keep leftovers covered in the refrigerator.')];
  raw.blog.variations=[supported('Keep the listed salt quantity for the original recipe.','I3')];
  raw.blog.faqs=[{question:'What gives this soup its body?',...general('Blended carrots give the soup body.')}];
  raw.editorialNotes=['Editorial-only source clarification.'];
  const checked=validateArticle(raw,recipe,format);assert.deepEqual(checked.warnings,[]);
  const rendered=articleDocument(checked.article,recipe),$=load(rendered.html);
  assert.deepEqual($('h2').map((_,el)=>$(el).text()).get(),['What Makes This Recipe Special','Ingredients and Why They Work','How to Make Carrot soup','Tips for the Best Results','What to Serve With Carrot soup','Storage and Reheating','Substitutions and Variations','Frequently Asked Questions','Complete Recipe Card']);
  const explanation=$('h2').filter((_,el)=>$(el).text()==='Ingredients and Why They Work').nextUntil('h2');
  assert.equal(explanation.find('li').length,0,'The ingredient explanation does not repeat the complete ingredient list');
  const ingredientsHeading=$('h3').filter((_,el)=>$(el).text()==='Ingredients');
  assert.deepEqual(ingredientsHeading.next('ul').find('li').map((_,el)=>$(el).text()).get(),recipe.ingredients);
  assert.doesNotMatch(rendered.html,/Editorial-only|Conclusion/);
  assert.match(rendered.text,/Prep time: 10 minutes/);assert.match(rendered.text,/Servings: 4 servings/);
  const minimal=validateArticle(draft(),recipe,format);
  assert.deepEqual(minimal.warnings,[]);assert.ok(minimal.article.wordCount<1000);
  assert.doesNotMatch(articleDocument(minimal.article,recipe).text,/Frequently Asked Questions|Conclusion|What Makes This Recipe Special/);
});

test('general culinary explanations remain distinct from source facts; unsupported durations and changed steps are rejected',()=>{
  const recipe=source(),raw=draft();
  raw.blog.storage=[general('Refrigerate for three weeks.'),general('Freeze for 365 days.')];
  raw.blog.proTips=[general('Blending creates a smoother texture.'),general('My family asks for this every birthday.')];
  raw.instructions[0]=raw.instructions[0].replace('20 minutes','90 minutes');
  const checked=validateArticle(raw,recipe,format);
  assert.deepEqual(checked.article.instructions,recipe.instructions);
  assert.deepEqual(checked.article.blog.storage,[]);
  assert.equal(checked.article.blog.proTips.length,1);
  assert.equal(checked.article.blog.proTips[0].basis,'culinary_knowledge');
  assert.deepEqual(checked.article.blog.proTips[0].evidenceIds,[]);
  assert.ok(checked.warnings.some(w=>/duration/.test(w)));
  assert.doesNotMatch(checked.warnings.join(' '),/1,000|three supported FAQs|closing paragraph/);
});

test('a concise master article saves after analysis and writing, with editorial notes outside publishable output',async t=>{
  const raw=draft();raw.editorialNotes=['Check the supplied serving-size discrepancy.'];
  const f=await contentFixture(t,{provider:async(_op,payload)=>textResponse(payload.text.format.name==='recipe_editorial_brief'?{sourceFormat:'Practical guide',readerNeed:'Make smooth soup',angle:'Blended carrot texture',openingApproach:'Texture',openingBrief:'Explain the texture of the blended carrots.',focusPoints:[],sectionOrder:[],omitSections:[],avoidPatterns:[],sourceLimitations:[]}:raw)}),row=f.seed();
  const batch=f.batches.create([{recipeId:row.id}],{...f.defaults,articleFormat:format});
  assert.equal(batch.quote.promptVersion,MASTER_PROMPT_VERSION);
  await f.drainBatch();assert.equal(f.providerCalls.length,0);
  f.approve(batch);await f.drainBatch();
  const result=f.batches.detail(batch.id),item=result.items[0];
  assert.equal(result.status,'completed');assert.equal(f.providerCalls.length,2,'One analysis and one writing call; no correction just for short length, optional sections or editorial notes');
  assert.ok(f.providerCalls[1].payload.input.startsWith(MASTER_RECIPE_PROMPT));
  assert.ok(item.warnings.some(w=>w.includes(raw.editorialNotes[0])));
  const read=name=>f.batches.artifacts.read(item.files.find(file=>file.name===name).id).data.toString();
  assert.match(read('editorial-notes.txt'),/serving-size discrepancy/);
  for(const name of ['article.html','article.txt','article.md'])assert.doesNotMatch(read(name),/serving-size discrepancy/);
  const card=JSON.parse(read('recipe.json')).recipeCard;
  assert.deepEqual(card.recipeIngredient,source().ingredients);assert.equal(card.description,raw.metaDescription);
});

test('source branding and research records stay out of publication artifacts without changing recipe facts',async t=>{
  const f=await contentFixture(t),row=f.seed(),batch=f.batches.create([{recipeId:row.id}],{...f.defaults,articleFormat:format});
  const item=f.batches.item(batch.items[0].id),recipe=source();
  recipe.title="Jane Doe's Carrot Soup | Competitor Kitchen";
  recipe.url='https://competitor.example/jane-doe/carrot-soup';
  const raw=draft();raw.editorialNotes=['Omitted Jane Doe’s personal research claim; attribution would be needed.'];
  const checked=validateArticle(raw,recipe,format);
  assert.deepEqual(checked.article.instructions,recipe.instructions);
  const rendered=articleDocument(checked.article,recipe,[{kind:'reference',placement:'hero',caption:'Photo by Jane Doe for Competitor Kitchen',dataUri:'data:image/jpeg;base64,AA==',fileName:'edited.jpg',width:1200,height:800}]);
  assert.match(rendered.html,/<h1><strong>Carrot soup<\/strong><\/h1>/);
  assert.doesNotMatch(JSON.stringify(rendered),/Jane Doe|Competitor Kitchen|competitor\.example|Recipe source/i);
  f.batches.artifacts.article(item,checked.article,recipe);
  const read=name=>f.batches.artifacts.read(f.store.db.prepare('SELECT id FROM artifacts WHERE item_id=? AND name=?').get(item.id,name).id).data.toString();
  for(const name of ['article.html','article.md','article.txt','recipe.json','seo.json']) assert.doesNotMatch(read(name),/Jane Doe|Competitor Kitchen|competitor\.example|Recipe source|isBasedOn|authoritativeRecipe/i,name);
  const card=JSON.parse(read('recipe.json')).recipeCard;
  assert.equal(card.name,'Carrot soup');assert.deepEqual(card.recipeIngredient,recipe.ingredients);
  assert.deepEqual(card.recipeInstructions.map(step=>step.text),recipe.instructions);
  assert.equal(card.cookTime,recipe.cookTime);assert.equal(card.recipeYield,recipe.yield);
  assert.deepEqual(JSON.parse(read('source.json')).recipe,recipe);
  assert.match(read('editorial-notes.txt'),/Jane Doe.*attribution/);
  assert.equal(f.providerCalls.length,0);
});

test('legacy formats also stop appending research URLs without deleting the source snapshot',()=>{
  const recipe=source(),before=structuredClone(recipe);
  for(const format of ['compact_v1','blog_1000_1200_v1']){
    const rendered=articleDocument(validateArticle(draft(),recipe,format).article,recipe);
    for(const text of [rendered.html,rendered.markdown,rendered.text]) assert.doesNotMatch(text,/Recipe source|food\.example/);
  }
  assert.deepEqual(recipe,before);
});

test('a zero source cook time for a simmered dish is kept privately and omitted from the published card',async t=>{
  const f=await contentFixture(t),row=f.seed(),batch=f.batches.create([{recipeId:row.id}],{...f.defaults,articleFormat:format});
  const recipe={...source(),cookTime:'PT0S',displayTimes:{cookTime:'0 seconds'}};
  const checked=validateArticle(draft(),recipe,format);
  assert.deepEqual(checked.warnings,[]);
  assert.ok(checked.article.editorialNotes.some(note=>/zero cook time/.test(note)));
  const item=f.batches.item(batch.items[0].id);f.batches.artifacts.article(item,checked.article,recipe);
  const read=name=>f.batches.artifacts.read(f.store.db.prepare('SELECT id FROM artifacts WHERE item_id=? AND name=?').get(item.id,name).id).data.toString();
  assert.doesNotMatch(read('article.html'),/0 seconds|PT0S|zero cook time/);
  const card=JSON.parse(read('recipe.json')).recipeCard;
  assert.equal(card.cookTime,undefined);assert.equal(card.prepTime,recipe.prepTime);assert.equal(card.totalTime,recipe.totalTime);
  assert.equal(JSON.parse(read('source.json')).recipe.cookTime,'PT0S');
});
