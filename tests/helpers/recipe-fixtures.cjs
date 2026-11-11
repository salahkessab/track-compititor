const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IntelligenceStore } = require('../../.intelligence-build/lib/recipe-intelligence/database.js');
const { DiscoveryEngine } = require('../../.intelligence-build/lib/recipe-intelligence/engine.js');
const directories = [];
// Registered outside test callbacks: cleanup follows all per-test connection shutdowns.
require('node:test').after(() => {
  for (const directory of directories) {
    if (path.dirname(directory) !== fs.realpathSync(os.tmpdir()) && path.dirname(directory) !== os.tmpdir()) throw new Error('Unsafe test cleanup path.');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-intelligence-test-'));
  directories.push(directory);
  return directory;
}
async function fixture(t) {
  const root = temporary(t);
  const store = await IntelligenceStore.open(root);
  t.after(() => { if (store.db.open) store.close(); });
  const calls = [], responses = new Map();
  const fetcher = { async get(url, options) {
    calls.push({ url, options });
    const value = responses.get(url);
    if (typeof value === 'function') return value(url, options);
    if (value instanceof Error) throw value;
    return response(url, value ?? (url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : null));
  } };
  const owner = 'test-worker'; store.acquireLease(owner);
  const engine = new DiscoveryEngine(store, fetcher, owner, 0);
  const drain = async (limit = 1000) => {
    let n = 0, item;
    while ((item = store.claim(owner))) { if (++n > limit) throw new Error('Queue did not converge.'); await engine.process(item); }
    store.finalizeRuns();
  };
  return { root, store, calls, responses, fetcher, owner, engine, drain };
}
function response(url, value, extra = {}) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return { url, body: Buffer.alloc(0), contentType: 'application/xml', ...value };
  return { url, status: value === null ? 404 : 200, body: Buffer.from(value || ''), contentType: 'application/xml', ...extra };
}
const rss = (urls, extra = '') => `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>${extra}${urls.map(url => `<item><title>Soup &amp; bread</title><link>${url.replaceAll('&', '&amp;')}</link><pubDate>Thu, 02 Jan 2020 12:00:00 +0000</pubDate></item>`).join('')}</channel></rss>`;
const sitemap = urls => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url.replaceAll('&', '&amp;')}</loc><lastmod>2026-11-09</lastmod></url>`).join('')}</urlset>`;
const index = urls => `<sitemapindex>${urls.map(url => `<sitemap><loc>${url}</loc></sitemap>`).join('')}</sitemapindex>`;
module.exports = { fixture, temporary, response, rss, sitemap, index, IntelligenceStore };
