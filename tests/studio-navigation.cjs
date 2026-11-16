const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');

function loadPage(file, mocks, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const moduleRecord = { exports: {} }; cache.set(file, moduleRecord);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = id => {
    if (mocks[id]) return mocks[id];
    if (id.startsWith('@/')) return loadPage(path.resolve(__dirname, '..', id.slice(2) + '.ts'), mocks, cache);
    if (id.startsWith('.')) {
      const base = path.resolve(path.dirname(file), id);
      return loadPage(fs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts', mocks, cache);
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', source)(localRequire, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

test('navigation links open their sections and keep the current draft during in-page navigation', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/?tab=recipe-designs' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const mocks = {
    './components/OpenAIImageControls': { OpenAIImageControls: () => null },
    './components/ImageFilterStudio': { ImageFilterStudio: () => null },
    './components/RecipeDesigns': { RecipeDesigns: () => React.createElement('div', { 'data-workspace': 'designs' }, React.createElement('input', { 'aria-label': 'Test draft' })) },
    './components/RecipeImageToImage': { RecipeImageToImage: () => React.createElement('div', { 'data-workspace': 'image-to-image' }) },
    './components/RecipeTwoInOne': { RecipeTwoInOne: () => React.createElement('div', { 'data-workspace': 'two-in-one' }) },
    './components/RecipeIntelligence': { RecipeIntelligence: () => React.createElement('div', { 'data-workspace': 'intelligence' }) },
  };
  const { createRoot } = require('react-dom/client');
  const Page = loadPage(path.resolve(__dirname, '../app/page.tsx'), mocks).default;
  const root = createRoot(document.getElementById('root'));
  const workspace = name => document.querySelector(`[data-workspace="${name}"]`);
  const visible = name => !workspace(name).parentElement.hidden;
  const link = name => [...document.querySelectorAll('nav a')].find(item => item.textContent === name);
  const settle = () => new Promise(resolve => setTimeout(resolve, 40));
  try {
    await React.act(async () => root.render(React.createElement(Page)));
    assert.equal(visible('designs'), true);
    assert.equal(link('Recipe Designs').getAttribute('href'), '/?tab=recipe-designs');
    assert.equal(link('Image to Image').getAttribute('href'), '/?tab=image-to-image');
    assert.equal(link('2 in one image').getAttribute('href'), '/?tab=two-in-one');
    workspace('designs').querySelector('input').value = 'draft stays here';
    await React.act(async () => link('Overview').click());
    assert.equal(link('Overview').getAttribute('aria-current'), 'page');
    assert.ok(workspace('designs').closest('[hidden]'), 'overview hides the mounted workspace');
    assert.equal(document.querySelector('.studio-breadcrumb strong').textContent, 'Overview');
    await React.act(async () => document.querySelector('.overview-tool[href="/?tab=recipe-designs"]').click());
    assert.equal(link('Recipe Designs').getAttribute('aria-current'), 'page');
    assert.equal(workspace('designs').querySelector('input').value, 'draft stays here');
    let modifiedClickWasPrevented;
    const stopNavigation = event => { if (event.ctrlKey) { modifiedClickWasPrevented = event.defaultPrevented; event.preventDefault(); } };
    document.addEventListener('click', stopNavigation);
    await React.act(async () => link('Recipe Designs').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })));
    document.removeEventListener('click', stopNavigation);
    assert.equal(modifiedClickWasPrevented, false, 'Ctrl-click must retain the browser new-tab action');
    await React.act(async () => link('Image to Image').click());
    assert.equal(visible('image-to-image'), true);
    assert.equal(window.location.search, '?tab=image-to-image');
    await React.act(async () => { window.history.back(); await settle(); });
    assert.equal(visible('designs'), true);
    assert.equal(workspace('designs').querySelector('input').value, 'draft stays here');
    await React.act(async () => link('2 in one image').click());
    assert.equal(visible('two-in-one'), true);
    assert.equal(window.location.search, '?tab=two-in-one');
    await React.act(async () => link('Recipe Intelligence').click());
    assert.equal(visible('intelligence'), true);
    assert.equal(window.location.search, '?tab=recipe-intelligence');
    assert.equal(workspace('designs').querySelector('input').value, 'draft stays here');
  } finally {
    await React.act(async () => root.unmount()); dom.window.close();
    for (const name of globals) {
      if (originals[name]) Object.defineProperty(globalThis, name, originals[name]);
      else delete globalThis[name];
    }
  }
});
