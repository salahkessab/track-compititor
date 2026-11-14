const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalStep } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { MASTER_STYLE_ADDENDUM, articlePrompt } = require('../.intelligence-build/lib/recipe-intelligence/prompts.js');
const { quickInstructions } = require('../.test-build/photoQuickInstructions.js');
const { foodVariationPrompt } = require('../.test-build/recipeImageToImagePrompt.js');
const { twoInOnePrompt } = require('../.test-build/recipeTwoInOnePrompt.js');

test('a correct °F/°C conversion added to a step is normalised away for comparison', () => {
  assert.equal(canonicalStep('Bake at 375°F (190°C) until golden.', 'Bake at 375°F until golden.'), 'Bake at 375°F until golden.');
  assert.equal(canonicalStep('Bake at 190°C (375°F) until golden.', 'Bake at 190°C until golden.'), 'Bake at 190°C until golden.');
});

test('a wrong conversion is left untouched so the step still fails the number check', () => {
  assert.equal(canonicalStep('Bake at 375°F (250°C).', 'Bake at 375°F.'), 'Bake at 375°F (250°C).');
});

test('a conversion already present in the source is kept as is', () => {
  const step = 'Bake at 375°F (190°C).';
  assert.equal(canonicalStep(step, step), step);
});

test('spelled-out durations become numerals, but other number words are left alone', () => {
  assert.equal(canonicalStep('Cook for five minutes, then rest two hours.', 'x'), 'Cook for 5 minutes, then rest 2 hours.');
  assert.equal(canonicalStep('Add one large onion.', 'x'), 'Add one large onion.');
});

test('the master prompt carries the wording guide and still contains the recipe data', () => {
  const recipe = { title: 'Soup', ingredients: ['1 carrot'], instructions: ['Boil.'], tips: [], storage: [] };
  const prompt = articlePrompt(recipe, undefined, 'master_recipe_v1');
  assert.ok(prompt.includes(MASTER_STYLE_ADDENDUM));
  assert.ok(prompt.includes('1 carrot'));
});

test('the wording guide asks for a second-person guide voice and forbids invented experience or new facts', () => {
  assert.match(MASTER_STYLE_ADDENDUM, /speaking to the reader as "you"/);
  assert.match(MASTER_STYLE_ADDENDUM, /never claim to have tested, tasted or made the dish/);
  assert.match(MASTER_STYLE_ADDENDUM, /add no quantity, time, temperature, ingredient, substitution or doneness cue/);
});

test('article reasoning stays off by default and is only raised by the experiment switch', () => {
  const { writingPayload, articleReasoningEffort } = require('../.intelligence-build/lib/recipe-intelligence/prompts.js');
  const { DEFAULT_CONTENT_SETTINGS } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');
  const recipe = { title: 'Soup', ingredients: ['1 carrot'], instructions: ['Boil.'], tips: [], storage: [] };
  const saved = process.env.EXPERIMENT_ARTICLE_REASONING;
  try {
    delete process.env.EXPERIMENT_ARTICLE_REASONING;
    assert.equal(articleReasoningEffort(), 'none');
    assert.equal(writingPayload(recipe, DEFAULT_CONTENT_SETTINGS).reasoning.effort, 'none');
    assert.equal(writingPayload(recipe, DEFAULT_CONTENT_SETTINGS).max_output_tokens, 6500);
    process.env.EXPERIMENT_ARTICLE_REASONING = 'medium';
    assert.equal(writingPayload(recipe, DEFAULT_CONTENT_SETTINGS).reasoning.effort, 'medium');
    assert.equal(writingPayload(recipe, DEFAULT_CONTENT_SETTINGS).max_output_tokens, 14000);
    process.env.EXPERIMENT_ARTICLE_REASONING = 'bogus';
    assert.equal(articleReasoningEffort(), 'none');
  } finally { if (saved === undefined) delete process.env.EXPERIMENT_ARTICLE_REASONING; else process.env.EXPERIMENT_ARTICLE_REASONING = saved; }
});

test('without presets the default dishware and surface changes remain', () => {
  const prompt = foodVariationPrompt('a cream bowl on a wooden table');
  assert.match(prompt, /always change the plate/);
  assert.match(prompt, /always change the table/);
});

test('with any quick preset the forced dishware and surface changes are removed', () => {
  for (const preset of quickInstructions) {
    const prompt = foodVariationPrompt(preset.text);
    assert.doesNotMatch(prompt, /always change the plate/, preset.label);
    assert.doesNotMatch(prompt, /always change the table/, preset.label);
    assert.doesNotMatch(prompt, /different real photo of the same food/, preset.label);
    assert.match(prompt, /Apply ONLY the changes listed/, preset.label);
    assert.ok(prompt.includes(preset.text), preset.label);
  }
});

test('rearrangement still keeps food identity and no-text-unless-labels rules', () => {
  const rearrange = quickInstructions.find((preset) => preset.label.startsWith('Rearrange'));
  const prompt = foodVariationPrompt(rearrange.text);
  assert.match(prompt, /same ingredient proportions/);
  assert.match(prompt, /no added text unless the user explicitly requests ingredient labels/);
  assert.match(prompt, /not just their labels or background/);
});

test('two-in-one names each image role and gives user edits priority only when supplied', () => {
  assert.match(twoInOnePrompt(''), /Image 1 sets the base scene/);
  assert.doesNotMatch(twoInOnePrompt(''), /User-requested edits take priority/);
  assert.match(twoInOnePrompt('warm light'), /User-requested edits take priority/);
});
