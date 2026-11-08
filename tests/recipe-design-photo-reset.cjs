const test = require('node:test');
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

test('changing a recipe photo clears the old draft only after a valid upload', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'File', 'crypto', 'fetch', 'BroadcastChannel', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, File: dom.window.File, crypto: webcrypto, BroadcastChannel: undefined, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  URL.createObjectURL = () => 'blob:local-test'; URL.revokeObjectURL = () => {};
  dom.window.HTMLDialogElement.prototype.close = function () {};
  const stores = Object.fromEntries(['settings', 'assets', 'research', 'jobs', 'history', 'locks'].map(name => [name, new Map()]));
  const storage = {
    saveLocal: async (store, key, value) => { stores[store].set(key, structuredClone(value)); },
    loadLocal: async (store, key) => stores[store].get(key),
    listLocal: async store => [...stores[store].values()],
    removeLocal: async (store, key) => { stores[store].delete(key); },
    releasePaidJob: async () => {},
  };
  const requests = [];
  globalThis.fetch = async (url, init) => {
    if (url === '/api/recipe-designs/generate') {
      requests.push(JSON.parse(init.body));
      return Response.json({ image: 'data:image/png;base64,YXJ0', cost: 0.05, textCost: 0, imageCost: 0.05, searchCost: 0, costIncomplete: false });
    }
    if (String(url).startsWith('data:')) return new Response('art', { headers: { 'content-type': 'image/png' } });
    throw new Error(`Unexpected network request: ${url}`);
  };
  let finishPhoto, finishReference;
  const makePhoto = file => ({ id: file.name, name: file.name, type: 'image/png', blob: new Blob([file.name], { type: 'image/png' }),
    sha256: 'a'.repeat(64), width: 100, height: 100, createdAt: new Date().toISOString() });
  const mocks = {
    './ImageFilterStudio': { ImageFilterStudio: () => null },
    '@/lib/recipeDesignStorage': storage,
    '@/lib/recipeDesignPhoto': {
      prepareLocalPhoto: async file => {
        if (file.name === 'bad.png') throw new Error('Invalid photo');
        if (file.name === 'slow.png') return await new Promise(resolve => { finishPhoto = () => resolve(makePhoto(file)); });
        if (file.name === 'slow-reference.png') return await new Promise(resolve => { finishReference = () => resolve(makePhoto(file)); });
        return makePhoto(file);
      },
      recipeEditImage: async photo => `data:image/png;base64,${Buffer.from(photo.name).toString('base64')}`,
      analysisThumbnail: async () => '',
    },
    '@/lib/recipeDesignOutput': { recipeDesignPng: async () => new Blob(['design'], { type: 'image/png' }) },
  };
  const { createRoot } = require('react-dom/client');
  const { RecipeDesigns } = loadComponent(path.resolve(__dirname, '../app/components/RecipeDesigns.tsx'), mocks);
  const root = createRoot(document.getElementById('root'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 50));
  const file = name => new dom.window.File(['photo'], name, { type: 'image/png' });
  const drop = image => { const event = new dom.window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [image], dropEffect: 'none' } }); return event; };
  const setValue = (element, value) => {
    const proto = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const select = (element, value) => { element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  const title = () => document.getElementById('recipe-design-title');
  const ingredients = () => document.getElementById('recipe-design-ingredients');
  const notes = () => document.querySelector('textarea[placeholder^="Optional: colors"]');
  const generate = () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Generate Design');
  try {
    await React.act(async () => { root.render(React.createElement(RecipeDesigns)); await settle(); });
    await React.act(async () => {
      select(document.getElementById('recipe-design-style'), 'vintage_ingredients_card');
      select(document.querySelector('select[aria-label="Quality"]'), 'medium');
      select(document.querySelector('select[aria-label="Output format"]'), 'jpeg');
    });
    await React.act(async () => { setValue(title(), 'Old casserole'); setValue(ingredients(), 'Potatoes (2)\nCheese (1 cup)'); setValue(notes(), 'Old recipe note'); });
    const zone = document.querySelector('[aria-label="Drop an original food photo here or browse files"]');
    await React.act(async () => { zone.dispatchEvent(drop(file('first.png'))); await settle(); });
    assert.equal(title().value, 'Old casserole', 'the first upload should keep a title entered beforehand');
    assert.match(ingredients().value, /Potatoes/);
    const referencePicker = document.querySelector('input[aria-label="Design reference images"]');
    Object.defineProperty(referencePicker, 'files', { configurable: true, value: [file('reference.png')] });
    await React.act(async () => { referencePicker.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await settle(); });
    assert.ok(document.querySelector('img[alt="Style reference 1"]'));
    await React.act(async () => { generate().click(); await settle(); });
    assert.equal(requests.length, 1);
    assert.equal(stores.history.size, 1);
    assert.ok(document.querySelector('img[alt="Recipe design preview"]'));

    await React.act(async () => { zone.dispatchEvent(drop(file('bad.png'))); await settle(); });
    assert.match(document.querySelector('[role="alert"]').textContent, /Invalid photo/);
    assert.equal(title().value, 'Old casserole');
    assert.match(ingredients().value, /Potatoes/);
    assert.ok(document.querySelector('img[alt="Recipe design preview"]'));

    Object.defineProperty(referencePicker, 'files', { configurable: true, value: [file('slow-reference.png')] });
    await React.act(async () => { referencePicker.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await settle(); });
    await React.act(async () => { zone.dispatchEvent(drop(file('slow.png'))); await settle(); });
    assert.equal(generate().disabled, true, 'generation must wait for the new photo');
    assert.equal(title().disabled, true);
    assert.equal(title().value, 'Old casserole', 'do not clear the draft before the new photo is accepted');
    await React.act(async () => { finishPhoto(); await settle(); });
    assert.equal(title().value, '');
    assert.equal(ingredients().value, '');
    assert.equal(notes().value, '');
    assert.equal(document.querySelector('img[alt="Style reference 1"]'), null);
    await React.act(async () => { finishReference(); await settle(); });
    assert.equal(document.querySelector('img[alt="Style reference 1"]'), null, 'a pending old reference must not return after the reset');
    assert.equal(document.getElementById('recipe-design-style').value, 'vintage_ingredients_card');
    assert.equal(document.querySelector('select[aria-label="Quality"]').value, 'medium');
    assert.equal(document.querySelector('select[aria-label="Output format"]').value, 'jpeg');
    assert.equal(stores.history.size, 1, 'the previous design stays in history');
    assert.match(document.body.textContent, /Your OpenAI design will appear here/);

    await React.act(async () => { setValue(title(), 'Second recipe'); setValue(ingredients(), 'Eggs (2)'); });
    const picker = document.querySelector('input[aria-label="Original Food Photograph"]');
    Object.defineProperty(picker, 'files', { configurable: true, value: [file('browse.png')] });
    await React.act(async () => { picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await settle(); });
    assert.equal(title().value, ''); assert.equal(ingredients().value, '');
    await React.act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Remove').click());
    await React.act(async () => { setValue(title(), 'New title before upload'); setValue(ingredients(), 'Garlic (1 clove)'); });
    await React.act(async () => { zone.dispatchEvent(drop(file('new.png'))); await settle(); });
    assert.equal(title().value, 'New title before upload');
    assert.equal(ingredients().value, 'Garlic (1 clove)');
    assert.equal(requests.length, 1, 'changing photos must never start another paid request');
  } finally {
    await React.act(async () => root.unmount()); dom.window.close();
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    for (const name of globals) {
      if (originals[name]) Object.defineProperty(globalThis, name, originals[name]);
      else delete globalThis[name];
    }
  }
});
