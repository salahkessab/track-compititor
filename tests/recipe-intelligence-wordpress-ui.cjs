const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const sites = ['first', 'second'].map((s, i) => ({ id: String(i + 1).repeat(32), siteUrl: `https://${s}.example/`, username: 'owner', displayName: 'Owner', mediaLibraryUrl: `https://${s}.example/wp-admin/upload.php` }));

async function setup(t) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://127.0.0.1:34567/' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, ClipboardItem: class { constructor(data) { this.data = data; } } };
  const originals = Object.fromEntries(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/components/RecipeWordPress.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} }; new Function('require','module','exports',code)(require,module,module.exports);
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); for (const k of Object.keys(globals)) if (originals[k]) Object.defineProperty(globalThis,k,originals[k]); else delete globalThis[k]; });
  const control = text => [...document.querySelectorAll('button')].find(e => e.textContent === text);
  const click = async text => { const button = control(text); assert.ok(button, text); await React.act(async () => button.click()); };
  const choose = async value => { const select = document.querySelector('select'); await React.act(async () => { select.value = value; select.dispatchEvent(new window.Event('change', { bubbles: true })); }); };
  return { root, ...module.exports, control, click, choose };
}

test('multi-site copy requires a destination and uploads only on click, then copies hosted URLs', async t => {
  const ui = await setup(t); const calls = []; const copied = []; let ready = false;
  Object.defineProperty(navigator, 'clipboard', { value: { write: async value => copied.push(value) }, configurable: true });
  const request = async (route, method = 'GET', body) => {
    calls.push({ route, method, body });
    if (method === 'POST') { ready = true; return { id: 9 }; }
    return { connectionId: sites[1].id, siteUrl: sites[1].siteUrl, documentHash: 'article-hash', images: [{ sha256: 'image-hash', name: 'featured.jpg', alt: 'Soup', state: ready ? 'ready' : 'pending' }], ready, html: ready ? '<article><h2>Ingredients</h2><img src="https://second.example/wp-content/uploads/soup.jpg"></article>' : null, text: 'Ingredients' };
  };
  await React.act(async () => ui.root.render(React.createElement(ui.WordPressCopy, { itemId: 'recipe', connections: sites, request })));
  assert.equal(document.querySelector('select').value, ''); assert.ok(ui.control('Upload images and copy').disabled); assert.equal(calls.length, 0);
  await ui.choose(sites[1].id); await ui.click('Upload images and copy');
  assert.equal(calls.filter(c => c.method === 'POST').length, 1); assert.equal(calls.find(c => c.method === 'POST').body.connectionId, sites[1].id);
  assert.ok(calls.filter(c => c.method === 'GET').every(c => c.route.includes(sites[1].id)));
  assert.equal(copied.length, 1); assert.match(await copied[0][0].data['text/html'].text(), /https:\/\/second.example/);
  assert.match(document.body.textContent, /images hosted on second.example/);
  await ui.click('Upload images and copy'); assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  await ui.choose(sites[0].id); assert.equal(ui.control('Copy uploaded article'), undefined);
});

test('an upload failure preserves successes, continues other images and copies only when all are hosted', async t => {
  const ui = await setup(t); const hosted = new Set(); let fail = true; const posts = []; const copied = [];
  Object.defineProperty(navigator, 'clipboard', { value: { write: async value => copied.push(value) }, configurable: true });
  const request = async (_route, method = 'GET', body) => {
    if (method === 'POST') { posts.push(body.sha256); if (body.sha256 === 'bad' && fail) throw new Error('Upload rejected.'); hosted.add(body.sha256); return {}; }
    return { documentHash: 'v1', siteUrl: sites[0].siteUrl, connectionId: sites[0].id, images: ['bad','good'].map(sha256 => ({ sha256, alt: sha256, state: hosted.has(sha256) ? 'ready' : 'pending' })), ready: hosted.size === 2, html: '<article>Recipe</article>', text: 'Recipe' };
  };
  await React.act(async () => ui.root.render(React.createElement(ui.WordPressCopy, { itemId: 'recipe', connections: [sites[0]], request })));
  await ui.click('Upload images and copy'); assert.deepEqual(posts, ['bad','good']); assert.equal(copied.length, 0); assert.match(document.querySelector('[role=alert]').textContent, /Upload rejected/);
  fail = false; await ui.click('Upload images and copy'); assert.deepEqual(posts, ['bad','good','bad']); assert.equal(copied.length, 1);
});

test('clipboard denial provides a fresh-click copy fallback without repeating uploads', async t => {
  const ui = await setup(t); let copies = 0; let requests = 0;
  Object.defineProperty(navigator, 'clipboard', { value: { write: async () => { copies++; if (copies === 1) throw new Error('Gesture expired'); } }, configurable: true });
  const request = async () => { requests++; return { documentHash: 'v1', siteUrl: sites[0].siteUrl, connectionId: sites[0].id, images: [], ready: true, html: '<article>Soup</article>', text: 'Soup' }; };
  await React.act(async () => ui.root.render(React.createElement(ui.WordPressCopy, { itemId: 'recipe', connections: [sites[0]], request })));
  await ui.click('Upload images and copy'); assert.match(document.body.textContent, /Click Copy uploaded article/); assert.ok(ui.control('Download WordPress HTML'));
  const before = requests; await ui.click('Copy uploaded article'); assert.equal(requests, before); assert.equal(copies, 2);
});

test('connection form accepts any site and clears its private password after submission', async t => {
  const ui = await setup(t); const calls = [];
  const request = async (route, method, data) => { calls.push({ route, method, data }); return {}; };
  await React.act(async () => ui.root.render(React.createElement(ui.WordPressConnections, { status: { connections: sites }, request, refresh: async () => {} })));
  assert.equal(document.querySelector('input[type=password]').type, 'password'); assert.equal(calls.length, 0);
  const set = async (label, value) => {
    const node = [...document.querySelectorAll('input')].find(n => n.closest('label').textContent.startsWith(label));
    await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(node,value); node.dispatchEvent(new window.Event('input',{bubbles:true})); node.dispatchEvent(new window.Event('change',{bubbles:true})); });
  };
  await set('WordPress website URL','https://third.example'); await set('WordPress username','third-owner'); await set('Application Password','abcdefghijklmnopqrstuvwx');
  await React.act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(calls[0].data.siteUrl, 'https://third.example'); assert.equal(calls[0].data.applicationPassword, 'abcdefghijklmnopqrstuvwx');
  assert.equal(document.querySelector('input[type=password]').value, ''); assert.equal(window.localStorage.length, 0); assert.doesNotMatch(document.body.textContent, /abcdefghijklmnopqrstuvwx/);
});

test('publishing requires a reviewed destination and explicit live choice, while draft is the default', async t => {
  const ui = await setup(t), calls = [];
  const request = async (route, method = 'GET', body) => {
    calls.push({ route, method, body });
    if (method === 'POST') return { postId: 7, status: body.status, editUrl: 'https://first.example/wp-admin/post.php?post=7', postUrl: 'https://first.example/soup' };
    return { title: 'Soup', siteUrl: sites[0].siteUrl, documentHash: 'hash', reviewHash: 'review', ready: true, images: [], profile: { ready: true, recipeCardLabel: 'WP Recipe Maker', canPublish: true } };
  };
  await React.act(async () => ui.root.render(React.createElement(ui.WordPressCopy, { itemId: 'recipe', connections: sites, request })));
  assert.ok(ui.control('Prepare WordPress post').disabled); assert.equal(ui.control('Publish live'), undefined);
  await ui.choose(sites[0].id); await ui.click('Prepare WordPress post');
  assert.match(document.body.textContent, /WP Recipe Maker/); assert.ok(ui.control('Publish live').disabled);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  await ui.click('Save draft'); assert.equal(calls.at(-1).body.status, 'draft'); assert.equal(calls.at(-1).body.confirmPublish, false);
  await React.act(async () => document.querySelector('input[type=checkbox]').click()); await ui.click('Publish live');
  assert.equal(calls.at(-1).body.status, 'publish'); assert.equal(calls.at(-1).body.confirmPublish, true); assert.equal(calls.at(-1).body.reviewHash, 'review');
  await ui.choose(sites[1].id); assert.equal(ui.control('Publish live'), undefined); assert.equal(ui.control('Save draft'), undefined);
});
