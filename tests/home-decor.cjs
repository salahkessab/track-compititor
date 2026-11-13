const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { fixture } = require('./helpers/recipe-fixtures.cjs');
const { textResponse } = require('./helpers/content-fixtures.cjs');
const { DecorStore } = require('../.intelligence-build/lib/recipe-intelligence/decor.js');
const { extractDecor, decorHtml, validateDecorArticle } = require('../.intelligence-build/lib/recipe-intelligence/decorArticle.js');
const prompts = require('../.intelligence-build/lib/recipe-intelligence/decorPrompts.js');
const text = 'Small living room ideas\n' + 'Place a sofa along the wall while keeping the doorway clear. Use a rug to connect the seating area and combine oak furniture with soft linen cushions. '.repeat(4);
const article = (photos = []) => ({ title: 'A comfortable small living room', seoTitle: 'Small living room ideas', slug: 'small-living-room', metaDescription: 'A practical guide to arranging and decorating a comfortable small living room.', introduction: 'Make room for everyday use with a clear path through the seating area.', sections: [{ heading: 'Give the seating a purpose', paragraphs: ['Place the main seats around a shared focal point.'] }, { heading: 'Work with natural textures', paragraphs: ['Linen and wood bring quiet texture to this room.'] }], notes: [], imagePlans: photos.map((id, index) => ({ id, relevant: true, kitchen: false, subject: 'Living room seating and window', reason: '', alt: 'A living room with linen seating and oak furniture', section: index % 2 })) });
const image = async color => sharp({ create: { width: 320, height: 240, channels: 3, background: color } }).png().toBuffer();

test('embedded decor skills match their maintained sources', () => {
  for (const [key, folder] of [['DECOR_ARTICLE_SKILL', 'home-decor-article'], ['DECOR_IMAGE_SKILL', 'home-decor-images']]) assert.equal(prompts[key].replace(/\r\n/g,'\n'), fs.readFileSync(path.join(__dirname, '../skills', folder, 'SKILL.md'), 'utf8').replace(/\r\n/g,'\n').split('---').slice(2).join('---').trim());
});
test('decor extraction accepts non-recipe articles and excludes related images and sidebar text', () => {
  const source = extractDecor(`<h1>Living room ideas</h1><article><p>${text}</p><figure><img src="/room.jpg" width="900" height="700" alt="Room"><figcaption>A bright living room</figcaption></figure><div class="related-posts"><p>Unrelated kitchen</p><img src="/other.jpg"></div><aside>About the author<img src="/author.jpg"></aside></article>`, 'https://decor.example/living-room');
  assert.equal(source.title, 'Living room ideas'); assert.equal(source.photos.length, 1); assert.equal(source.photos[0].url, 'https://decor.example/room.jpg'); assert.ok(!source.text.includes('Unrelated kitchen'));
});
test('import and selection are free; approval freezes selected references; generation uses original bytes and same-room continuity', async t => {
  const f = await fixture(t), decor = new DecorStore(f.store), job = decor.create('https://decor.example/room', text);
  const first = await image('#bca88d'), second = await image('#99aabb'), third = await image('#445566');
  await decor.upload(job.id, first, 'Wide living room'); await decor.upload(job.id, second, 'Living room close-up'); await decor.upload(job.id, third, 'Skip this reference');
  let view = decor.detail(job.id); assert.equal(view.state, 'review'); assert.equal(view.photos.filter(p => p.selected).length, 0); assert.equal(decor.claim(), null); assert.throws(() => decor.approve(job.id, 'x'), /Confirm photo/);
  const ids = view.photos.slice(0, 2).map(p => p.id);
  view = decor.select(job.id, { brief: 'Warm oak and muted sage', photos: ids.map(id => ({ id, group: 'same-room' })) });
  assert.equal(view.quote.lines.length, 4); assert.ok(view.quote.lines.some(l => l.stage === 'refinement')); assert.equal(decor.claim(), null);
  assert.throws(() => decor.approve(job.id, 'old'), /current estimate/);
  decor.approve(job.id, view.quote.version); assert.throws(() => decor.select(job.id, { photos: [], brief: '' }), /queued/);
  const calls = [], provider = { async request(op, payload) { calls.push({ op, payload }); return op === 'text' ? textResponse(article(ids)) : { body: { data: [{ b64_json: first.toString('base64') }], usage: { input_tokens: 100, output_tokens: 100, input_tokens_details: { text_tokens: 50, image_tokens: 50 } } }, requestId: 'test-image' }; } };
  assert.equal(decor.claim(), job.id); await decor.process(job.id, f.fetcher, provider);
  view = decor.detail(job.id); assert.equal(view.state, 'completed', view.error); assert.equal(calls.length, 3); assert.equal(view.photos.filter(p => p.outputUrl).length, 2);
  assert.equal(calls[1].payload.references.length, 1); assert.equal(calls[2].payload.references.length, 2); assert.ok(calls[1].payload.references[0].startsWith('data:image/png;base64,'));
  assert.equal(calls[0].payload.input[0].content.filter(p => p.type === 'input_image').length, 2);
  assert.ok(!calls[1].payload.prompt.includes('ingredients')); assert.ok((await decor.document(job.id)).toString().includes(`/output/${ids[0]}`));
  const zip = (await decor.document(job.id, true)).toString('latin1'); assert.ok(zip.includes('article.html')); assert.ok(zip.includes(`image-${ids[0]}.webp`)); assert.ok(!zip.includes('reference-'));
  assert.equal(decor.claim(), null); assert.equal(f.store.db.prepare('SELECT count(*) n FROM content_items').get().n, 0);
});
test('uncertain requests survive recovery and are never repeated automatically', async t => {
  const f = await fixture(t), decor = new DecorStore(f.store), job = decor.create('https://decor.example/room', text);
  const quote = decor.select(job.id, { brief: '', photos: [] }).quote; decor.approve(job.id, quote.version); decor.claim(); let calls = 0;
  await decor.process(job.id, f.fetcher, { async request() { calls++; throw new Error('Connection interrupted'); } });
  assert.equal(decor.detail(job.id).state, 'uncertain'); assert.ok(decor.detail(job.id).held > 0); decor.recover(); assert.equal(decor.claim(), null); assert.equal(calls, 1);
});
test('irrelevant and kitchen references never reach the image provider', async t => {
  const f = await fixture(t), decor = new DecorStore(f.store), job = decor.create('https://decor.example/room', text);
  await decor.upload(job.id, await image('#aaaaaa'), 'Author portrait'); await decor.upload(job.id, await image('#bbbbbb'), 'Kitchen');
  const photos = decor.detail(job.id).photos.map(p => ({ id: p.id, group: 'room' })); const quote = decor.select(job.id, { brief: '', photos }).quote; decor.approve(job.id, quote.version); decor.claim();
  let calls = 0; await decor.process(job.id, f.fetcher, { async request(op) { calls++; assert.equal(op, 'text'); const a = article(photos.map(p => p.id)); a.imagePlans[0].relevant = false; a.imagePlans[0].reason = 'Author portrait'; a.imagePlans[1].kitchen = true; return textResponse(a); } });
  assert.equal(decor.detail(job.id).state, 'completed'); assert.equal(calls, 1); assert.ok(decor.detail(job.id).photos.every(p => p.error && !p.outputUrl));
});
test('failed imports offer pasted-text recovery and document rendering escapes model text', async t => {
  const f = await fixture(t), decor = new DecorStore(f.store), job = decor.create('https://decor.example/blocked'); decor.claim();
  await decor.process(job.id, { async get(url) { return { url, status: 403, body: Buffer.alloc(0) }; } }, { async request() { throw new Error('No paid call expected'); } });
  assert.equal(decor.detail(job.id).state, 'failed'); assert.match(decor.detail(job.id).error, /pasting/);
  assert.throws(() => validateDecorArticle({ ...article(), introduction: '<script>alert(1)</script>' }, []), /invalid text/);
  const html = decorHtml({ ...article(), title: '<script>x</script>' }, []); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('decor.example'));
});
test('selection revisions, budget enforcement and deletion preserve unrelated recipes', async t => {
  const f = await fixture(t), decor = new DecorStore(f.store), job = decor.create('https://decor.example/room', text);
  let q = decor.select(job.id, { brief: 'Oak', photos: [] }).quote;
  const old = q.version; q = decor.select(job.id, { brief: 'Walnut', photos: [] }).quote; assert.notEqual(old, q.version); assert.throws(() => decor.approve(job.id, old), /current estimate/);
  decor.approve(job.id, q.version); assert.throws(() => decor.remove(job.id), /current request/); decor.claim();
  const stored = JSON.parse(f.store.db.prepare('SELECT data_json FROM decor_jobs WHERE id=?').get(job.id).data_json); stored.limit = .000001; f.store.db.prepare('UPDATE decor_jobs SET data_json=? WHERE id=?').run(JSON.stringify(stored), job.id);
  await decor.process(job.id, f.fetcher, { async request() { assert.fail('Budget must block dispatch'); } });
  assert.match(decor.detail(job.id).error, /budget/); decor.remove(job.id); assert.equal(decor.list().length, 0); assert.equal(f.store.integrity(), 'ok');
});

test('decor API inherits workspace authentication, CSRF and recovery-mode protection', async t => {
  const { temporary } = require('./helpers/recipe-fixtures.cjs');
  const { handleIntelligence } = require('../.intelligence-build/lib/recipe-intelligence/api.js');
  const keys = ['RECIPE_INTELLIGENCE_ROOT','RECIPE_INTELLIGENCE_LOCAL','RECIPE_INTELLIGENCE_TOKEN','RECIPE_INTELLIGENCE_ORIGIN','RECIPE_INTELLIGENCE_READ_ONLY','RECIPE_INTELLIGENCE_MODE','VERCEL'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(async () => { for (const p of globalThis.recipeIntelligenceStores?.values() || []) (await p).close(); globalThis.recipeIntelligenceStores?.clear(); for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  Object.assign(process.env, { RECIPE_INTELLIGENCE_ROOT: temporary(t), RECIPE_INTELLIGENCE_LOCAL:'1', RECIPE_INTELLIGENCE_TOKEN:'decor-test-token', RECIPE_INTELLIGENCE_ORIGIN:'http://127.0.0.1:34567' }); delete process.env.VERCEL; delete process.env.RECIPE_INTELLIGENCE_MODE; delete process.env.RECIPE_INTELLIGENCE_READ_ONLY;
  const request = (route, method = 'GET', data, headers = {}) => handleIntelligence(new Request('http://127.0.0.1:34567/api/recipe-intelligence/' + route, { method, headers: { Host:'127.0.0.1:34567', Origin:'http://127.0.0.1:34567', 'X-RI-Key':'decor-test-token', 'X-Recipe-Intelligence':'1', 'Content-Type':'application/json', ...headers }, ...(data === undefined ? {} : { body:JSON.stringify(data) }) }));
  assert.equal((await request('decor','GET',undefined,{'X-RI-Key':''})).status,401);
  assert.equal((await request('decor','POST',{url:'https://decor.example/a',text},{Origin:'https://other.example'})).status,403);
  assert.equal((await request('decor','POST',{url:'http://localhost/a',text})).status,400);
  const response = await request('decor','POST',{url:'https://decor.example/a',text}); assert.equal(response.status,201); const job = await response.json();
  assert.equal((await request(`decor/${job.id}/approve`,'POST',{version:'invented'})).status,400);
  assert.equal((await request(`decor/${job.id}/photo/missing`,'GET',undefined,{'X-RI-Key':''})).status,401);
  process.env.RECIPE_INTELLIGENCE_READ_ONLY = '1'; assert.equal((await request(`decor/${job.id}/selection`,'POST',{photos:[],brief:''})).status,423);
  delete process.env.RECIPE_INTELLIGENCE_READ_ONLY;
  assert.equal((await request(`decor/${job.id}`,'DELETE',{})).status,400);
  assert.equal((await request(`decor/${job.id}`,'DELETE',{confirmed:true})).status,200);
});
