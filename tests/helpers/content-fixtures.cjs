const { fixture } = require('./recipe-fixtures.cjs');
const { ReportStore, ReportEngine } = require('../../.intelligence-build/lib/recipe-intelligence/reports.js');
const { BatchStore, BatchEngine } = require('../../.intelligence-build/lib/recipe-intelligence/batches.js');
const { extractArticle } = require('../../.intelligence-build/lib/recipe-intelligence/article.js');
const { DEFAULT_CONTENT_SETTINGS } = require('../../.intelligence-build/lib/recipe-intelligence/settings.js');
const sharp = require('sharp');

const recipeData = (extra = {}) => ({ '@type': 'Recipe', name: 'Carrot soup', datePublished: '2020-01-02T12:00:00Z', dateModified: '2026-11-10T12:00:00Z', recipeIngredient: ['500 g carrots', '750 ml water', '1 tsp salt'], recipeInstructions: [{ '@type': 'HowToStep', text: 'Simmer 500 g carrots in 750 ml water for 20 minutes.' }, { '@type': 'HowToStep', text: 'Blend the carrots with the cooking water and 1 tsp salt.' }], recipeYield: '4 servings', cookTime: 'PT20M', prepTime: 'PT10M', totalTime: 'PT30M', ...extra });
const html = (recipe = recipeData(), extra = '') => `<html><head>${extra}<script type="application/ld+json">${JSON.stringify(recipe)}</script></head><body><h1>${recipe.name || 'Recipe'}</h1></body></html>`;
const article = (recipe = recipeData()) => ({ seoTitle: recipe.name, metaDescription: 'A smooth carrot soup prepared with carrots, water and salt.', slug: 'carrot-soup', introduction: 'Carrots give this smooth soup its colour. Blend the cooked carrots with their cooking water to finish it.', instructions: recipe.recipeInstructions.map(s => s.text), tips: [], storage: [] });
const textResponse = (data) => ({ body: { id: 'response-test', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 500 } }, requestId: 'req-test' });
async function contentFixture(t, options = {}) {
  const base = await fixture(t); const reports = new ReportStore(base.store); const batches = new BatchStore(base.store);
  const calls = []; const image = await sharp({ create: { width: 128, height: 192, channels: 3, background: '#d7782c' } }).png().toBuffer();
  const provider = { async request(operation, payload, signal) {
    calls.push({ operation, payload });
    if (options.provider) return options.provider(operation, payload, signal, calls.length);
    return operation === 'image' ? { body: { data: [{ b64_json: image.toString('base64') }], usage: { input_tokens: 100, output_tokens: 1372, input_tokens_details: { text_tokens: 100, image_tokens: 0 } } }, requestId: `image-${calls.length}` } : textResponse(article());
  } };
  const engine = new BatchEngine(batches, base.fetcher, provider, base.owner);
  const seed = (suffix = 'soup', data = recipeData()) => {
    const site = base.store.addSite('Recipes', 'https://food.example/'); const run = base.store.createScan(site.id);
    const url = `${site.url}${suffix}`; const source = `${site.url}feed/`;
    base.store.recordCandidates({ site_id: site.id, run_id: run, url: source }, [{ url }]);
    const record = base.store.db.prepare('SELECT * FROM recipe_records WHERE canonical_url=?').get(url);
    reports.record({ recipe_id: record.id, site_id: site.id, url }, extractArticle(html(data), url));
    base.responses.set(url, html(data)); return { ...record, site, url };
  };
  const approve = (batch, limit = 10) => {
    for (const model of [batch.settings.textModel, batch.settings.imageModel]) base.store.db.prepare('INSERT OR REPLACE INTO model_checks(model,checked_at,metadata_json) VALUES(?,?,?)').run(model, new Date().toISOString(), JSON.stringify({ documented: true, pricingMatches: true, account: 'listed' }));
    batches.approve(batch.id, limit, batch.quote.createdAt);
  };
  const drain = async (max = 100) => { let stage, n = 0; while ((stage = batches.claim(base.owner))) { if (++n > max) throw new Error('Batch did not converge.'); await engine.process(stage); } batches.refresh(); };
  return { ...base, reports, batches, providerCalls: calls, provider, batchEngine: engine, seed, approve, drainBatch: drain, image, defaults: { ...DEFAULT_CONTENT_SETTINGS, textModel: 'gpt-5.4-mini', imageWorkflow: 'legacy', images: false, articleFormat: 'compact_v1' } };
}
module.exports = { contentFixture, recipeData, html, article, textResponse, ReportStore, ReportEngine };
