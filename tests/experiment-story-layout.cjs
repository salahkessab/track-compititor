const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { html, article } = require('./helpers/content-fixtures.cjs');
const { extractArticle } = require('../.intelligence-build/lib/recipe-intelligence/article.js');
const { articleDocument, storyLayout } = require('../.intelligence-build/lib/recipe-intelligence/article-document.js');
const { validateArticle } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { articlePrompt, STORY_LAYOUT_ADDENDUM, storyWordTarget } = require('../.intelligence-build/lib/recipe-intelligence/prompts.js');
const format = 'master_recipe_v1';
const source = () => extractArticle(html(), 'https://food.example/soup').recipe;
const general = (text) => ({ text, evidenceIds: [], basis: 'culinary_knowledge' });
const draft = () => ({ ...article(), articleTitle: 'Carrot soup', editorialNotes: [], blog: {
  whyMake: [general('The carrots turn sweet and silky once blended.')], ingredientNotes: [{ ingredientIndex: 0, ...general('Should not appear.') }],
  timeNote: [], variations: [general('Should not appear either.')],
  serving: [general('Serve with warm crusty bread.'), general('A crisp green salad fits beside it.'), general('Top with a swirl of cream.'), general('Pour it into mugs for a casual supper.')],
  storage: [general('Keep leftovers covered in the refrigerator.')],
  proTips: [general('Blend until the texture is even.')],
  faqs: [{ question: 'Can I make it ahead?', ...general('Yes, it reheats gently on the stove.') }], conclusion: '' } });

function withEnv(vars, run) {
  const saved = {}; for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try { for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } return run(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const story = (run) => withEnv({ EXPERIMENT_STORY_ARTICLE: '1', EXPERIMENT_LEAN_ARTICLE: '1' }, run);
const off = (run) => withEnv({ EXPERIMENT_STORY_ARTICLE: undefined, EXPERIMENT_LEAN_ARTICLE: undefined }, run);

test('story layout is off unless the experiment switch is set', () => {
  assert.equal(off(storyLayout), false);
  assert.equal(story(storyLayout), true);
});

test('story layout renders intro, special, recipe, tips, serving, FAQ, storage with the recipe unchanged', () => story(() => {
  const recipe = source();
  const checked = validateArticle(draft(), recipe, format);
  const $ = load(articleDocument(checked.article, recipe).html);
  assert.deepEqual($('h2').map((_, el) => $(el).text()).get(), ['What Makes This Carrot soup Special', 'Ingredients', 'Instructions', 'Tips for the Best Results', 'What to Serve With Carrot soup', 'Frequently Asked Questions', 'Storage']);
  assert.equal($('h3').first().text(), 'Can I make it ahead?');
  assert.doesNotMatch($.html(), /Should not appear/);
  const ingredients = $('h2').filter((_, el) => $(el).text() === 'Ingredients').nextAll('ul').first();
  assert.deepEqual(ingredients.find('li').map((_, el) => $(el).text()).get(), recipe.ingredients);
  assert.equal($('[data-ri-recipe-card] h2').length, 2);
  assert.equal(checked.article.blog.serving.length, 4, 'story layout keeps more than three serving ideas');
}));

test('the story prompt asks for the occasion first, general scenes only, and a length target from the source', () => story(() => {
  const recipe = source();
  const prompt = articlePrompt(recipe, undefined, format);
  assert.ok(prompt.includes(STORY_LAYOUT_ADDENDUM));
  assert.match(prompt, /FIRST tie the recipe to its occasion/);
  assert.match(prompt, /never a claim about a real person, the author or a specific family: no "I", "my", "we" or "our"/);
  assert.match(prompt, /no invented traditions, history, origin stories, awards or statistics/);
  assert.match(prompt, /Target total length: about \d+ to \d+ rendered words/);
  assert.ok(!prompt.includes('LEAN LAYOUT'), 'story layout takes precedence over lean');
  assert.match(prompt, /UNTRUSTED REFERENCE DATA/);
}));

test('the length target follows the source article, with a default when it is short or missing', () => {
  const words = (n) => ({ sourceReading: { version: 1, text: 'word '.repeat(n), truncated: false } });
  assert.deepEqual(storyWordTarget(words(1350)), { min: 1350, max: 1550 });
  assert.deepEqual(storyWordTarget({}), { min: 1300, max: 1500 });
  assert.deepEqual(storyWordTarget(words(5000)), { min: 2000, max: 2300 });
});

test('a first-person anecdote changes only its own sentence; the rest of the introduction stays', () => story(() => {
  const recipe = source();
  const raw = { ...draft(), introduction: 'Sunday lunch calls for something warm. My grandmother made this every Sunday. I grew up eating it.\n\nThe soup turns silky once blended.' };
  const checked = validateArticle(raw, recipe, format);
  assert.equal(checked.article.introduction, 'Sunday lunch calls for something warm. Your grandmother made this every Sunday.\n\nThe soup turns silky once blended.');
  assert.ok(checked.warnings.some(w => /anecdote sentence was rewritten/.test(w)));
}));

test('anecdote clean-up leaves text without anecdotes untouched', () => {
  const { scrubAnecdotes } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
  assert.deepEqual(scrubAnecdotes('It reminds you of a grandmother\'s table.'), { text: 'It reminds you of a grandmother\'s table.', changed: false });
  assert.equal(scrubAnecdotes('My family and I love it. Serve it hot.').text, 'Serve it hot.');
});

test('default layout and prompt are unchanged when the switch is off', () => off(() => {
  const recipe = source();
  const rendered = articleDocument(validateArticle(draft(), recipe, format).article, recipe);
  assert.match(rendered.html, /Complete Recipe Card/);
  assert.ok(!articlePrompt(recipe, undefined, format).includes('STORY LAYOUT'));
}));
