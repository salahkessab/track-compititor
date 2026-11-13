const test = require('node:test');
const assert = require('node:assert/strict');
const { contentFixture, textResponse, article } = require('./helpers/content-fixtures.cjs');
const { DEFAULT_CONTENT_SETTINGS, validateContentSettings, saveContentSettings } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');
const { textCost, actualCost, stageEstimate, checkModels, OpenAIContentProvider } = require('../.intelligence-build/lib/recipe-intelligence/provider.js');
const { referenceImagePayload, referenceImageEstimate } = require('../.intelligence-build/lib/recipe-intelligence/referenceImages.js');

const settings55 = { ...DEFAULT_CONTENT_SETTINGS, textModel: 'gpt-5.5', imageSettings: { ...DEFAULT_CONTENT_SETTINGS.imageSettings, size: '1536x864' } };
function apiKey(t) {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; });
}

test('GPT-5.5 uses its own cached-input and output prices, including the long-context boundary', () => {
  const usage = { input_tokens: 1000, output_tokens: 500, input_tokens_details: { cached_tokens: 200 } };
  assert.equal(actualCost('text', 'gpt-5.5', { usage, output: [{ type: 'web_search_call' }] }), .0291);
  assert.equal(textCost(usage), .002865);
  assert.equal(textCost({ input_tokens: 272000, output_tokens: 1000 }, 0, 'gpt-5.5'), 1.39);
  assert.equal(textCost({ input_tokens: 272001, output_tokens: 1000, input_tokens_details: { cached_tokens: 1000 } }, 0, 'gpt-5.5'), 2.75601);
  assert.equal(textCost(usage, 0, 'gpt-unknown'), null);
  assert.equal(textCost({ ...usage, input_tokens_details: { cached_tokens: 1001 } }, 0, 'gpt-5.5'), null);
  assert.equal(textCost({ output_tokens: 500 }, 0, 'gpt-5.5'), null);
});

test('GPT-5.5 quotes use the requested model and retain legacy mini pricing', () => {
  assert.equal(validateContentSettings(settings55).textModel, 'gpt-5.5');
  assert.throws(() => validateContentSettings({ textModel: 'gpt-unknown' }), /pricing profile/);
  const quote = stageEstimate('article', settings55, 3000);
  assert.equal(quote.estimated, .095);
  assert.equal(quote.reservation, .22);
  assert.match(quote.basis, /GPT-5.5/);
  assert.ok(quote.estimated > stageEstimate('article', { ...DEFAULT_CONTENT_SETTINGS, textModel: 'gpt-5.4-mini' }, 3000).estimated);
  assert.equal(stageEstimate('research', settings55).reservation, .6);
});

test('GPT-5.5 batch dispatch and settlement use its captured settings without changing earlier batches', async t => {
  const f = await contentFixture(t); const recipe = f.seed();
  const old = f.batches.create([{ recipeId: recipe.id }], f.defaults);
  saveContentSettings(f.store, { ...f.defaults, textModel: 'gpt-5.5' });
  const current = f.batches.create([{ recipeId: recipe.id }], { ...f.defaults, textModel: 'gpt-5.5' });
  f.approve(current); await f.drainBatch();
  const result = f.batches.detail(current.id);
  assert.equal(result.status, 'completed');
  assert.equal(f.providerCalls.length, 1);
  assert.equal(f.providerCalls[0].payload.model, 'gpt-5.5');
  assert.equal(f.providerCalls[0].payload.reasoning.effort, 'none');
  assert.equal(f.providerCalls[0].payload.text.format.type, 'json_schema');
  assert.equal(result.budget.actual, .02);
  assert.equal(result.budget.held, 0);
  assert.equal(f.batches.detail(old.id).settings.textModel, 'gpt-5.4-mini');
  assert.equal(f.batches.detail(old.id).status, 'awaiting_cost_approval');
});

test('GPT-5.5 free access check verifies its own pricing, not image-model prices', async t => {
  apiKey(t); const f = await contentFixture(t); const requests = [];
  const mock = async (url, init = {}) => {
    requests.push({ url, method: init.method || 'GET' });
    return new Response(url.includes('api.openai.com') ? '{"id":"gpt-5.5"}' : '<main>gpt-5.5 Input $5.00 Cached input $0.50 Output $30.00</main>');
  };
  const result = await checkModels(f.store, { ...settings55, images: false }, mock);
  assert.equal(result.checks[0].account, 'listed');
  assert.equal(result.checks[0].pricingMatches, true);
  assert.equal(result.checks[0].documented, true);
  assert.equal(requests.every(request => request.method === 'GET'), true);
  assert.ok(requests.every(request => request.url.endsWith('/gpt-5.5')));
  const changed = await checkModels(f.store, { ...settings55, images: false }, async url => new Response(url.includes('api.openai.com') ? '{}' : '<main>gpt-5.5 $5.00 $0.50 $35.00</main>'));
  assert.equal(changed.checks[0].pricingMatches, false);
});

test('reference edits send actual photo bytes to images/edits with one output and requested settings', async t => {
  apiKey(t); const f = await contentFixture(t); const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const dataUrl = `data:image/png;base64,${f.image.toString('base64')}`;
  const payload = referenceImagePayload({ title: 'Carrot soup', role: 'finished', visibleFood: 'Smooth orange carrot soup.', changes: 'Change the bowl to pale sage ceramic and slightly lower the camera.' }, settings55, dataUrl);
  let calls = 0; let acknowledged;
  global.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.ok(init.body instanceof FormData);
    assert.equal(init.headers['Content-Type'], undefined);
    assert.equal(init.body.get('model'), 'gpt-image-2.6-sunburst');
    assert.equal(init.body.get('size'), '1536x864');
    assert.equal(init.body.get('n'), '1');
    assert.equal(init.body.get('quality'), 'medium');
    assert.equal(init.body.get('complexity'), null);
    assert.equal(init.body.get('partial_images'), null);
    assert.equal(init.body.get('references'), null);
    const files = init.body.getAll('image[]'); assert.equal(files.length, 1);
    assert.deepEqual(Buffer.from(await files[0].arrayBuffer()), f.image);
    return Response.json({ data: [{ b64_json: f.image.toString('base64') }], usage: { input_tokens: 1100, input_tokens_details: { text_tokens: 100, image_tokens: 1000 }, output_tokens: 1000 } }, { headers: { 'x-request-id': 'edit-request' } });
  };
  const result = await new OpenAIContentProvider().request('image', payload, undefined, id => { acknowledged = id; });
  assert.equal(calls, 1); assert.equal(acknowledged, 'edit-request');
  assert.equal(actualCost('image', payload.model, result.body), .0385);
  assert.match(payload.prompt, /Preserve its photographic food detail/);
});

test('reference edits reject missing or unsafe reference inputs and never silently become generations', async t => {
  apiKey(t); const originalFetch = global.fetch; let calls = 0;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { calls++; throw new Error('Should not dispatch'); };
  const provider = new OpenAIContentProvider();
  for (const references of [[], ['https://example.com/image.jpg'], ['data:image/png;base64,='], Array(6).fill('data:image/png;base64,YQ==')]) {
    await assert.rejects(provider.request('image', { model: settings55.imageModel, references }), error => error.definitelyRejected === true);
  }
  assert.equal(calls, 0);
});

test('ingredient reference prompt binds paper labels to the verified inventory; estimate includes image input', () => {
  const photo = { title: 'Carrot soup', role: 'ingredients', visibleFood: 'Carrots, water and salt in separate containers.', changes: 'Rearrange the containers.', ingredientLabels: ['Carrots', 'Water', 'Salt'] };
  const payload = referenceImagePayload(photo, settings55, 'data:image/png;base64,YQ==');
  assert.match(payload.prompt, /small separate off-white paper labels/);
  assert.match(payload.prompt, /\["Carrots","Water","Salt"\]/);
  assert.match(payload.prompt, /Keep exactly the visible ingredient set/);
  assert.throws(() => referenceImagePayload({ ...photo, ingredientLabels: [] }, settings55, 'data:image/png;base64,YQ=='), /verified ingredient labels/);
  const quote = referenceImageEstimate(settings55, payload.prompt, 2000);
  const plain = stageEstimate('featured', settings55, Buffer.byteLength(payload.prompt));
  assert.equal(quote.estimated, plain.estimated + .016);
  assert.equal(quote.reservation, plain.reservation + .016);
  assert.match(quote.basis, /not a measured token count/);
  assert.throws(() => referenceImageEstimate(settings55, payload.prompt, 0), /reference-image input allowance/);
});
