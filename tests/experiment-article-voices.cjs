const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { html, article } = require('./helpers/content-fixtures.cjs');
const { extractArticle } = require('../.intelligence-build/lib/recipe-intelligence/article.js');
const { articleDocument } = require('../.intelligence-build/lib/recipe-intelligence/article-document.js');
const { validateArticle } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { articlePrompt, writingPayload, VOICE_ADDENDA, STORY_LAYOUT_ADDENDUM, LEAN_LAYOUT_ADDENDUM, voiceWordTarget } = require('../.intelligence-build/lib/recipe-intelligence/prompts.js');
const { ARTICLE_VOICES, resolveVoice } = require('../.intelligence-build/lib/recipe-intelligence/article-voices.js');
const { validateContentSettings, DEFAULT_CONTENT_SETTINGS } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');
const format = 'master_recipe_v1';
const source = () => extractArticle(html(), 'https://food.example/soup').recipe;
const general = (text) => ({ text, evidenceIds: [], basis: 'culinary_knowledge' });
const draft = () => ({ ...article(), articleTitle: 'Carrot soup', editorialNotes: [], blog: {
  whyMake: [general('The carrots turn sweet once blended.')], ingredientNotes: [], timeNote: [], variations: [],
  serving: [general('Serve with warm bread.'), general('Add a green salad.'), general('Top with cream.'), general('Pour into mugs.')],
  storage: [general('Keep leftovers covered in the refrigerator.')], proTips: [general('Blend until even.')],
  faqs: [{ question: 'Can I make it ahead?', ...general('Yes, it reheats gently.') }], conclusion: '' } });
const clean = () => { const saved = [process.env.EXPERIMENT_STORY_ARTICLE, process.env.EXPERIMENT_LEAN_ARTICLE]; delete process.env.EXPERIMENT_STORY_ARTICLE; delete process.env.EXPERIMENT_LEAN_ARTICLE; return () => { for (const [k, v] of [['EXPERIMENT_STORY_ARTICLE', saved[0]], ['EXPERIMENT_LEAN_ARTICLE', saved[1]]]) if (v === undefined) delete process.env[k]; else process.env[k] = v; }; };

test('seven writing styles are offered and an unknown style falls back to classic', () => {
  const restore = clean();
  try {
    assert.deepEqual(ARTICLE_VOICES.map(v => v.id), ['classic', 'lean', 'story', 'quick', 'holiday', 'budget', 'beginner']);
    assert.equal(resolveVoice('nope'), 'classic');
    assert.equal(resolveVoice('holiday'), 'holiday');
  } finally { restore(); }
});

test('settings keep the chosen style and reject an unknown one', () => {
  assert.equal(validateContentSettings({ articleVoice: 'budget' }).articleVoice, 'budget');
  assert.equal(validateContentSettings({}).articleVoice, 'auto', 'Auto is the default');
  assert.throws(() => validateContentSettings({ articleVoice: 'poem' }), /writing style/);
});

test('each style puts its own rules in the prompt, and the style comes from the batch settings', () => {
  const restore = clean();
  try {
    const recipe = source();
    for (const [voice, marker] of [['quick', VOICE_ADDENDA.quick], ['holiday', VOICE_ADDENDA.holiday], ['budget', VOICE_ADDENDA.budget], ['beginner', VOICE_ADDENDA.beginner], ['story', STORY_LAYOUT_ADDENDUM], ['lean', LEAN_LAYOUT_ADDENDUM]]) {
      const prompt = writingPayload(recipe, { ...DEFAULT_CONTENT_SETTINGS, articleVoice: voice }).input;
      assert.ok(prompt.includes(marker), voice);
      assert.match(prompt, /UNTRUSTED REFERENCE DATA/);
    }
    const classic = articlePrompt(recipe, undefined, format, 'classic');
    assert.ok(!/STORY LAYOUT|LEAN LAYOUT|QUICK & PRACTICAL|HOLIDAY \/ OCCASION|BUDGET \/ FAMILY|BEGINNER STYLE/.test(classic));
    for (const voice of ['quick', 'holiday', 'budget', 'beginner']) assert.match(articlePrompt(recipe, undefined, format, voice), /never new quantities, times, temperatures, servings or costs/);
    assert.match(VOICE_ADDENDA.holiday, /Never claim the dish is traditional for a holiday unless the source says so/);
    assert.match(VOICE_ADDENDA.budget, /Never state prices or costs/);
  } finally { restore(); }
});

test('quick is shorter and beginner a little longer than the story target', () => {
  const recipe = { sourceReading: { version: 1, text: 'word '.repeat(1350), truncated: false } };
  assert.deepEqual(voiceWordTarget(recipe, 'story'), { min: 1350, max: 1550 });
  assert.ok(voiceWordTarget(recipe, 'quick').max < 1000);
  assert.ok(voiceWordTarget(recipe, 'beginner').min > 1350);
});

test('each sectioned style renders its own headings with the ingredients unchanged, and the style is stored on the article', () => {
  const restore = clean();
  try {
    const recipe = source();
    const expected = { quick: 'Tips and Mistakes to Avoid', holiday: 'Make-Ahead and Hosting Tips', budget: 'Money-Saving Tips', beginner: "How to Know It's Done", story: 'Tips for the Best Results' };
    for (const [voice, tips] of Object.entries(expected)) {
      const checked = validateArticle(draft(), recipe, format, voice);
      assert.equal(checked.article.voice, voice);
      const $ = load(articleDocument(checked.article, recipe).html);
      const h2 = $('h2').map((_, el) => $(el).text()).get();
      assert.ok(h2.includes(tips), `${voice}: ${h2}`);
      assert.ok(h2.includes('Ingredients'));
      const ingredients = $('h2').filter((_, el) => $(el).text() === 'Ingredients').nextAll('ul').first();
      assert.deepEqual(ingredients.find('li').map((_, el) => $(el).text()).get(), recipe.ingredients);
      assert.equal(checked.article.blog.serving.length, 4);
    }
    const beginner = load(articleDocument(validateArticle(draft(), recipe, format, 'beginner').article, recipe).html);
    assert.ok(beginner('h2').map((_, el) => beginner(el).text()).get().includes('Step-by-Step Instructions'));
    const classic = articleDocument(validateArticle(draft(), recipe, format, 'classic').article, recipe);
    assert.match(classic.html, /Complete Recipe Card/);
  } finally { restore(); }
});

test('auto style gives each recipe its own style, the same one at every stage, and the settings accept it', () => {
  const { voiceFor, AUTO_VOICES } = require('../.intelligence-build/lib/recipe-intelligence/article-voices.js');
  assert.equal(validateContentSettings({ articleVoice: 'auto' }).articleVoice, 'auto');
  const picks = Array.from({ length: 40 }, (_, i) => voiceFor('auto', { url: `https://food.example/recipe-${i}` }));
  assert.ok(picks.every(v => AUTO_VOICES.includes(v)));
  assert.ok(new Set(picks).size >= 4, 'different recipes get different styles');
  assert.equal(voiceFor('auto', { url: 'https://food.example/a' }), voiceFor('auto', { url: 'https://food.example/a' }));
  assert.equal(voiceFor('budget', { url: 'x' }), 'budget');
  assert.equal(voiceFor(undefined, { url: 'x' }), undefined);
  const recipe = source();
  const chosen = voiceFor('auto', recipe);
  const prompt = writingPayload(recipe, { ...DEFAULT_CONTENT_SETTINGS, articleVoice: 'auto' }).input;
  assert.equal(prompt, articlePrompt(recipe, undefined, format, chosen));
});
