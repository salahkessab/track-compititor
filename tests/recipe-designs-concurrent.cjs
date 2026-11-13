const test = require('node:test');
const { imageAssetFetch, assetUrl } = require('./helpers/image-asset-fetch.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('node:crypto');
const React = require('react');

function loadComponent(file, mocks, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const moduleRecord = { exports: {} }; cache.set(file, moduleRecord);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = id => {
    if (mocks[id]) return mocks[id];
    if (id.startsWith('@/')) return loadComponent(path.resolve(__dirname, '..', id.slice(2) + '.ts'), mocks, cache);
    if (id.startsWith('.')) {
      const base = path.resolve(path.dirname(file), id);
      return loadComponent(fs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts', mocks, cache);
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', source)(localRequire, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

test('separate Recipe Designs tabs can generate concurrently without a confirmation popup', async () => {
  const dom = new JSDOM('<!doctype html><div id="one"></div><div id="two"></div>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'File', 'crypto', 'fetch', 'BroadcastChannel', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, File: require('node:buffer').File, crypto: webcrypto, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  URL.createObjectURL = () => 'blob:local-test'; URL.revokeObjectURL = () => {};
  dom.window.HTMLDialogElement.prototype.close = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () {};
  let lockRequests = 0;
  Object.defineProperty(dom.window.navigator, 'locks', { configurable: true, value: { request() { lockRequests++; throw new Error('Global lock was used'); } } });

  const channels = new Set();
  globalThis.BroadcastChannel = class {
    constructor() { channels.add(this); }
    postMessage(data) { for (const other of channels) if (other !== this) queueMicrotask(() => other.onmessage?.({ data })); }
    close() { channels.delete(this); }
  };
  const stores = Object.fromEntries(['settings', 'assets', 'research', 'jobs', 'history', 'locks'].map(name => [name, new Map()]));
  stores.locks.set('active', { id: 'legacy-job', createdAt: '2020-01-01T00:00:00.000Z' });
  const storage = {
    saveLocal: async (store, key, value) => { stores[store].set(key, structuredClone(value)); },
    loadLocal: async (store, key) => stores[store].get(key),
    listLocal: async store => [...stores[store].values()],
    removeLocal: async (store, key) => { stores[store].delete(key); },
    releasePaidJob: async id => { if (stores.locks.get('active')?.id === id) stores.locks.delete('active'); },
  };
  const requests = [], pending = [];
  globalThis.fetch = imageAssetFetch(async (url, init) => {
    if (url === '/api/recipe-designs/generate') {
      const body = JSON.parse(init.body); requests.push(body);
      return await new Promise(resolve => pending.push({
        succeed: () => resolve(Response.json({ image: 'data:image/png;base64,YXJ0', cost: 0.05, textCost: 0, imageCost: 0.05, searchCost: 0, costIncomplete: false })),
        fail: () => resolve(Response.json({ error: 'Provider interrupted', outcome: 'unknown', costStatus: 'The provider outcome may be unknown; check OpenAI usage.' }, { status: 502 })),
      }));
    }
    if (String(url).startsWith('data:')) return new Response('art', { headers: { 'content-type': 'image/png' } });
    throw new Error(`Unexpected network request: ${url}`);
  });
  const mocks = {
    './OpenAIImageControls': { OpenAIImageControls: () => null },
    './ImageFilterStudio': { ImageFilterStudio: () => null },
    '@/lib/recipeDesignStorage': storage,
    '@/lib/recipeDesignPhoto': {
      prepareLocalPhoto: async file => ({ id: file.name, name: file.name, type: 'image/png', blob: new Blob([file.name], { type: 'image/png' }),
        sha256: 'a'.repeat(64), width: 100, height: 100, createdAt: new Date().toISOString() }),
      recipeEditImage: async photo => `data:image/png;base64,${Buffer.from(photo.name).toString('base64')}`,
      analysisThumbnail: async () => '',
    },
    '@/lib/recipeDesignOutput': { recipeDesignDimensions: () => ({width:1200,height:1500}), recipeDesignPng: async () => new Blob(['design'], { type: 'image/png' }) },
  };
  const { createRoot } = require('react-dom/client');
  const { RecipeDesigns } = loadComponent(path.resolve(__dirname, '../app/components/RecipeDesigns.tsx'), mocks);
  const roots = [createRoot(document.getElementById('one')), createRoot(document.getElementById('two'))];
  const settle = () => new Promise(resolve => setTimeout(resolve, 40));
  const drop = file => { const event = new dom.window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file], dropEffect: 'none' } }); return event; };
  const setInput = (element, value) => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  try {
    await React.act(async () => { roots.forEach(root => root.render(React.createElement(RecipeDesigns))); await settle(); });
    const tabs = [...document.querySelectorAll('[aria-label="Recipe Designs studio"]')];
    assert.equal(tabs.length, 2);
    await React.act(async () => {
      tabs.forEach((tab, index) => {
        setInput(tab.querySelector('#recipe-design-title'), index ? 'Chicken dinner' : 'Apple pie');
        tab.querySelector('[aria-label="Drop an original food photo here or browse files"]').dispatchEvent(drop(new dom.window.File(['photo'], `food-${index}.png`, { type: 'image/png' })));
      });
      await settle();
    });
    const generate = tab => [...tab.querySelectorAll('button')].find(button => button.textContent === 'Generate Design');
    assert.ok(tabs.every(tab => !generate(tab).disabled));
    assert.ok(tabs.every(tab => /You can start another design/.test(tab.textContent)));
    await React.act(async () => { generate(tabs[0]).click(); generate(tabs[0]).click(); generate(tabs[1]).click(); await settle(); });
    assert.equal(requests.length, 2);
    assert.equal(lockRequests, 0);
    assert.deepEqual(requests.map(request => request.title), ['Apple pie', 'Chicken dinner']);
    assert.equal(requests[0].settings.model, requests[1].settings.model);
    assert.equal(requests[0].settings.styleId, requests[1].settings.styleId);
    assert.notEqual(requests[0].photo, requests[1].photo);
    assert.ok(requests.every(request => request.approved === true));
    assert.equal(document.querySelector('[aria-label="Approve paid generation"]'), null);
    assert.ok(tabs.every(tab => /OpenAI is designing image 1 of 1/.test(tab.textContent)));
    assert.ok(tabs.every(tab => generate(tab).disabled));
    assert.ok(tabs.every(tab => /2 reserved\/in progress/.test(tab.textContent)));
    await React.act(async () => { pending.splice(0).forEach(request => request.succeed()); await settle(); });
    assert.equal(stores.jobs.size, 2);
    assert.ok([...stores.jobs.values()].every(job => job.status === 'complete' && job.costs.length === 1),JSON.stringify([...stores.jobs.values()]));
    assert.equal(stores.history.size, 2);
    assert.ok(tabs.every(tab => /Design History \(2\)/.test(tab.textContent)));
    assert.ok(tabs.every(tab => !generate(tab).disabled));
    await React.act(async () => { generate(tabs[0]).click(); generate(tabs[1]).click(); await settle(); });
    assert.equal(requests.length, 4);
    await React.act(async () => { pending[0].fail(); pending[1].succeed(); pending.length = 0; await settle(); });
    assert.equal(requests.length, 4, 'provider errors must not trigger automatic retries');
    assert.equal([...stores.jobs.values()].filter(job => job.status === 'unknown').length, 1);
    assert.equal([...stores.jobs.values()].filter(job => job.status === 'complete').length, 3);
    assert.match(tabs[0].textContent, /Provider interrupted/);
    assert.match(tabs[1].textContent, /OpenAI design complete/);
    assert.ok(tabs.every(tab => !generate(tab).disabled));
  } finally {
    await React.act(async () => roots.forEach(root => root.unmount())); dom.window.close();
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    for (const name of globals) {
      if (originals[name]) Object.defineProperty(globalThis, name, originals[name]);
      else delete globalThis[name];
    }
  }
});
