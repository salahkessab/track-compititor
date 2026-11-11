const test = require('node:test');
const assert = require('node:assert/strict');
const { contentFixture } = require('./helpers/content-fixtures.cjs');
const { ImportStore, recipeFromText } = require('../.intelligence-build/lib/recipe-intelligence/imports.js');
const { prepareImportEstimate } = require('../.intelligence-build/lib/recipe-intelligence/referenceWorkflow.js');
const { DEFAULT_CONTENT_SETTINGS } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');
const recipeText = 'Carrot Soup\nIngredients\n2 carrots\n1 cup water\nInstructions\n1. Slice the carrots.\n2. Simmer in the water for 20 minutes.\nNotes\nServe warm.';

test('blocked and unfinished sources never produce a zero-price runnable draft', async t => {
  const f = await contentFixture(t), imports = new ImportStore(f.store);
  const row = imports.create('https://food.example/blocked/');
  assert.throws(() => prepareImportEstimate(f.batches, row.id, DEFAULT_CONTENT_SETTINGS), /Still reading/);
  f.responses.set(row.url, {status:403});
  await imports.process(row.id, f.fetcher);
  assert.equal(imports.get(row.id).status, 'failed');
  assert.match(imports.detail(row.id).error, /blocks automatic access/);
  assert.throws(() => prepareImportEstimate(f.batches, row.id, DEFAULT_CONTENT_SETTINGS), /Paste the recipe text/);
  assert.equal(f.batches.list().length, 0);
  assert.equal(f.providerCalls.length, 0);
});

test('pasted recipe gets an honest three-image quote, requires approval, and repeated estimates reuse the draft', async t => {
  const f = await contentFixture(t), imports = new ImportStore(f.store);
  const row = imports.createFromText('https://food.example/blocked/', recipeText);
  const batch = prepareImportEstimate(f.batches, row.id, DEFAULT_CONTENT_SETTINGS);
  assert.equal(batch.quote.pending, 0);
  assert.ok(batch.quote.estimated > 0);
  assert.equal(batch.settings.imageWorkflow, 'legacy');
  assert.deepEqual(batch.quote.lines.filter(l => ['featured','alternate','pinterest'].includes(l.kind)).map(l => l.kind), ['featured','alternate','pinterest']);
  assert.equal(prepareImportEstimate(f.batches, row.id, DEFAULT_CONTENT_SETTINGS).id, batch.id);
  assert.equal(f.batches.list().length, 1);
  await f.drainBatch();
  assert.equal(f.providerCalls.length, 0);
  assert.equal(f.calls.length, 0, 'Pasted text must not fetch the blocked source');
  assert.equal(batch.approved_at, null);
});

test('pasted text retains recipe quantities and steps without inventing timing or fetching a source', () => {
  const recipe = recipeFromText('https://food.example/soup/', recipeText);
  assert.deepEqual(recipe.ingredients, ['2 carrots', '1 cup water']);
  assert.deepEqual(recipe.instructions, ['Slice the carrots.', 'Simmer in the water for 20 minutes.']);
  assert.equal(recipe.cookTime, '');
  assert.equal(recipe.title, 'Carrot Soup');
  assert.throws(() => recipeFromText('https://food.example/soup/', 'Just a title'), /Ingredients heading/);
  assert.throws(() => recipeFromText('http://127.0.0.1/private', recipeText), /public|Blocked|local|network/i);
});

test('pasted recipes generate a saved article and three images without re-fetching blocked pages', async t => {
  const f = await contentFixture(t), imports = new ImportStore(f.store);
  const row = imports.createFromText('https://food.example/blocked/', recipeText);
  const batch = prepareImportEstimate(f.batches, row.id, {...f.defaults, imageWorkflow:'reference', images:true, output:'article_images', correction:false});
  f.approve(batch);
  await f.drainBatch();
  assert.equal(f.calls.length, 0);
  assert.ok(f.providerCalls.length > 0);
  assert.equal(f.providerCalls.filter(c => c.operation === 'image').length, 3);
  const result = f.batches.detail(batch.id);
  assert.equal(result.status, 'completed');
  assert.ok(result.items[0].files.some(file => file.name === 'article.html'));
  assert.ok(result.items[0].files.some(file => file.name === 'featured.jpg'));
});
