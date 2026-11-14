const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('cheerio');
const { html, article } = require('./helpers/content-fixtures.cjs');
const { extractArticle } = require('../.intelligence-build/lib/recipe-intelligence/article.js');
const { articleDocument, leanLayout } = require('../.intelligence-build/lib/recipe-intelligence/article-document.js');
const { validateArticle } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { articlePrompt, LEAN_LAYOUT_ADDENDUM } = require('../.intelligence-build/lib/recipe-intelligence/prompts.js');
const format = 'master_recipe_v1';
const source = () => extractArticle(html(), 'https://food.example/soup').recipe;
const general = (text) => ({ text, evidenceIds: [], basis: 'culinary_knowledge' });
const draft = () => ({ ...article(), articleTitle: 'Carrot soup', editorialNotes: [], blog: {
  whyMake: [general('Should not appear in the lean layout.')], ingredientNotes: [{ ingredientIndex: 0, ...general('Should not appear either.') }],
  timeNote: [], variations: [], serving: [general('Serve in bowls.')], storage: [general('Keep leftovers covered in the refrigerator.')],
  proTips: [general('Blend until the texture is even.'), general('Taste before adding more salt.')], faqs: [], conclusion: '' } });

function withLean(value, run) {
  const saved = process.env.EXPERIMENT_LEAN_ARTICLE;
  try { if (value === undefined) delete process.env.EXPERIMENT_LEAN_ARTICLE; else process.env.EXPERIMENT_LEAN_ARTICLE = value; return run(); }
  finally { if (saved === undefined) delete process.env.EXPERIMENT_LEAN_ARTICLE; else process.env.EXPERIMENT_LEAN_ARTICLE = saved; }
}

test('lean layout is off unless the experiment switch is set', () => {
  assert.equal(withLean(undefined, leanLayout), false);
  assert.equal(withLean('1', leanLayout), true);
  assert.equal(withLean('0', leanLayout), false);
});

test('lean layout renders introduction, ingredients, instructions, then tips, with the complete recipe unchanged', () => {
  const recipe = source();
  const checked = validateArticle(draft(), recipe, format);
  const rendered = withLean('1', () => articleDocument(checked.article, recipe));
  const $ = load(rendered.html);
  assert.deepEqual($('h2').map((_, el) => $(el).text()).get(), ['Ingredients', 'Instructions', 'Tips for the Best Results', 'Storage']);
  assert.doesNotMatch(rendered.html, /Ingredients and Why They Work|What Makes This Recipe Special|Should not appear/);
  const ingredients = $('h2').filter((_, el) => $(el).text() === 'Ingredients').nextAll('ul').first();
  assert.deepEqual(ingredients.find('li').map((_, el) => $(el).text()).get(), recipe.ingredients);
  const steps = $('h2').filter((_, el) => $(el).text() === 'Instructions').nextAll('ol').first();
  assert.equal(steps.find('li').length, checked.article.instructions.length);
  assert.equal($('[data-ri-recipe-card]').length, 1);
  assert.equal($('[data-ri-recipe-card] h2').length, 2, 'the card holds ingredients and instructions; tips follow it');
  const order = (selector) => rendered.html.indexOf(selector);
  assert.ok(order('<h1>') < order('data-ri-recipe-card') && order('data-ri-recipe-card') < order('Tips for the Best Results'));
  assert.match(rendered.text, /Prep time: 10 minutes/);
});

test('default layout is unchanged when the switch is off', () => {
  const recipe = source();
  const checked = validateArticle(draft(), recipe, format);
  const rendered = withLean(undefined, () => articleDocument(checked.article, recipe));
  assert.match(rendered.html, /Ingredients and Why They Work/);
  assert.match(rendered.html, /Complete Recipe Card/);
});

test('the prompt gains the lean layout rules only when the switch is on, and facts rules stay', () => {
  const recipe = source();
  const off = withLean(undefined, () => articlePrompt(recipe, undefined, format));
  const on = withLean('1', () => articlePrompt(recipe, undefined, format));
  assert.ok(!off.includes('LEAN LAYOUT'));
  assert.ok(on.includes(LEAN_LAYOUT_ADDENDUM));
  assert.match(on, /every fact rule still applies/);
  assert.match(on, /Leave these empty: whyMake, ingredientNotes, timeNote, variations, serving and faqs/);
  assert.match(on, /UNTRUSTED REFERENCE DATA/);
});
