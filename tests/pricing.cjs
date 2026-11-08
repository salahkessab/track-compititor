const { test } = require('node:test');
const assert = require('node:assert/strict');
const { estimateTextCost } = require('../.test-build/config.js');
const { estimateOpenAIImageOutput, openAIOutputExamples, openAIImageCostFromUsage, previewUnitCost } = require('../.test-build/imagePricing.js');
const { withCostLedger, recordTextUsage, recordSearchUsage, recordOpenAIImage, costSummary } = require('../.test-build/costLedger.js');
const { DEFAULT_IMAGE_SETTINGS } = require('../.test-build/openaiImageSettings.js');

test('output estimates match the official calculator for selected size and quality', () => {
  const m = 'gpt-image-2.5-sunburst';
  for (const [quality, expected] of Object.entries({low:.00474, medium:.01029, high:.04116, xhigh:.07377, max:.16464})) {
    assert.ok(Math.abs(estimateOpenAIImageOutput(m, '1024x1536', quality) - expected) < 1e-10);
  }
  assert.equal(estimateOpenAIImageOutput(m, '1024x1024', 'medium'), .01317);
  assert.equal(estimateOpenAIImageOutput('gpt-image-2-2026-04-21', '1536x1024', 'high'), .16464);
  assert.equal(estimateOpenAIImageOutput('gpt-image-1.5', '1024x1536', 'high'), .19968);
  assert.equal(estimateOpenAIImageOutput(m, 'auto', 'high'), null);
  assert.equal(estimateOpenAIImageOutput(m, '1024x1536', 'auto'), null);
  assert.equal(estimateOpenAIImageOutput('unknown', '1024x1536', 'high'), null);
  assert.deepEqual(openAIOutputExamples(m, DEFAULT_IMAGE_SETTINGS), {low:.00474, high:.16464});
  assert.equal(previewUnitCost(m), .003);
});

test('text pricing applies current rates, cached inputs and long-context rates', () => {
  assert.equal(estimateTextCost('gpt-5.4-mini', {in: 1000, out: 100, cached: 400}), .00093);
  assert.equal(estimateTextCost('gpt-4.1-mini', {in: 1000, out: 100, cached: 400}), .00044);
  assert.ok(Math.abs(estimateTextCost('gpt-5.4', {in: 300000, out: 100, cached: 100000}) - 1.05225) < 1e-10);
});

test('reported image usage includes text inputs, reference inputs, and output', () => {
  const usage = {input_tokens:100, output_tokens:1372, input_tokens_details:{text_tokens:60, image_tokens:40}};
  assert.equal(openAIImageCostFromUsage('gpt-image-2.5-sunburst', usage), .04178);
  assert.equal(openAIImageCostFromUsage('gpt-image-2.6-sunburst', usage), .04178);
  assert.equal(estimateOpenAIImageOutput('gpt-image-2.6-sunburst', '1024x1536', 'high'), null);
  assert.equal(openAIImageCostFromUsage('gpt-image-1.5', usage), .044524);
  assert.equal(openAIImageCostFromUsage('gpt-image-2', {...usage, input_tokens_details: undefined}), null);
  assert.equal(openAIImageCostFromUsage('gpt-image-2', {...usage, input_tokens:101}), null);
});

test('missing usage and preview ambiguity are marked partial rather than free', () => {
  withCostLedger(() => {
    recordTextUsage('gpt-5.4-mini', {prompt_tokens:100, completion_tokens:20});
    recordOpenAIImage('gpt-image-2.5-sunburst', {...DEFAULT_IMAGE_SETTINGS, quality:'high'}, {dataUrl:'image', partialImages:0});
    const result = costSummary('gpt-image-2.5-sunburst');
    assert.equal(result.imageCost, .04116);
    assert.equal(result.imageCostIncluded, false);
    assert.equal(result.costIncomplete, true);
  });
  withCostLedger(() => {
    recordOpenAIImage('gpt-image-2.5-sunburst', DEFAULT_IMAGE_SETTINGS, {dataUrl:'image', partialImages:1,
      usage:{input_tokens:10, output_tokens:100, input_tokens_details:{text_tokens:10, image_tokens:0}}});
    assert.equal(costSummary('gpt-image-2.5-sunburst').costIncomplete, true);
  });
});

test('concurrent requests keep their costs isolated and count only search actions', async () => {
  const jobs = [1, 2].map((n) => withCostLedger(async () => {
    recordTextUsage('gpt-5.4-mini', {prompt_tokens:100*n, completion_tokens:20*n});
    await new Promise((resolve) => setTimeout(resolve, 5));
    recordSearchUsage('gpt-5.4-mini', [{type:'web_search_call', action:{type:'search'}}, {type:'web_search_call', action:{type:'open_page'}}]);
    return costSummary();
  }));
  const [a, b] = await Promise.all(jobs);
  assert.ok(Math.abs(b.textCost - a.textCost * 2) < 1e-10);
  assert.equal(a.searchCost, .01);
  assert.equal(b.searchCost, .01);
});
