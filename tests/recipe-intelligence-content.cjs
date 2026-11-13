const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { load } = require('cheerio');
const { contentFixture, recipeData, html, article, textResponse } = require('./helpers/content-fixtures.cjs');
const { selectRecipe, BatchStore } = require('../.intelligence-build/lib/recipe-intelligence/batches.js');
const { extractArticle } = require('../.intelligence-build/lib/recipe-intelligence/article.js');
const { validateArticle, atomicWrite, digest } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { articlePrompt, HUMANIZER_VERSION } = require('../.intelligence-build/lib/recipe-intelligence/prompts.js');
const { stageEstimate, checkModels, ProviderFailure, OpenAIContentProvider } = require('../.intelligence-build/lib/recipe-intelligence/provider.js');
const { estimateOpenAIImageOutput } = require('../.intelligence-build/lib/imagePricing.js');

test('no content calls occur before explicit estimate approval, even with a configured API key', async t => {
  const f = await contentFixture(t); const r = f.seed(); const batch = f.batches.create([{ recipeId: r.id }], f.defaults);
  assert.equal(batch.status, 'awaiting_cost_approval'); await f.drainBatch(); assert.equal(f.providerCalls.length, 0);
  assert.throws(() => f.batches.approve(batch.id, 1, 'old-quote'), /current batch estimate/);
  assert.throws(() => f.batches.approve(batch.id, 1, batch.quote.createdAt), /free model compatibility/);
  f.approve(batch); await f.drainBatch(); assert.equal(f.providerCalls.length, 1); assert.equal(f.batches.detail(batch.id).status, 'completed');
});
test('batch captures settings and keeps original ingredients, amounts, cooking facts and Humanizer instructions', async t => {
  const f = await contentFixture(t); const r = f.seed(); const b = f.batches.create([{ recipeId: r.id }], f.defaults);
  f.store.db.prepare("INSERT INTO settings(key,value) VALUES('content_defaults',?)").run(JSON.stringify({ ...f.defaults, basis: 'best_complete', mode: 'before_images' }));
  f.approve(b); await f.drainBatch(); const result = f.batches.detail(b.id); const item = result.items[0];
  assert.equal(result.settings.mode, 'full'); assert.equal(item.basis, 'original'); assert.equal(f.providerCalls.length, 1);
  const prompt = f.providerCalls[0].payload.input; assert.match(prompt, /Treat retrieved pages/); assert.match(prompt, /Do not invent personal/); assert.match(prompt, /500 g carrots/); assert.ok(HUMANIZER_VERSION.startsWith('recipe-humanizer-3'));
  const recipeFile = f.batches.artifacts.read(item.files.find(file => file.name === 'recipe.json').id);
  const facts = JSON.parse(recipeFile.data); assert.deepEqual(facts.recipeCard.recipeIngredient, recipeData().recipeIngredient);
  assert.equal(facts.recipeCard.cookTime, 'PT20M'); assert.equal(facts.recipeCard.recipeYield, '4 servings');
  const htmlFile = f.batches.artifacts.read(item.files.find(file => file.name === 'article.html').id).data.toString(); assert.match(htmlFile, /500 g carrots/);
  assert.ok(item.files.some(x => x.name === 'manifest.json')); assert.ok(item.files.some(x => x.name === 'research-sources.json'));
});
test('review before articles waits after source extraction; approval wakes a waiting batch', async t => {
  const f = await contentFixture(t); const r = f.seed(); const b = f.batches.create([{ recipeId: r.id }], { ...f.defaults, mode: 'before_articles' }); f.approve(b);
  await f.drainBatch(); let result = f.batches.detail(b.id); assert.equal(result.status, 'needs_review'); assert.equal(result.items[0].review_kind, 'article'); assert.equal(f.providerCalls.length, 0);
  f.batches.approveItem(result.items[0].id); await f.drainBatch(); assert.equal(f.batches.detail(b.id).status, 'completed'); assert.equal(f.providerCalls.length, 1);
});
test('source extraction notes remain advisory and do not trigger a paid correction', async t => {
  const f = await contentFixture(t); const recipe = f.seed();
  const row = f.store.db.prepare('SELECT recipe_json FROM recipe_records WHERE id=?').get(recipe.id);
  const source = { ...JSON.parse(row.recipe_json), extractionMethod: 'html_sections', sourceNotes: ['Approximate total omitted; step timings retained.'] };
  f.store.db.prepare('UPDATE recipe_records SET recipe_json=? WHERE id=?').run(JSON.stringify(source), recipe.id);
  const batch = f.batches.create([{ recipeId: recipe.id }], f.defaults); f.approve(batch); await f.drainBatch();
  const result = f.batches.detail(batch.id); assert.equal(result.status, 'completed'); assert.equal(f.providerCalls.length, 1);
  assert.ok(result.items[0].warnings.includes(source.sourceNotes[0]));
});
test('review before images saves the article first, then creates exact-size images with separate statuses', async t => {
  const f = await contentFixture(t); const r = f.seed(); const b = f.batches.create([{ recipeId: r.id }], { ...f.defaults, images: true, mode: 'before_images', pinterestTitle: true }); f.approve(b);
  await f.drainBatch(); let result = f.batches.detail(b.id); let item = result.items[0];
  assert.equal(item.review_kind, 'images'); assert.ok(item.files.some(x => x.name === 'article.html')); assert.equal(f.providerCalls.length, 1);
  const wordsBefore = item.article.wordCount;
  const read = name => f.batches.artifacts.read(item.files.find(x => x.name === name).id).data;
  assert.equal(load(read('article.html'))('img').length, 0);
  f.batches.approveItem(item.id); await f.drainBatch(); item = f.batches.detail(b.id).items[0];
  for (const [name, width] of [['featured.webp', 1200], ['alternate.webp', 1200], ['pinterest.webp', 1000]]) {
    const file = f.batches.artifacts.read(item.files.find(f => f.name === name).id); const image = await sharp(file.data).metadata(); assert.equal(image.width, width); assert.equal(image.height, 1500);
  }
  assert.equal(f.providerCalls.filter(c => c.operation === 'image').length, 3); assert.equal(item.state, 'completed');
  for (const call of f.providerCalls.filter(c => c.operation === 'image')) assert.equal('complexity' in call.payload, false);
  const $ = load(read('article.html')); assert.equal($('img').length, 3);
  for (const [i, name] of ['featured.webp', 'alternate.webp', 'pinterest.webp'].entries()) {
    assert.equal($('img').eq(i).attr('src'), name);
    assert.ok(read('article.md').toString().includes(`](${name})`));
  }
  assert.deepEqual(JSON.parse(read('recipe.json')).recipeCard.image, ['featured.webp', 'alternate.webp', 'pinterest.webp']);
  assert.equal(JSON.parse(read('seo.json')).wordCount, wordsBefore);
  f.batches.artifacts.article(f.batches.item(item.id), item.article, item.source);
  assert.equal(load(read('article.html'))('img').length, 3); assert.equal(f.providerCalls.length, 4);
});

test('known-source batch quotes reflect request size and can fit a twenty-cent medium-image test', async t => {
  const f = await contentFixture(t); const row = f.seed();
  const settings = { ...f.defaults, articleFormat: 'blog_1000_1200_v1', images: true, imageSettings: { ...f.defaults.imageSettings, quality: 'medium' } };
  const b = f.batches.create([{ recipeId: row.id }], settings);
  assert.ok(b.quote.estimated < 0.20); assert.equal(b.quote.lines.length, 6); assert.ok(b.quote.lines.some(l => l.kind === 'refinement'));
  const line = kind => b.quote.lines.find(x => x.kind === kind);
  assert.equal(line('correction').inputBytes - line('article').inputBytes, 12000);
  assert.ok(line('featured').inputBytes < line('article').inputBytes);
  const original = JSON.parse(f.store.db.prepare('SELECT recipe_json FROM recipe_records WHERE id=?').get(row.id).recipe_json);
  f.store.db.prepare('UPDATE recipe_records SET recipe_json=? WHERE id=?').run(JSON.stringify({ ...original, description: 'Supported source description. '.repeat(100) }), row.id);
  const longer = f.batches.create([{ recipeId: row.id }], settings);
  assert.ok(longer.quote.estimated > b.quote.estimated);
  const researched = f.batches.create([{ recipeId: row.id, basis: 'best_complete' }], settings);
  assert.ok(researched.quote.lines.every(x => x.kind === 'refinement' ? x.inputBytes === 24000 : x.inputBytes >= 32000));
  assert.equal(f.providerCalls.length, 0);
  // Keep the actual scheduling guard; a new estimate is never authority to overspend.
  f.approve(b, 0.20); await f.drainBatch();
  assert.ok(f.batches.detail(b.id).budget.actual <= 0.20);
});
test('research suggestions wait for a manual recipe choice while other recipes finish', async t => {
  const f = await contentFixture(t); const a = f.seed('ambiguous'); const b = f.seed('normal');
  const alternative = 'https://other.example/carrot-soup'; f.responses.set(alternative, html());
  const batch = f.batches.create([{ recipeId: a.id, basis: 'best_complete', alternativeUrls: [alternative] }, { recipeId: b.id }], f.defaults); f.approve(batch); await f.drainBatch();
  let result = f.batches.detail(batch.id); const ambiguous = result.items.find(i => i.recipe_id === a.id); assert.equal(ambiguous.state, 'review'); assert.equal(ambiguous.review_kind, 'research'); assert.equal(result.items.find(i => i.recipe_id === b.id).state, 'completed');
  assert.notEqual(ambiguous.source.url, alternative); assert.equal(ambiguous.research.length, 2);
  assert.throws(() => f.batches.approveItem(ambiguous.id, 'https://unlisted.example/recipe'), /source|recipe/i);
  assert.equal(f.providerCalls.length, 1); f.batches.approveItem(ambiguous.id, alternative); await f.drainBatch();
  result = f.batches.detail(batch.id); assert.equal(result.status, 'completed'); assert.equal(result.items.find(i => i.recipe_id === a.id).source.url, alternative);
  const full = extractArticle(html(), 'https://a.example/soup').recipe; const sparse = { ...full, yield: '', prepTime: '', cookTime: '', totalTime: '' };
  const selected = selectRecipe(sparse, [{ url: 'https://b.example/soup', recipe: { ...full, url: 'https://b.example/soup' } }]);
  assert.equal(selected.source.url, 'https://b.example/soup'); assert.match(selected.reason, /additional explicit recipe facts/);
});
test('advisory checks restore changed numerical steps and omit unsupported tips; only one correction is attempted', async t => {
  const malformed = { ...article(), instructions: ['Simmer 900 g carrots in 750 ml water for 70 minutes.', article().instructions[1]], tips: ['Use coconut milk instead.'], metaDescription: '' };
  const source = extractArticle(html(), 'https://food.example/soup').recipe;
  const checked = validateArticle(malformed, source); assert.equal(checked.article.instructions[0], source.instructions[0]); assert.deepEqual(checked.article.tips, []);
  const f = await contentFixture(t, { provider: async () => textResponse(malformed) }); const r = f.seed(); const b = f.batches.create([{ recipeId: r.id }], f.defaults); f.approve(b); await f.drainBatch();
  const item = f.batches.detail(b.id).items[0]; assert.equal(item.state, 'completed'); assert.equal(item.correction_attempted, 1); assert.equal(f.providerCalls.length, 2); assert.ok(item.warnings.length);
  assert.match(f.providerCalls[1].payload.input, /One correction request/); assert.throws(() => f.batches.retry(item.id, 'correction'), /single optional correction/);
});
test('insufficient approved budget stops scheduling while preserving completed output', async t => {
  const f = await contentFixture(t); const a = f.seed('a'); const b = f.seed('b'); const batch = f.batches.create([{ recipeId: a.id }, { recipeId: b.id }], f.defaults);
  f.approve(batch, .001); await f.drainBatch(); assert.equal(f.providerCalls.length, 0); assert.equal(f.batches.detail(batch.id).status, 'budget_wait');
  f.approve(batch, 2); await f.drainBatch(); assert.equal(f.providerCalls.length, 2); assert.equal(f.batches.detail(batch.id).status, 'completed');
});
test('unknown paid outcome keeps its reservation, does not auto-repeat, and other recipes finish', async t => {
  const f = await contentFixture(t, { provider: async (_op, _payload, _signal, n) => { if (n === 1) throw new Error('Connection ended after sending'); return textResponse(article()); } });
  const a = f.seed('a'); const b = f.seed('b'); const batch = f.batches.create([{ recipeId: a.id }, { recipeId: b.id }], f.defaults); f.approve(batch); await f.drainBatch();
  let result = f.batches.detail(batch.id); const failed = result.items.find(i => i.recipe_id === a.id);
  assert.equal(result.items.find(i => i.recipe_id === b.id).state, 'completed'); assert.equal(result.budget.uncertain, 1); assert.ok(result.budget.held > 0);
  f.batches.recover(); await f.drainBatch(); assert.equal(f.providerCalls.length, 2); assert.throws(() => f.batches.retry(failed.id, 'article'), /Resolve this uncertain/);
  const call = result.calls.find(c => c.state === 'uncertain'); f.batches.resolveCall(call.id, .02, 'Provider billing confirmed charge'); assert.equal(f.providerCalls.length, 2);
  f.batches.retry(failed.id, 'article'); await f.drainBatch(); assert.equal(f.providerCalls.length, 3); assert.equal(f.batches.detail(batch.id).status, 'completed');
});
test('an interrupted provider body retains its request ID for billing reconciliation without retrying', async t => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'mock-provider-key';
  t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); requests++;
    return new Response(new ReadableStream({ pull(controller) { controller.error(new Error('Response body disconnected')); } }), {
      status: 200, headers: { 'x-request-id': 'req-interrupted-response' },
    });
  });
  const f = await contentFixture(t); const provider = new OpenAIContentProvider();
  f.provider.request = (...args) => provider.request(...args);
  const recipe = f.seed(); const batch = f.batches.create([{ recipeId: recipe.id }], f.defaults);
  f.approve(batch); await f.drainBatch();
  const call = f.batches.detail(batch.id).calls[0];
  assert.equal(call.state, 'uncertain'); assert.equal(call.provider_id, 'req-interrupted-response');
  assert.ok(f.batches.budget(batch.id).held > 0);
  f.batches.recover(); await f.drainBatch(); assert.equal(requests, 1);
});
test('image failure does not stop other images or articles; targeted retry reuses successful paid stages', async t => {
  let png; let imageCalls = 0;
  const f = await contentFixture(t, { provider: async op => {
    if (op === 'text') return textResponse(article());
    imageCalls++; if (imageCalls === 1) throw new ProviderFailure('Model request rejected', true);
    return { body: { data: [{ b64_json: png }], usage: { input_tokens: 10, output_tokens: 1372, input_tokens_details: { text_tokens: 10, image_tokens: 0 } } }, requestId: 'image' };
  } }); png = f.image.toString('base64'); const r = f.seed(); const b = f.batches.create([{ recipeId: r.id }], { ...f.defaults, images: true }); f.approve(b); await f.drainBatch();
  let item = f.batches.detail(b.id).items[0]; assert.equal(item.state, 'partial'); assert.ok(item.files.some(f => f.name === 'alternate.webp')); assert.ok(item.files.some(f => f.name === 'article.html'));
  f.batches.retry(item.id, 'featured'); await f.drainBatch(); item = f.batches.detail(b.id).items[0]; assert.equal(item.state, 'completed'); assert.equal(imageCalls, 4); assert.equal(f.providerCalls.filter(c => c.operation === 'text').length, 1);
  f.batches.retry(item.id, 'featured', true); await f.drainBatch(); assert.equal(imageCalls, 5); assert.equal(f.providerCalls.filter(c => c.operation === 'text').length, 1);
  const saved = f.store.db.prepare("SELECT * FROM artifacts WHERE item_id=? AND name='featured.webp'").get(item.id);
  fs.writeFileSync(path.join(f.root, saved.relative_path), 'corrupt'); assert.throws(() => f.batches.artifacts.read(saved.id), /checksum/);
  f.batches.retry(item.id, 'featured'); await f.drainBatch(); assert.equal(imageCalls, 5); assert.equal((await sharp(f.batches.artifacts.read(saved.id).data).metadata()).width, 1200);
});
test('a response saved before a crash is reused even when the prompt changes after an upgrade', async t => {
  const f = await contentFixture(t); const r = f.seed(); const b = f.batches.create([{ recipeId: r.id }], f.defaults); f.approve(b);
  await f.batchEngine.process(f.batches.claim(f.owner)); await f.batchEngine.process(f.batches.claim(f.owner));
  const stage = f.batches.claim(f.owner); assert.equal(stage.kind, 'article');
  const payload = { model: f.defaults.textModel, store: false, instructions: require('../.intelligence-build/lib/recipe-intelligence/prompts.js').CONTENT_INSTRUCTIONS, reasoning: { effort: 'none' }, max_output_tokens: 6500, text: { format: { type: 'json_schema', name: 'recipe_article', strict: true, schema: require('../.intelligence-build/lib/recipe-intelligence/prompts.js').ARTICLE_SCHEMA } }, input: articlePrompt(JSON.parse(f.batches.item(stage.item_id).source_json)) };
  const callId = 'crash-receipt'; f.store.db.prepare("INSERT INTO api_calls(id,batch_id,stage_id,model,operation,state,reserved_usd,request_hash,created_at) VALUES(?,?,?,?,'text','dispatched',1,?,?)").run(callId, b.id, stage.id, f.defaults.textModel, 'hash-from-older-prompt-version', new Date().toISOString());
  atomicWrite(f.root, f.batches.receiptPath(callId), JSON.stringify(textResponse(article())));
  f.batches.recover(); await f.drainBatch(); assert.equal(f.providerCalls.length, 0); assert.equal(f.batches.detail(b.id).status, 'completed');
});
test('file checksum failure can be repaired with a local save retry and no repeat AI calls', async t => {
  const f = await contentFixture(t); const r = f.seed(); const b = f.batches.create([{ recipeId: r.id }], f.defaults); f.approve(b); await f.drainBatch();
  const item = f.batches.detail(b.id).items[0]; const file = f.store.db.prepare("SELECT * FROM artifacts WHERE item_id=? AND name='article.html'").get(item.id);
  fs.writeFileSync(path.join(f.root, file.relative_path), 'corrupt'); assert.throws(() => f.batches.artifacts.read(file.id), /checksum/);
  f.batches.artifacts.article(f.batches.item(item.id), item.article, item.source); assert.match(f.batches.artifacts.read(file.id).data.toString(), /<!doctype html>/); assert.equal(f.providerCalls.length, 1);
});
test('Image 2.6 model-specific estimates, Flare controls, usage charges and free compatibility metadata', async t => {
  const f = await contentFixture(t); const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key'; t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  const settings = { ...f.defaults, images: true, imageModel: 'gpt-image-2.6-flare', imageSettings: { ...f.defaults.imageSettings, quality: 'medium', complexity: 'low' } };
  const urls = []; const result = await checkModels(f.store, settings, async (url, init = {}) => {
    urls.push({ url, method: init.method }); return new Response(url.includes('api.openai.com') ? '{"id":"model"}' : url.includes('/_astro/') ? '"gpt-image-2.6" low:4.2 medium:3.3' : '<main>gpt-5.4-mini gpt-image-2.6-flare Sunburst Flare complexity $0.75 $4.50 $5 $8 $30</main><astro-island component-url="/_astro/GptImageTokenCalculator.js"></astro-island>', { status: 200 });
  });
  assert.equal(result.checks.every(c => c.account === 'listed' && c.documented && c.pricingMatches), true); assert.equal(urls.some(u => u.method === 'POST'), false);
  assert.equal(estimateOpenAIImageOutput('gpt-image-2.6-flare', '1024x1536', 'medium'), 1132 * 30 / 1e6);
  assert.notEqual(estimateOpenAIImageOutput('gpt-image-2.6-flare', '1024x1536', 'medium'), estimateOpenAIImageOutput('gpt-image-2.5-flare', '1024x1536', 'medium'));
  assert.ok(stageEstimate('featured', settings).reservation > stageEstimate('featured', settings).estimated);
});

test('article regeneration creates a new version and reuses all completed images', async t => {
  const f = await contentFixture(t); const r = f.seed(); const batch = f.batches.create([{ recipeId: r.id }], { ...f.defaults, images: true }); f.approve(batch); await f.drainBatch();
  let item = f.batches.detail(batch.id).items[0]; const imageCalls = f.providerCalls.filter(c => c.operation === 'image').length;
  f.batches.retry(item.id, 'article', true); await f.drainBatch(); item = f.batches.detail(batch.id).items[0];
  assert.equal(item.version, 2); assert.equal(item.state, 'completed'); assert.equal(f.providerCalls.filter(c => c.operation === 'image').length, imageCalls);
  assert.equal(f.providerCalls.filter(c => c.operation === 'text').length, 2);
  assert.ok(fs.existsSync(path.join(f.root, 'articles', item.id, 'v1', 'article.html')));
  assert.ok(fs.existsSync(path.join(f.root, 'articles', item.id, 'v2', 'featured.webp')));
});

test('missing usage remains reserved without blocking other work or discarding its successful article', async t => {
  const f = await contentFixture(t, { provider: async () => { const result = textResponse(article()); delete result.body.usage; return result; } });
  const a = f.seed('a'); const b = f.seed('b'); const batch = f.batches.create([{ recipeId: a.id }, { recipeId: b.id }], f.defaults); f.approve(batch); await f.drainBatch();
  const result = f.batches.detail(batch.id); assert.equal(result.status, 'completed'); assert.equal(result.budget.uncertain, 2); assert.ok(result.budget.held > 0); assert.equal(result.budget.actual, 0);
  assert.equal(result.items.every(i => i.files.some(f => f.name === 'article.html')), true);
});

test('a process interruption without a receipt becomes uncertain and cannot be requeued', async t => {
  const f = await contentFixture(t); const r = f.seed(); const batch = f.batches.create([{ recipeId: r.id }], f.defaults); f.approve(batch);
  await f.batchEngine.process(f.batches.claim(f.owner)); await f.batchEngine.process(f.batches.claim(f.owner)); const stage = f.batches.claim(f.owner);
  f.store.db.prepare("INSERT INTO api_calls(id,batch_id,stage_id,model,operation,state,reserved_usd,request_hash,created_at) VALUES('lost',?,?,?,'text','dispatched',.1,'hash',?)").run(batch.id, stage.id, f.defaults.textModel, new Date().toISOString());
  f.batches.recover(); f.batches.refresh(); const result = f.batches.detail(batch.id); assert.equal(result.items[0].state, 'failed'); assert.equal(result.calls[0].state, 'uncertain');
  assert.throws(() => f.batches.retry(result.items[0].id, 'article'), /Resolve this uncertain/); assert.equal(f.providerCalls.length, 0);
});

test('unit changes, altered cooking methods and script content cannot silently replace supported steps or preview HTML', async t => {
  const source = extractArticle(html(), 'https://food.example/soup').recipe;
  for (const step of ['Boil 500 g carrots in 750 ml water for 20 minutes.', 'Simmer 500 oz carrots in 750 ml water for 20 minutes.']) {
    const result = validateArticle({ ...article(), instructions: [step, article().instructions[1]] }, source);
    assert.equal(result.article.instructions[0], source.instructions[0]); assert.ok(result.warnings.length);
  }
  const f = await contentFixture(t, { provider: async () => textResponse({ ...article(), introduction: '<script>alert(1)</script><img src=x onerror=alert(2)>Dinner.' }) }); const r = f.seed(); const batch = f.batches.create([{ recipeId: r.id }], f.defaults); f.approve(batch); await f.drainBatch();
  const item = f.batches.detail(batch.id).items[0]; const saved = f.batches.artifacts.read(item.files.find(f => f.name === 'article.html').id).data.toString(); assert.equal(saved.includes('onerror='), false); assert.equal(saved.includes('<script>alert'), false);
});
