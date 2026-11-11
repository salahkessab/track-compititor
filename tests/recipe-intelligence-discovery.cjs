const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { fixture, response, rss, sitemap, index } = require('./helpers/recipe-fixtures.cjs');
const { parseSource, discoverHead } = require('../.intelligence-build/lib/recipe-intelligence/discovery.js');
const { decodeBody, PublicDiscoveryFetcher, resolvePublic, retryAfter } = require('../.intelligence-build/lib/recipe-intelligence/fetch.js');
const { normalizeUrl, publicUrl, isPublicAddress } = require('../.intelligence-build/lib/recipe-intelligence/urls.js');

test('public requests retain both validated address families for connection fallback and reject mixed private DNS', async t => {
  const dns = require('node:dns/promises'); const https = require('node:https');
  const { EventEmitter } = require('node:events'); const { Readable } = require('node:stream');
  const answers = [{ address: '2606:4700:4700::1111', family: 6 }, { address: '1.1.1.1', family: 4 }];
  const dnsLookup = t.mock.method(dns, 'lookup', async () => answers);
  const transport = t.mock.method(https, 'request', (url, options, receive) => {
    const req = new EventEmitter();
    req.end = () => {
      assert.equal(options.family, 0); assert.equal(options.autoSelectFamily, true);
      assert.ok(options.autoSelectFamilyAttemptTimeout <= 1000);
      options.lookup(url.hostname, { all: true }, (error, pinned) => {
        assert.equal(error, null); assert.deepEqual(pinned, answers);
        const response = Readable.from([Buffer.from('User-agent: *\nAllow: /\n')]);
        response.statusCode = 200; response.headers = { 'content-type': 'text/plain' };
        response.on('end', () => req.emit('close')); receive(response);
      });
    };
    return req;
  });
  const result = await new PublicDiscoveryFetcher(0).get('https://food.example/robots.txt');
  assert.equal(result.status, 200); assert.equal(dnsLookup.mock.callCount(), 1);
  dnsLookup.mock.mockImplementation(async () => [...answers, { address: '127.0.0.1', family: 4 }]);
  await assert.rejects(new PublicDiscoveryFetcher(0).get('https://unsafe.example/robots.txt'), /non-public/);
  assert.equal(transport.mock.callCount(), 1, 'unsafe DNS answers never reach a connection attempt');
});

test('nested sitemaps, RSS and pagination loops converge to unique URL history', async t => {
  const { store, responses, calls, drain } = await fixture(t);
  const site = store.addSite('', 'https://food.example/');
  responses.set(`${site.url}robots.txt`, `User-agent: *\nSitemap: ${site.url}index.xml`);
  responses.set(site.url, `<html><head><link rel="alternate" type="application/atom+xml" href="/atom"/><link rel="https://api.w.org/" href="/wp-json/"/></head></html>`);
  responses.set(`${site.url}index.xml`, index([`${site.url}nested.xml`]));
  responses.set(`${site.url}nested.xml`, index([`${site.url}recipes.xml`, `${site.url}index.xml`]));
  responses.set(`${site.url}recipes.xml`, sitemap([`${site.url}soup/`, `${site.url}stew/`]));
  responses.set(`${site.url}feed/`, rss([`${site.url}soup/?utm_source=rss`], '<atom:link rel="next" href="/page2"/>'));
  responses.set(`${site.url}page2`, rss([`${site.url}cake/`], '<atom:link rel="next" href="/feed/"/>'));
  responses.set(`${site.url}atom`, `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Cake</title><link href="/cake/"/><published>2018-01-01</published></entry></feed>`);
  store.createScan(site.id); await drain();
  assert.equal(store.history(site.id).total, 3);
  assert.equal(new Set(calls.map(call => call.url)).size, calls.length);
  assert.equal(store.source(site.id, `${site.url}wp-json/`).kind, 'wordpress_api');
  assert.equal(calls.some(call => call.url.includes('wp-json')), false, 'Phase 1 only records API availability');
  assert.equal(store.snapshot().runs[0].status, 'completed');
});

test('one source failure does not lose successful discoveries or stop a different site; targeted retry reuses successes', async t => {
  const { store, responses, calls, drain } = await fixture(t);
  const a = store.addSite('A', 'https://a.example/'), b = store.addSite('B', 'https://b.example/');
  responses.set(`${a.url}feed/`, rss([`${a.url}soup/`])); responses.set(`${a.url}sitemap.xml`, '<urlset><broken>');
  responses.set(`${b.url}sitemap.xml`, sitemap([`${b.url}stew/`]));
  const run = store.createScan(a.id); store.createScan(b.id); await drain();
  assert.equal(store.db.prepare('SELECT status FROM scan_runs WHERE id=?').get(run).status, 'partial');
  assert.equal(store.history(a.id).total, 1); assert.equal(store.history(b.id).total, 1);
  const feedCalls = calls.filter(call => call.url === `${a.url}feed/`).length;
  responses.set(`${a.url}sitemap.xml`, sitemap([`${a.url}salad/`])); store.runAction(run, 'retry'); await drain();
  assert.equal(store.history(a.id).total, 2);
  assert.equal(calls.filter(call => call.url === `${a.url}feed/`).length, feedCalls);
  assert.equal(store.db.prepare('SELECT status FROM scan_runs WHERE id=?').get(run).status, 'completed');
});

test('transient errors use at most three attempts and robots failures block only their own site', async t => {
  const { store, responses, calls, drain } = await fixture(t);
  const a = store.addSite('', 'https://denied.example/'), b = store.addSite('', 'https://ok.example/');
  responses.set(`${a.url}robots.txt`, { status: 503 }); responses.set(`${b.url}feed/`, rss([`${b.url}soup/`]));
  store.createScan(a.id); store.createScan(b.id); await drain();
  assert.equal(calls.filter(call => call.url.startsWith(a.url)).length, 3);
  assert.equal(calls.filter(call => call.url.startsWith(a.url)).every(call => call.url.endsWith('/robots.txt')), true);
  assert.equal(store.history(b.id).total, 1);
  assert.equal(store.snapshot().runs.find(run => run.site_id === a.id).status, 'failed');
});

test('unchanged sitemap indexes still traverse saved child sources on later scans', async t => {
  const { store, responses, calls, drain } = await fixture(t);
  const site = store.addSite('', 'https://etag.example/');
  responses.set(`${site.url}sitemap.xml`, () => response(`${site.url}sitemap.xml`, index([`${site.url}child.xml`]), { etag: '"v1"' }));
  responses.set(`${site.url}child.xml`, sitemap([`${site.url}old/`]));
  store.createScan(site.id); await drain();
  responses.set(`${site.url}sitemap.xml`, { status: 304 });
  responses.set(`${site.url}child.xml`, sitemap([`${site.url}old/`, `${site.url}new/`]));
  store.createScan(site.id); await drain();
  assert.equal(calls.filter(call => call.url.endsWith('child.xml')).length, 2);
  assert.equal(calls.filter(call => call.url === `${site.url}sitemap.xml`).at(-1).options.etag, '"v1"');
  assert.equal(store.history(site.id).total, 2);
  assert.equal(store.db.prepare("SELECT origin FROM recipe_records WHERE canonical_url LIKE '%new/'").get().origin, 'later_discovery');
});

test('interruption returns claimed work to the queue without counting a failed attempt', async t => {
  const { store, owner, engine } = await fixture(t);
  const site = store.addSite('', 'https://interrupted.example/'); store.createScan(site.id);
  const item = store.claim(owner), controller = new AbortController(); controller.abort();
  await engine.process(item, controller.signal);
  const saved = store.db.prepare('SELECT state,attempts FROM scan_items WHERE id=?').get(item.id);
  assert.deepEqual(saved, { state: 'queued', attempts: 0 });
});

test('compressed sitemap bodies decode with strict decompression limits', async () => {
  const xml = sitemap(['https://food.example/soup/']);
  const gzip = zlib.gzipSync(xml);
  assert.equal(parseSource((await decodeBody(gzip, '')).toString(), 'https://food.example/map.xml.gz').candidates.length, 1);
  assert.equal((await decodeBody(zlib.brotliCompressSync(Buffer.from(xml)), 'br')).toString(), xml);
  await assert.rejects(decodeBody(zlib.gzipSync('x'.repeat(100000)), 'gzip', 1000), /size limit/);
  await assert.rejects(decodeBody(Buffer.from('broken'), 'gzip'));
  await assert.rejects(decodeBody(Buffer.from('text'), 'unsupported'), /Unsupported/);
});

test('Atom namespaces and xml:base preserve raw date precision and usable alternate links', () => {
  const source = parseSource(`<a:feed xmlns:a="http://www.w3.org/2005/Atom" xml:base="https://food.example/recipes/"><a:link rel="next" href="../feed?page=2"/><a:entry><a:title><![CDATA[<b>Soup</b>]]></a:title><a:link rel="self" href="id"/><a:link rel="alternate" href="soup/"/><a:published>2020-02-03</a:published><a:updated>2026-02-04T10:00:00+01:00</a:updated></a:entry></a:feed>`, 'https://food.example/feed');
  assert.equal(source.candidates[0].url, 'https://food.example/recipes/soup/');
  assert.equal(source.candidates[0].title, 'Soup');
  assert.equal(source.candidates[0].feedPublished, '2020-02-03');
  assert.deepEqual(source.next, ['https://food.example/feed?page=2']);
});

test('malformed XML, entities, excessive nesting and oversized source counts are rejected', () => {
  const base = 'https://food.example/feed/';
  assert.throws(() => parseSource('<rss><channel></rss>', base));
  assert.throws(() => parseSource('<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///c:/secret">]><rss/>', base), /entities/);
  assert.throws(() => parseSource(`<rss>${'<x>'.repeat(70)}${'</x>'.repeat(70)}</rss>`, base), /nesting/);
  assert.throws(() => parseSource(sitemap(Array.from({ length: 50001 }, (_, i) => `${base}${i}`)), base), /50,000/);
});

test('homepage discovery only uses advertised metadata and rejects excessive pages', () => {
  const result = discoverHead('<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"/><link rel="https://api.w.org/" href="/wp-json/"/></head><body><a href="/2026/latest">Latest recipe</a></body></html>', 'https://food.example/');
  assert.deepEqual(result, { feeds: ['https://food.example/feed/'], apis: ['https://food.example/wp-json/'] });
  assert.throws(() => discoverHead('x'.repeat(2000001), 'https://food.example/'), /size limit/);
});

test('SSRF checks reject private, encoded, credentialed and nonstandard-port destinations', async () => {
  for (const value of ['http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://10.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'https://user:pass@food.example/', 'https://food.example:8080/', 'http://printer.local/']) assert.throws(() => publicUrl(value), value);
  assert.equal(isPublicAddress('8.8.8.8'), true); assert.equal(isPublicAddress('169.254.169.254'), false);
  for (const value of ['https://[2001:2::1]/', 'https://[3fff::1]/', 'https://192.88.99.2/']) assert.throws(() => publicUrl(value), value);
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true);
  await assert.rejects(resolvePublic('127.0.0.1'), /non-public/);
  assert.equal(normalizeUrl('https://Food.Example/Soup/?utm_source=email&portion=2#card'), 'https://food.example/Soup/?portion=2');
});

test('redirects are revalidated, robots restrictions are enforced, and redirect loops are bounded', async () => {
  const fetcher = new PublicDiscoveryFetcher(0); const calls = [];
  fetcher.raw = async url => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return response(url, 'User-agent: *\nDisallow: /private\nCrawl-delay: 3');
    if (url.endsWith('/redirect')) return { ...response(url, ''), status: 302, location: 'http://127.0.0.1/secret' };
    return { ...response(url, ''), status: 302, location: '/loop' };
  };
  await assert.rejects(fetcher.get('https://food.example/private'), /robots/);
  assert.equal(calls.some(url => url.endsWith('/private')), false);
  assert.equal(fetcher.delays.get('food.example'), 3000);
  await assert.rejects(fetcher.get('https://food.example/redirect'), /public HTTP/);
  assert.equal(calls.some(url => url.includes('127.0.0.1')), false);
  await assert.rejects(fetcher.get('https://food.example/loop'), /Redirect loop/);
  assert.equal(retryAfter('10'), 10000);
});

test('tracking uses only discovery inputs even when a paid API key is configured', async t => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-do-not-use';
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  const { store, responses, calls, drain } = await fixture(t);
  const site = store.addSite('', 'https://only-discovery.example/');
  responses.set(`${site.url}feed/`, rss([`${site.url}soup/`, 'https://unrelated.example/recipe/']));
  store.createScan(site.id); await drain();
  assert.ok(calls.length > 0); assert.equal(calls.every(call => call.url.startsWith(site.url)), true);
  assert.equal(calls.some(call => JSON.stringify(call.options).includes('test-do-not-use')), false);
  assert.equal(store.history(site.id).total, 1);
});
