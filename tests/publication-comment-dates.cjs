const test = require('node:test');
const assert = require('node:assert/strict');
const { extractArticle } = require('../.intelligence-build/lib/recipe-intelligence/article.js');
const url = 'https://example.com/mac-and-cheese';
const recipe = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Mac and Cheese', datePublished: '2026-11-11', recipeIngredient: ['pasta'], recipeInstructions: ['Cook pasta.'] })}</script>`;

test('comment and review dates do not conflict with the recipe publication', () => {
  const result = extractArticle(recipe + `<article itemscope itemtype="https://schema.org/Article">
    <meta itemprop="datePublished" content="2026-11-11T12:00:00Z">
    <div itemscope itemtype="https://schema.org/Comment"><meta itemprop="datePublished" content="2026-11-12T13:23:25-06:00"></div>
    <div itemscope itemtype="http://schema.org/Review"><time itemprop="datePublished" datetime="2026-11-13"></time></div>
  </article>`, url);
  assert.equal(result.status, 'verified');
  assert.equal(result.publication.date, '2026-11-11');
  assert.equal(result.dates.length, 2);
});

test('genuinely conflicting article publication dates remain uncertain', () => {
  const result = extractArticle(recipe + '<article itemscope itemtype="https://schema.org/Article"><meta itemprop="datePublished" content="2026-11-12"></article>', url);
  assert.equal(result.status, 'uncertain');
});
