const test = require('node:test');
const assert = require('node:assert/strict');
const { contentFixture, recipeData, html, ReportEngine } = require('./helpers/content-fixtures.cjs');
const { extractArticle, parsePublication, dayInZone } = require('../.intelligence-build/lib/recipe-intelligence/article.js');
const htmlSections = (extra = '') => `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Article', datePublished: '2026-11-07T00:05:03Z', mainEntityOfPage: 'https://food.example/soup' })}</script>${extra}</head><body><article><h1>Carrot soup</h1><div class="prose"><p>Prep time: 10 minutes · Cook time: 20 minutes · Total: about 30 minutes · Makes: 4 servings</p><h2>What You’ll Need</h2><p>For the soup:</p><ul><li>500 g carrots</li><li>750 ml water</li></ul><p>For the seasoning:</p><ul><li>½ teaspoon salt</li></ul><h2>Steps</h2><ol><li>Simmer the carrots in water for 20 minutes.</li><li>Blend, then stir in ½ teaspoon salt.</li></ol><h2>Other ideas</h2><ul><li>Do not merge this optional garnish.</li></ul></div><aside><h2>Ingredients</h2><ul><li>Unrelated sidebar recipe</li></ul></aside></article></body></html>`;

test('structured cooking steps retain actions split between name and text without duplicating complete instructions', () => {
  const data = recipeData({ recipeInstructions: [
    { '@type': 'HowToStep', name: 'Preheat', text: 'the oven to 350°F.' },
    { '@type': 'HowToStep', name: 'Bake', text: 'for 45 to 55 minutes.' },
    { '@type': 'HowToStep', name: 'Mix', text: 'Mix the carrots with 1 tsp salt.' },
    { '@type': 'HowToStep', name: 'Step 4', text: 'Rest for 5 minutes.' },
    { '@type': 'HowToStep', name: 'Chill for 2 hours', text: 'Cover the dish before refrigerating.' },
  ] });
  const result = extractArticle(html(data), 'https://food.example/soup');
  assert.deepEqual(result.recipe.instructions, ['Preheat the oven to 350°F.', 'Bake for 45 to 55 minutes.', 'Mix the carrots with 1 tsp salt.', 'Rest for 5 minutes.', 'Chill for 2 hours: Cover the dish before refrigerating.']);
});

test('duplicate serving-count representations collapse without discarding distinct yield information', () => {
  const first = extractArticle(html(recipeData({ recipeYield: ['8', '8 servings', '8 servings'] })), 'https://food.example/soup');
  assert.equal(first.recipe.yield, '8 servings');
  const distinct = extractArticle(html(recipeData({ recipeYield: ['8 servings', '2 casseroles'] })), 'https://food.example/soup');
  assert.equal(distinct.recipe.yield, '8 servings; 2 casseroles');
});

test('labelled HTML recipe sections preserve groups, quantities and methods with Article publication evidence', () => {
  const result = extractArticle(htmlSections(), 'https://food.example/soup');
  assert.equal(result.status, 'verified'); assert.equal(result.publication.utc, '2026-11-07T00:05:03.000Z');
  assert.equal(result.recipe.extractionMethod, 'html_sections');
  assert.deepEqual(result.recipe.ingredients, ['For the soup: 500 g carrots', 'For the soup: 750 ml water', 'For the seasoning: ½ teaspoon salt']);
  assert.deepEqual(result.recipe.instructions, ['Simmer the carrots in water for 20 minutes.', 'Blend, then stir in ½ teaspoon salt.']);
  assert.equal(result.recipe.prepTime, 'PT10M'); assert.equal(result.recipe.cookTime, 'PT20M'); assert.equal(result.recipe.totalTime, ''); assert.equal(result.recipe.yield, '4 servings');
  assert.match(result.recipe.sourceNotes.join(' '), /about 30 minutes/);
});
test('HTML fallback recognizes explicit conversational ingredient and method headings', () => {
  for (const ingredients of ['What you’ll need', 'What you will need', 'What you need']) {
    for (const method of ['How I make it', 'How to make them', 'How to make this recipe']) {
      const page = htmlSections().replace('What You’ll Need', ingredients).replace('<h2>Steps</h2>', `<h2>${method}</h2>`);
      const result = extractArticle(page, 'https://food.example/soup');
      assert.equal(result.status, 'verified');
      assert.equal(result.recipe.ingredients.length, 3); assert.equal(result.recipe.instructions.length, 2);
      assert.equal(result.recipe.prepTime, 'PT10M'); assert.equal(result.recipe.yield, '4 servings');
    }
  }
  for (const misleading of ['How I make it for another recipe', 'How to make it look good', 'What you will need to buy later']) {
    const page = htmlSections().replace(misleading.startsWith('What') ? 'What You’ll Need' : 'Steps', misleading);
    assert.equal(extractArticle(page, 'https://food.example/soup').recipe, null);
  }
});
test('HTML fallback excludes ambiguous collections, incomplete methods, nested lists and feed-only dates', () => {
  const page = htmlSections();
  assert.equal(extractArticle(page.replace('<h2>Other ideas</h2>', '<h2>Ingredients</h2>'), 'https://food.example/soup').status, 'uncertain');
  assert.equal(extractArticle(page.replace('<h2>Steps</h2>', '<h2>Shopping advice</h2>'), 'https://food.example/soup').recipe, null);
  assert.equal(extractArticle(page.replace('500 g carrots', '500 g carrots<ul><li>another recipe</li></ul>'), 'https://food.example/soup').recipe, null);
  assert.equal(extractArticle(page.replace('500 g carrots', 'x'.repeat(2001)), 'https://food.example/soup').recipe, null);
  const noDate = page.replace(/<script[^>]*>.*?<\/script>/, '');
  assert.equal(extractArticle(noDate, 'https://food.example/soup', ['Sat, 07 Nov 2026 00:05:03 +0000']).status, 'uncertain');
});
test('HTML fallback preserves publication conflicts and omits conflicting optional duration labels', () => {
  const conflictingDate = extractArticle(htmlSections('<meta property="article:published_time" content="2020-01-02">'), 'https://food.example/soup');
  assert.equal(conflictingDate.status, 'uncertain'); assert.equal(conflictingDate.publication, null);
  const conflictingTime = extractArticle(htmlSections().replace('Prep time: 10 minutes', 'Cook time: 40 minutes · Prep time: 10 minutes'), 'https://food.example/soup');
  assert.equal(conflictingTime.recipe.cookTime, ''); assert.match(conflictingTime.recipe.sourceNotes.join(' '), /Conflicting cookTime/);
  const mixedTotal = extractArticle(htmlSections().replace('Total: about 30 minutes', 'Total: 25 minutes · Total: about 30 minutes'), 'https://food.example/soup');
  assert.equal(mixedTotal.recipe.totalTime, '');
  const structured = `<script type="application/ld+json">${JSON.stringify(recipeData({ datePublished: '2026-11-07T00:05:03Z' }))}</script>`;
  const preferred = extractArticle(htmlSections(structured), 'https://food.example/soup');
  assert.deepEqual(preferred.recipe.ingredients, recipeData().recipeIngredient); assert.equal(preferred.recipe.extractionMethod, undefined);
});
test('historical reports admit clearly labelled HTML recipes without any paid calls', async t => {
  const f = await contentFixture(t); const recipe = f.seed();
  f.store.db.prepare("UPDATE recipe_records SET verification_status='unverified',publication_json=NULL WHERE id=?").run(recipe.id);
  f.responses.set(recipe.url, htmlSections());
  const id = f.reports.create({ siteIds: [recipe.site.id], from: '2026-11-01', to: '2026-11-09', timezone: 'Africa/Casablanca' });
  await new ReportEngine(f.reports, f.fetcher, f.owner).process(f.reports.claim(f.owner));
  const report = f.reports.detail(id); assert.equal(report.matches, 1); assert.equal(report.rows[0].recipe.ingredients.length, 3);
  assert.equal(report.rows[0].publication.date, '2026-11-07'); assert.equal(f.providerCalls.length, 0);
});

test('original Recipe publication wins over updated dates and a reissued feed', () => {
  const result = extractArticle(html(), 'https://food.example/soup', ['Tue, 10 Nov 2026 12:00:00 +0000']);
  assert.equal(result.status, 'verified'); assert.equal(result.publication.utc, '2020-01-02T12:00:00.000Z');
  assert.ok(result.dates.some(d => d.kind === 'modified')); assert.ok(result.dates.some(d => d.kind === 'feed'));
  const changed = extractArticle(html(recipeData({ datePublished: '2026-11-10' })), 'https://food.example/soup', [], result.publication);
  assert.equal(changed.publication.utc, result.publication.utc); assert.match(changed.reason, /Retained/);
});
test('missing, invalid, timezone-free and conflicting original dates stay out of verified totals', () => {
  for (const value of [undefined, '2026-02-30', '2020-01-02T12:00:00', 'not a date']) {
    const result = extractArticle(html(recipeData({ datePublished: value })), 'https://food.example/soup', ['Thu, 02 Jan 2020 12:00:00 +0000']);
    assert.equal(result.status, 'uncertain'); assert.equal(result.publication, null);
  }
  const result = extractArticle(html(recipeData(), '<meta property="article:published_time" content="2026-11-10T12:00:00Z">'), 'https://food.example/soup');
  assert.equal(result.status, 'uncertain'); assert.match(result.reason, /conflicts/);
  const earlierFeed = extractArticle(html(recipeData({ datePublished: '2026-11-10' })), 'https://food.example/soup', ['Thu, 02 Jan 2020 12:00:00 +0000']);
  assert.equal(earlierFeed.status, 'uncertain'); assert.match(earlierFeed.reason, /Earlier feed/);
});
test('Casablanca reporting uses actual timezone boundaries and preserves date-only precision', () => {
  // Historical winter/Ramadan dates keep this independent of future timezone rule updates.
  assert.equal(dayInZone(parsePublication('2020-01-01T23:30:00Z'), 'Africa/Casablanca'), '2020-01-02');
  assert.equal(dayInZone(parsePublication('2020-05-01T23:30:00Z'), 'Africa/Casablanca'), '2020-05-01');
  const day = parsePublication('2020-01-02'); assert.equal(day.precision, 'date'); assert.equal(day.utc, undefined);
  assert.equal(dayInZone(day, 'America/Los_Angeles'), '2020-01-02');
});
test('article association excludes unrelated Recipe widgets and ambiguous recipe collections', () => {
  const other = recipeData({ url: 'https://food.example/another' });
  assert.equal(extractArticle(html(other), 'https://food.example/soup').status, 'not_recipe');
  assert.equal(extractArticle(html({ '@graph': [recipeData(), recipeData({ name: 'Other soup' })] }), 'https://food.example/soup').status, 'uncertain');
});
test('baseline matches appear immediately from SQLite without appearing as published today', async t => {
  const f = await contentFixture(t); const r = f.seed();
  const historical = f.reports.create({ siteIds: [r.site.id], from: '2020-01-01', to: '2020-01-03', timezone: 'Africa/Casablanca' });
  assert.equal(f.reports.detail(historical).rows.length, 1);
  const recent = f.reports.create({ siteIds: [r.site.id], from: '2026-11-10', to: '2026-11-10', timezone: 'Africa/Casablanca' });
  assert.equal(f.reports.detail(recent).rows.length, 0); assert.equal(f.providerCalls.length, 0);
  const stored = f.store.db.prepare('SELECT * FROM recipe_records WHERE id=?').get(r.id); assert.equal(stored.origin, 'baseline_existing');
});
test('progressive report commits each match, pauses and resumes, and retains source failures', async t => {
  const f = await contentFixture(t); const r = f.seed(); const another = f.seed('second'); const failed = f.seed('failed');
  f.store.db.prepare("UPDATE recipe_records SET verification_status='unverified',publication_json=NULL").run();
  f.responses.set(failed.url, new Error('Restricted source'));
  const id = f.reports.create({ siteIds: [r.site.id], from: '2020-01-01', to: '2020-01-03', timezone: 'Africa/Casablanca' });
  for (const [priority, record] of [r, another, failed].entries()) f.store.db.prepare('UPDATE report_jobs SET priority=? WHERE report_id=? AND recipe_id=?').run(priority, id, record.id);
  const engine = new ReportEngine(f.reports, f.fetcher, f.owner);
  let job = f.reports.claim(f.owner); await engine.process(job); assert.equal(f.reports.detail(id).rows.length, 1);
  assert.ok(f.reports.detail(id).stats.remaining > 0); f.reports.action(id, 'pause'); assert.equal(f.reports.claim(f.owner), null);
  f.reports.action(id, 'resume'); job = f.reports.claim(f.owner); assert.equal(job.recipe_id, another.id);
  await engine.process(job); await engine.process(f.reports.claim(f.owner));
  f.store.db.prepare("UPDATE scan_runs SET status='completed'").run(); f.reports.refresh();
  const result = f.reports.detail(id); assert.equal(result.rows.length, 2); assert.equal(result.stats.errors, 1);
  assert.equal(result.processing, 'Available sources processed'); assert.match(result.coverage.join(' '), /Incomplete coverage/);
  assert.equal(f.providerCalls.length, 0);
});
test('advertised WordPress filters run ahead of archive pages but article evidence controls membership', async t => {
  const f = await contentFixture(t); const r = f.seed();
  f.store.db.prepare("UPDATE recipe_records SET verification_status='unverified',publication_json=NULL").run();
  f.store.ensureSource(r.site.id, 'https://food.example/wp-json/', 'wordpress_api');
  const id = f.reports.create({ siteIds: [r.site.id], from: '2026-11-01', to: '2026-11-10', timezone: 'Africa/Casablanca' });
  const first = f.reports.claim(f.owner); assert.equal(first.kind, 'wordpress');
  assert.equal(new URL(first.url).searchParams.get('after'), '2026-10-31T00:00:00');
  f.responses.set(first.url, JSON.stringify([{ link: r.url, title: { rendered: 'Soup' }, date: '2026-11-10T12:00:00' }]));
  const engine = new ReportEngine(f.reports, f.fetcher, f.owner); await engine.process(first);
  const next = f.reports.claim(f.owner); assert.equal(next.priority, 1); await engine.process(next);
  assert.equal(f.reports.detail(id).rows.length, 0);
});
test('verified canonical aliases collapse report membership and future feed observations', async t => {
  const f = await contentFixture(t); const original = f.seed(); const alias = f.seed('alias');
  const report = f.reports.create({ siteIds: [original.site.id], from: '2020-01-01', to: '2020-01-03', timezone: 'UTC' });
  const ev = extractArticle(html(recipeData(), `<link rel="canonical" href="${original.url}">`), alias.url);
  f.reports.record({ recipe_id: alias.id, site_id: original.site.id, url: alias.url }, ev);
  assert.equal(f.reports.detail(report).rows.length, 1);
  const run = f.store.createScan(original.site.id);
  f.store.recordCandidates({ site_id: original.site.id, run_id: run, url: original.site.url + 'feed/' }, [{ url: alias.url }]);
  assert.equal(f.store.db.prepare('SELECT recipe_id FROM recipe_url_aliases WHERE url=?').get(alias.url).recipe_id, original.id);
});
test('interrupted article inspection resumes with saved queue and no paid provider access', async t => {
  const f = await contentFixture(t); const r = f.seed(); f.store.db.prepare("UPDATE recipe_records SET verification_status='unverified'").run();
  const id = f.reports.create({ siteIds: [r.site.id], from: '2020-01-01', to: '2020-01-03', timezone: 'UTC' });
  const first = f.reports.claim(f.owner); f.reports.recover(); const resumed = f.reports.claim(f.owner); assert.equal(first.id, resumed.id);
  await new ReportEngine(f.reports, f.fetcher, f.owner).process(resumed); assert.equal(f.reports.detail(id).rows.length, 1);
  assert.equal(f.providerCalls.length, 0);
});

test('paginated WordPress pages can contain known URLs, while actual pagination loops are stopped', async t => {
  const f = await contentFixture(t); const site = f.store.addSite('', 'https://food.example/'); const run = f.store.createScan(site.id);
  const urls = Array.from({ length: 200 }, (_, i) => `https://food.example/recipe-${i}`);
  f.store.recordCandidates({ site_id: site.id, run_id: run, url: site.url + 'feed/' }, urls.map(url => ({ url })));
  f.store.ensureSource(site.id, site.url + 'wp-json/', 'wordpress_api');
  const id = f.reports.create({ siteIds: [site.id], from: '2020-01-01', to: '2020-01-03', timezone: 'UTC' });
  // Bulk fixture writes can exceed the lease on a busy HDD; mirror the worker heartbeat before claiming work.
  assert.equal(f.store.heartbeat(f.owner), true);
  const engine = new ReportEngine(f.reports, f.fetcher, f.owner); const first = f.reports.claim(f.owner);
  const posts = urls.slice(0, 100).map(link => ({ link })); f.responses.set(first.url, JSON.stringify(posts)); await engine.process(first);
  const second = f.store.db.prepare("SELECT * FROM report_jobs WHERE report_id=? AND kind='wordpress' AND id!=?").get(id, first.id); assert.ok(second);
  f.store.db.prepare('UPDATE report_jobs SET priority=-1 WHERE id=?').run(second.id); f.responses.set(second.url, JSON.stringify(posts));
  assert.equal(f.store.heartbeat(f.owner), true);
  await engine.process(f.reports.claim(f.owner)); assert.match(f.reports.detail(id).errors[0].error, /repeated a previous page/);
});

test('report pages are bounded while the download includes every verified member', async t => {
  const f = await contentFixture(t); const seed = f.seed(); const raw = f.store.db.prepare('SELECT * FROM recipe_records WHERE id=?').get(seed.id);
  const insert = f.store.db.prepare("INSERT INTO recipe_records(site_id,canonical_url,title,first_seen_at,last_seen_at,origin,verification_status,publication_json,recipe_json) VALUES(?,?,?,?,?,'baseline_existing','verified',?,?)");
  f.store.db.transaction(() => { for (let i = 0; i < 150; i++) insert.run(seed.site.id, `https://food.example/many-${i}`, 'Soup', raw.first_seen_at, raw.last_seen_at, raw.publication_json, raw.recipe_json); }).immediate();
  const id = f.reports.create({ siteIds: [seed.site.id], from: '2020-01-01', to: '2020-01-03', timezone: 'UTC' });
  assert.equal(f.reports.detail(id).rows.length, 100); assert.equal(f.reports.detail(id).matches, 151); assert.equal(f.reports.detail(id, 1).rows.length, 51); assert.equal(f.reports.detail(id, null).rows.length, 151); assert.equal(f.reports.list()[0].matches, 151);
});
