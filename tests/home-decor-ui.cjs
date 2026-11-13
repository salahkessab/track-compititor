const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { JSDOM } = require('jsdom');
const { HomeDecor } = require('./helpers/load-component.cjs')('HomeDecor');
async function setup(t, fetcher) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:34567/?tab=home-decor' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, fetch: fetcher };
  const saved = Object.fromEntries(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); for (const k of Object.keys(globals)) if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; });
  const control = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
  const click = async text => { const b = control(text); assert.ok(b, text); assert.equal(b.disabled, false, text); await React.act(async () => b.click()); };
  return { root, control, click };
}
test('Home & Decor stays inactive off-tab and requires explicit photo selection, estimate, then approval', async t => {
  const job = { id: 'job', state: 'review', source: { title: 'Small living room', url: 'https://decor.example/living-room', text: 'Article body' }, brief: 'Warm oak', warnings: [], settings: { textModel: 'gpt-5.4-mini', imageModel: 'gpt-image-2.6-sunburst' }, actual: 0, held: 0, photos: [{ id: 'photo1', caption: 'Living room', group: 'room-1', selected: false, originalUrl: '/original.png' }] };
  const calls = [];
  const ui = await setup(t, async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/selection')) { const value = JSON.parse(init.body); assert.equal(value.photos.length, 1); assert.equal(value.photos[0].id, 'photo1'); job.quote = { version: 'quote1', estimated: .15, limit: .3, lines: [] }; return Response.json(job); }
    if (url.endsWith('/approve')) { assert.deepEqual(JSON.parse(init.body), { version: 'quote1' }); job.state = 'queued'; return Response.json(job); }
    return Response.json({ jobs: [job], worker: { online: true } });
  });
  await React.act(async () => ui.root.render(React.createElement(HomeDecor, { active: false }))); assert.equal(calls.length, 0);
  await React.act(async () => ui.root.render(React.createElement(HomeDecor, { active: true })));
  await ui.click('Choose photos & estimate');
  assert.ok(!document.body.textContent.includes('Approve $'));
  const checkbox = document.querySelector('input[type=checkbox]'); assert.equal(checkbox.checked, false);
  await React.act(async () => checkbox.click()); await ui.click('Confirm 1 photos & show estimate');
  assert.ok(ui.control('Approve $0.3000 & Generate')); assert.ok(!calls.some(c => c.url.endsWith('/approve')));
  // Editing the selection invalidates the visible approval until a fresh quote.
  await React.act(async () => checkbox.click()); assert.equal(ui.control('Approve $0.3000 & Generate'), undefined);
  await React.act(async () => checkbox.click()); await ui.click('Confirm 1 photos & show estimate'); await ui.click('Approve $0.3000 & Generate');
  assert.equal(calls.filter(c => c.url.endsWith('/approve')).length, 1); assert.match(document.body.textContent, /Writing the article/);
});
test('completed decor articles provide preview and download and require delete confirmation', async t => {
  const calls = [], job = { id: 'ready', state: 'completed', source: { title: 'Room guide' }, article: { title: 'Room guide' }, photos: [], actual: .2, held: 0 };
  const ui = await setup(t, async (url, init = {}) => { calls.push({ url, init }); return Response.json({ jobs: [job], worker: { online: true } }); });
  await React.act(async () => ui.root.render(React.createElement(HomeDecor, { active: true })));
  assert.ok(document.querySelector('a[href="/api/recipe-intelligence/decor/ready/preview"]'));
  assert.ok(document.querySelector('a[href="/api/recipe-intelligence/decor/ready/zip"]'));
  await ui.click('Delete'); assert.ok(document.querySelector('[role=dialog]')); assert.ok(!calls.some(c => c.init.method === 'DELETE'));
  await ui.click('Keep article'); assert.equal(document.querySelector('[role=dialog]'), null);
});
