const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');

function component() {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/components/RecipeIntelligence.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  const scopedRequire = name => {
    if (name === './IntelligenceContent') {
      const childSource = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/components/IntelligenceContent.tsx'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
      const child = { exports: {} };
      new Function('require', 'module', 'exports', childSource)(id => {
        if (id === './RecipeImports' || id === './RecipeWordPress') {
          const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/components', id + '.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
          const imported = { exports: {} }; new Function('require','module','exports',code)(require,imported,imported.exports); return imported.exports;
        }
        return id === '../../lib/openaiImageSettings' ? require('../.test-build/openaiImageSettings.js') : id === '../../lib/recipe-intelligence/format' ? require('../.intelligence-build/lib/recipe-intelligence/format.js') : id === '../../lib/recipe-intelligence/textModels' ? require('../.intelligence-build/lib/recipe-intelligence/textModels.js') : require(id);
      }, child, child.exports);
      return child.exports;
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', source)(scopedRequire, mod, mod.exports);
  return mod.exports.RecipeIntelligence;
}
async function ui(t, fetcher, url) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: url || 'http://127.0.0.1:34567/?tab=recipe-intelligence' });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, fetch: fetcher };
  const originals = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = require('react-dom/client'); const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(async () => root.unmount()); dom.window.close();
    for (const key of Object.keys(values)) if (originals[key]) Object.defineProperty(globalThis, key, originals[key]); else delete globalThis[key];
  });
  return { dom, root, Component: component(), select: async (text, value) => {
    const target = [...document.querySelectorAll('select')].find(item => item.getAttribute('aria-label') === text || item.closest('label')?.textContent.startsWith(text));
    assert.ok(target, `Expected select: ${text}`); await React.act(async () => { target.value = value; target.dispatchEvent(new window.Event('change', { bubbles: true })); });
  }, click: async text => {
    const target = [...document.querySelectorAll('button,a,summary')].find(item => item.textContent === text);
    assert.ok(target, `Expected control: ${text}`); await React.act(async () => target.click());
  } };
}

test('inactive workspace makes no requests; hosted mode offers the local launcher without opening storage', async t => {
  const calls = [];
  const { root, Component } = await ui(t, async (url) => { calls.push(url); return Response.json({ enabled: false }); });
  await React.act(async () => root.render(React.createElement(Component, { active: false })));
  assert.equal(calls.length, 0);
  await React.act(async () => root.render(React.createElement(Component, { active: true })));
  assert.deepEqual(calls, ['/api/recipe-intelligence/capabilities']);
  assert.match(document.body.textContent, /Double-click Start Recipe Intelligence/);
});

test('Start a recipe shows four photos unchecked and saves only selected photos before a free estimate', async t => {
  const { DEFAULT_CONTENT_SETTINGS } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');
  const calls=[]; const imported={id:'import-ui',kind:'url',status:'ready',title:'Chili',revision:1,selection_confirmed:0,photos:Array.from({length:4},(_,i)=>({id:'p'+i,position:i,name:'Photo '+i,state:'ready',selected:0,width:1024,height:1536}))};
  const snapshot={sites:[],runs:[],worker:{online:true},settings:{root:'C:\\Recipes',timezone:'Africa/Casablanca'},contentSettings:DEFAULT_CONTENT_SETTINGS,imports:[imported],batches:[],reports:[]};
  const batch={id:'batch-ui',settings:DEFAULT_CONTENT_SETTINGS,status:'awaiting_cost_approval',created_at:'2026-11-10T12:00:00Z',limit_usd:0,quote:{createdAt:'ui-quote',estimated:.2,recommendedLimit:1,lines:[]},budget:{actual:0,held:0,uncertain:0},items:[],calls:[]};
  const fetcher=async(url,init={})=>{calls.push({url,init});if(url.endsWith('/capabilities'))return Response.json({enabled:true});if(url.endsWith('/snapshot'))return Response.json(snapshot);if(url.endsWith('/imports/import-ui'))return Response.json(imported);if(url.endsWith('/imports/import-ui/selection')){const {photoIds}=JSON.parse(init.body); imported.photos.forEach(p=>p.selected=Number(photoIds.includes(p.id)));imported.revision++;imported.selection_confirmed=1;return Response.json(imported);}if(url.endsWith('/imports/import-ui/estimate')&&init.method==='POST'){batch.settings=JSON.parse(init.body).settings;return Response.json(batch);}if(url.endsWith('/batches/batch-ui'))return Response.json(batch);throw new Error('Unexpected '+url);};
  const {root,Component,click}=await ui(t,fetcher,'http://127.0.0.1:34567/?tab=recipe-intelligence&view=start');
  await React.act(async()=>root.render(React.createElement(Component,{active:true})));
  assert.match(document.body.textContent,/Start a recipe/);
  const select=[...document.querySelectorAll('select')].find(s=>s.parentElement.textContent.startsWith('Saved preparations'));
  await React.act(async()=>{select.value='import-ui';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  const region=document.querySelector('[aria-label="Photo selection"]');assert.ok(region);const checkboxes=[...region.querySelectorAll('input[type=checkbox]')];assert.equal(checkboxes.length,4);assert.ok(checkboxes.every(c=>!c.checked));
  await React.act(async()=>{checkboxes[1].click();checkboxes[3].click();});await click('Save photo selection (2)');
  const selection=calls.find(c=>c.url.endsWith('/selection'));assert.deepEqual(JSON.parse(selection.init.body).photoIds,['p1','p3']);assert.ok(calls.every(c=>!c.url.includes('/approve')&&!c.url.includes('openai.com')));
  const advanced = [...document.querySelectorAll('summary')].find(s => s.textContent === 'Advanced options').parentElement;
  assert.equal(advanced.open, false);
  const modes = [...document.querySelectorAll('select')].find(s => s.closest('label')?.textContent.startsWith('Automation'));
  assert.deepEqual([...modes.options].map(o => o.value), ['full', 'before_articles', 'before_images']);
  assert.equal(modes.closest('details').querySelector('summary').textContent, 'Article and image options');
  assert.equal(modes.closest('details').open, false);
  await click('Photo colors');
  assert.match(document.body.textContent,/Cookware or bowl color/);assert.match(document.body.textContent,/Spoon or utensil color/);await click('Reset photo palette');
  const color=label=>[...document.querySelectorAll('input[type=color]')].find(e=>e.parentElement.textContent.startsWith(label));
  const setColor=async(label,value)=>{const control=color(label);assert.ok(control);await React.act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(control,value);control.dispatchEvent(new window.Event('input',{bubbles:true}));control.dispatchEvent(new window.Event('change',{bubbles:true}));});};
  assert.equal(color('Spoon or utensil color').value,'#5c3a2e');
  await setColor('Spoon or utensil color','#3a705e');await setColor('Cookware or bowl color','#112233');await setColor('Surrounding surface color','#ccbbaa');
  await click('Prepare job estimate');const creation=calls.find(c=>c.url.endsWith('/imports/import-ui/estimate')&&c.init.method==='POST');
  assert.deepEqual(JSON.parse(creation.init.body).settings.palette,{cookware:'#112233',surface:'#ccbbaa',utensil:'#3a705e'});
  assert.ok(calls.every(c=>!c.url.includes('/approve')&&!c.url.includes('openai.com')));
});

test('launcher session is established and removed from the URL; archive waits for confirmation', async t => {
  let archived = false; const calls = [];
  const site = { id: 'site-1', name: 'Food', url: 'https://food.example/', status: 'active', urls: 3000, sources: [], last_scan_at: null, last_success_at: null, baseline_completed_at: null };
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/capabilities')) return Response.json({ enabled: true });
    if (url.endsWith('/session')) return Response.json({ connected: true });
    if (url.endsWith('/sites/site-1')) { archived = true; return Response.json({ archived: true }); }
    if (url.endsWith('/snapshot')) return Response.json({ sites: archived ? [] : [site], runs: [], worker: { online: true }, settings: { root: 'C:\\Selected recipe folder', timezone: 'Africa/Casablanca' } });
    throw new Error(`Unexpected request ${url}`);
  };
  const { root, Component, click } = await ui(t, fetcher, 'http://127.0.0.1:34567/?tab=recipe-intelligence&view=websites#ri-token=test-session');
  await React.act(async () => root.render(React.createElement(Component, { active: true })));
  assert.equal(window.location.hash, '');
  assert.equal(calls.find(call => call.url.endsWith('/session')).init.headers['X-RI-Key'], 'test-session');
  assert.ok(document.body.textContent.includes(`${(3000).toLocaleString()} discovered URLs`));
  assert.match(document.body.textContent, /Find recipes to choose a publication date/);
  assert.deepEqual([...document.querySelectorAll('nav[aria-label="Recipe Intelligence navigation"] a')].map(a => a.textContent), ['Use a recipe URL', 'My articles', 'Tracked websites', 'Find recipes', 'Settings']);
  assert.ok(![...document.querySelectorAll('button')].some(b => b.textContent === 'Refresh'));
  await click('Website details and actions');
  await click('Remove'); assert.ok(document.querySelector('[role="dialog"]'));
  assert.equal(archived, false); await click('Keep website'); assert.equal(archived, false);
  await click('Remove'); await click('Remove website'); assert.equal(archived, true);
  assert.equal(JSON.parse(calls.find(call => call.init.method === 'DELETE').init.body).confirmed, true);
  await click('Settings'); assert.match(window.location.search, /view=settings/);
  assert.match(document.body.textContent, /C:\\Selected recipe folder/);
});

test('report selection preserves per-recipe basis and presents a concrete batch quote before approval', async t => {
  const settings = require('../.intelligence-build/lib/recipe-intelligence/settings.js').DEFAULT_CONTENT_SETTINGS;
  const calls = []; let batchCreated = false, approved = false;
  const report = { id: 'r1', title: '2020-01-01 to 2020-01-03', status: 'running', processing: 'Processing available sources', matches: 1, stats: { processed: 1, remaining: 99, errors: 0 }, coverage: ['Incomplete coverage'], errors: [], rows: [{ id: 1, title: 'Carrot soup', canonical_url: 'https://food.example/soup', publication: { raw: '2020-01-02', precision: 'date' }, verification_reason: 'Recipe publication evidence', site_name: 'Food' }] };
  const batch = { id: 'b1', settings, status: 'awaiting_cost_approval', created_at: '2026-11-10T12:00:00Z', limit_usd: 0, quote: { createdAt: 'quote-v1', estimated: .2, recommendedLimit: 1, explanation: 'No paid work before approval.', lines: [{kind:'article',estimated:.2,reservation:1}] }, budget: { actual: 0, held: 0, uncertain: 0 }, items: [], calls: [] };
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/capabilities')) return Response.json({ enabled: true });
    if (url.endsWith('/snapshot')) return Response.json({ sites: [], runs: [], settings: { root: 'C:\\RecipeAutomation', timezone: 'Africa/Casablanca' }, contentSettings: settings, worker: { online: true }, reports: [{ ...report, rows: undefined }], batches: batchCreated ? [{ id: 'b1', created_at: batch.created_at, count: 1, completed: 0, status: approved ? 'running' : 'awaiting_cost_approval' }] : [] });
    if (url.includes('/reports/r1')) return Response.json(report);
    if (url.endsWith('/batches') && init.method === 'POST') { batchCreated = true; return Response.json(batch); }
    if (url.endsWith('/batches/b1/approve')) { approved = true; return Response.json({ approved: true }); }
    if (url.endsWith('/batches/b1')) return Response.json({ ...batch, status: approved ? 'running' : batch.status });
    if (url.endsWith('/model-check')) return Response.json({ configured: true, checks: [] });
    throw new Error('Unexpected UI route: ' + url);
  };
  const { root, Component, click, select } = await ui(t, fetcher, 'http://127.0.0.1:34567/?tab=recipe-intelligence&view=reports');
  await React.act(async () => root.render(React.createElement(Component, { active: true })));
  await select('Saved reports', 'r1');
  assert.match(document.body.textContent, /99 pending/); assert.match(document.body.textContent, /Incomplete coverage/);
  await React.act(async () => document.querySelector('input[aria-label="Select Carrot soup"]').click());
  const basis = document.querySelector('select[aria-label="Basis for Carrot soup"]');
  await React.act(async () => { basis.value = 'best_complete'; basis.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await click('Advanced options');
  const writingModel = [...document.querySelectorAll('label')].find(label => label.textContent.startsWith('Writing model')).querySelector('select');
  assert.deepEqual([...writingModel.options].map(option => option.value), ['gpt-5.4-mini', 'gpt-5.5']);
  await React.act(async () => { writingModel.value = 'gpt-5.5'; writingModel.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await click('Prepare batch estimate');
  const payload = JSON.parse(calls.find(c => c.url.endsWith('/batches') && c.init.method === 'POST').init.body);
  assert.equal(payload.selections[0].basis, 'best_complete'); assert.equal(payload.settings.mode, 'full'); assert.equal(approved, false);
  assert.equal(payload.settings.articleFormat, 'master_recipe_v1');
  assert.equal(payload.settings.textModel, 'gpt-5.5');
  assert.match(document.body.textContent, /Estimated total/); await click('Generate article + images'); assert.equal(approved, true);
  const costApproval = JSON.parse(calls.find(c => c.url.endsWith('/approve')).init.body); assert.equal(costApproval.limit, 1); assert.equal(costApproval.quoteVersion, 'quote-v1');
});

test('WordPress copy retains heading and list formatting without copying schema scripts or starting paid work', async t => {
  const settings = require('../.intelligence-build/lib/recipe-intelligence/settings.js').DEFAULT_CONTENT_SETTINGS;
  const calls = []; const copied = [];
  const created = '2026-11-10T12:00:00Z';
  const item = { id: 'i1', title: 'Carrot soup', state: 'completed', basis: 'original', warnings: [], stages: [], article: { wordCount: 1100, format: 'blog_1000_1200_v1' }, files: [{ id: 'html-1', name: 'article.html', media_type: 'text/html' }, { id: 'text-1', name: 'article.txt', media_type: 'text/plain' }] };
  const batch = { id: 'b1', settings, status: 'completed', created_at: created, approved_at: created, limit_usd: 1, quote: { estimated: .1, recommendedLimit: 1, explanation: '', lines: [{kind:'article',estimated:.1,reservation:1}] }, budget: { actual: .01, held: 0, uncertain: 0 }, items: [item], calls: [] };
  const html = '<!doctype html><html><body><article><h1><strong>Carrot soup</strong></h1><h2><strong>Introduction</strong></h2><p>Warm carrot soup.</p><h2><strong>How to make carrot soup</strong></h2><ol><li>Simmer the carrots.</li></ol></article><script type="application/ld+json">{"@type":"Recipe"}</script></body></html>';
  const plain = 'Carrot soup\n\nIntroduction\n\nWarm carrot soup.\n\nHow to make carrot soup\n\n1. Simmer the carrots.\n';
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/capabilities')) return Response.json({ enabled: true });
    if (url.endsWith('/snapshot')) return Response.json({ sites: [], runs: [], settings: { root: 'C:\\RecipeAutomation', timezone: 'Africa/Casablanca' }, contentSettings: settings, worker: { online: true }, batches: [{ id: 'b1', created_at: created, count: 1, completed: 1, status: 'completed' }] });
    if (url.endsWith('/batches/b1')) return Response.json(batch);
    if (url.endsWith('/artifacts/html-1')) return new Response(html);
    if (url.endsWith('/artifacts/text-1')) return new Response(plain);
    throw new Error('Unexpected copy request: ' + url);
  };
  const { root, Component, click, select } = await ui(t, fetcher, 'http://127.0.0.1:34567/?tab=recipe-intelligence&view=batches');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: class { constructor(data) { this.data = data; } } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async values => copied.push(...values) } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'ClipboardItem', original); else delete globalThis.ClipboardItem; });
  await React.act(async () => root.render(React.createElement(Component, { active: true })));
  await select('Saved work', 'b1');
  assert.ok(document.querySelector('[aria-label="Budget approval"]').closest('details'));
  assert.equal(document.querySelector('[aria-label="Budget approval"]').closest('details').open, false);
  await click('Preview article');
  assert.ok(document.querySelector('[role="dialog"][aria-label="Artifact preview"] iframe[sandbox=""]'));
  await click('Close preview');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(document.body.textContent.includes(`${(1100).toLocaleString()} words`));
  await click('Copy for WordPress');
  assert.equal(copied.length, 1);
  const rich = await copied[0].data['text/html'].text();
  assert.match(rich, /<h2><strong>Introduction<\/strong><\/h2>/);
  assert.match(rich, /<ol><li>Simmer the carrots\.<\/li><\/ol>/);
  assert.doesNotMatch(rich, /<script|application\/ld\+json|@type/);
  assert.equal(await copied[0].data['text/plain'].text(), plain);
  assert.match(document.body.textContent, /Article copied with bold headings and lists/);
  assert.ok(calls.every(c => !c.init.method || c.init.method === 'GET'));
});

test('date shortcuts use the reporting day without starting scans or paid work', async t => {
  const settings = require('../.intelligence-build/lib/recipe-intelligence/settings.js').DEFAULT_CONTENT_SETTINGS;
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-11-09T23:30:00Z'])); } static now() { return new NativeDate('2026-11-09T23:30:00Z').getTime(); } };
  t.after(() => { globalThis.Date = NativeDate; });
  const calls = [];
  const snapshot = { sites: [{ id: 'active', name: 'Active site', status: 'active', urls: 1 }, { id: 'paused', name: 'Paused site', status: 'paused', urls: 1 }], runs: [], worker: { online: true }, settings: { root: 'C:\\Recipes', timezone: 'Etc/GMT-1' }, contentSettings: settings, reports: [] };
  const { root, Component, click } = await ui(t, async (url, init = {}) => { calls.push({ url, init }); if (url.endsWith('/capabilities')) return Response.json({ enabled: true }); if (url.endsWith('/snapshot')) return Response.json(snapshot); throw new Error('Unexpected request: ' + url); }, 'http://127.0.0.1:34567/?tab=recipe-intelligence&view=reports');
  await React.act(async () => root.render(React.createElement(Component, { active: true })));
  const range = () => [...document.querySelectorAll('input[type=date]')].map(e => e.value);
  assert.deepEqual(range(), ['2026-11-04', '2026-11-10']);
  await click('Today'); assert.deepEqual(range(), ['2026-11-10', '2026-11-10']);
  await click('Last 30 days'); assert.deepEqual(range(), ['2026-10-12', '2026-11-10']);
  const sites = [...document.querySelectorAll('input[type=checkbox]')];
  assert.equal(sites[0].checked, true); assert.equal(sites[1].checked, false); assert.equal(sites[1].disabled, true);
  assert.ok(calls.every(c => !c.init.method || c.init.method === 'GET'));
});

test('results prioritize article actions, show edited photos only, and keep failures actionable', async t => {
  const settings = require('../.intelligence-build/lib/recipe-intelligence/settings.js').DEFAULT_CONTENT_SETTINGS;
  const item = { id: 'i-gallery', import_id: 'import-1', title: 'Chili', state: 'partial', basis: 'original', warnings: [],
    article: { wordCount: 1100 },
    photos: [{ id: 'cp1', reference_id: 'p1', position: 0, state: 'done' }, { id: 'cp2', reference_id: 'p2', position: 1, state: 'failed' }, { id: 'cp3', reference_id: 'p3', position: 2, state: 'uncertain' }],
    stages: [{ id: 1, kind: 'article', state: 'done' }, { id: 2, kind: 'photo:p1', state: 'done' }, { id: 3, kind: 'photo:p2', state: 'failed', error: 'File save failed.' }, { id: 4, kind: 'photo:p3', state: 'uncertain', error: 'Provider outcome unknown.' }],
    files: [{ id: 'article', name: 'article.html', media_type: 'text/html' }, { id: 'jpg1', name: 'photo-p1.jpg', media_type: 'image/jpeg' }, { id: 'png1', name: 'photo-p1.png', media_type: 'image/png' }, { id: 'meta', name: 'recipe.json', media_type: 'application/json' }] };
  const batch = { id: 'b-gallery', settings, status: 'partial', approved_at: '2026-11-10', limit_usd: 1, quote: { estimated: .3, recommendedLimit: 1, lines: [] }, budget: { actual: .1, held: .1, uncertain: 1 }, items: [item], calls: [] };
  const snapshot = { sites: [], runs: [], worker: { online: true }, settings: { root: 'C:\\Recipes', timezone: 'Africa/Casablanca' }, contentSettings: settings, batches: [{ id: batch.id, title: 'Chili', count: 1, status: 'partial', created_at: '2026-11-10T12:00:00Z' }] };
  const calls = [];
  const { root, Component, click, select } = await ui(t, async (url, init = {}) => { calls.push({ url, init }); if (url.endsWith('/capabilities')) return Response.json({ enabled: true }); if (url.endsWith('/snapshot')) return Response.json(snapshot); if (url.endsWith('/batches/b-gallery')) return Response.json(batch); if (url.endsWith('/items/i-gallery/retry')) return Response.json({ ok: true }); throw new Error('Unexpected request: ' + url); }, 'http://127.0.0.1:34567/?tab=recipe-intelligence&view=batches');
  await React.act(async () => root.render(React.createElement(Component, { active: true })));
  await select('Saved work', batch.id);
  const actions = document.querySelector('[aria-label="Article and download actions"]'), gallery = document.querySelector('[aria-label="Edited photo gallery"]');
  assert.ok(actions.compareDocumentPosition(gallery) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(gallery.querySelectorAll('img').length, 1);
  assert.ok(gallery.querySelector('img').src.includes('/artifacts/jpg1?preview=1'));
  assert.equal(document.querySelectorAll('img[src*="/references/"]').length, 0);
  assert.equal(document.querySelectorAll('a[href$="/artifacts/jpg1"]').length, 1);
  assert.equal(document.querySelectorAll('a[href$="/items/i-gallery/zip"]').length, 1);
  const comparison = [...gallery.querySelectorAll('input')].find(e => e.type === 'checkbox');
  await React.act(async () => comparison.click());
  assert.equal(gallery.querySelectorAll('img[src*="/references/"]').length, 3);
  assert.match(gallery.textContent, /Original · reference only/);
  await React.act(async () => comparison.click());
  assert.equal(gallery.querySelectorAll('img[src*="/references/"]').length, 0);
  const repair = [...document.querySelectorAll('summary')].find(e => e.textContent === 'Processing details and repair').parentElement;
  assert.equal(repair.open, false);
  const retry = [...document.querySelectorAll('button')].find(e => e.textContent === 'Retry Edit photo 2');
  assert.ok(retry); assert.equal(retry.closest('details'), null);
  assert.ok(![...document.querySelectorAll('button')].some(e => e.textContent === 'Retry Edit photo 3'));
  assert.match(document.body.textContent, /This request will not repeat automatically/);
  await click('Retry Edit photo 2');
  assert.deepEqual(calls.filter(c => c.init.method === 'POST').map(c => ({ url: c.url, body: JSON.parse(c.init.body) })), [{ url: '/api/recipe-intelligence/items/i-gallery/retry', body: { kind: 'photo:p2' } }]);
});


test('a saved blocked recipe shows its source error instead of a zero-price Generate action', async t => {
  const { DEFAULT_CONTENT_SETTINGS } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');
  const item={id:'blocked-item',title:'Blocked recipe',import_id:'blocked-import',state:'photo_selection',error:'This website blocks automatic access. Paste the recipe text below or use another recipe URL.',source:null,warnings:[],stages:[],files:[],photos:[]};
  const batch={id:'blocked-batch',status:'awaiting_cost_approval',settings:DEFAULT_CONTENT_SETTINGS,quote:{estimated:0,recommendedLimit:0,pending:1,lines:[]},budget:{actual:0,held:0,uncertain:0},items:[item],calls:[]};
  const calls=[];
  const {root,Component,select}=await ui(t,async(url,init={})=>{calls.push({url,init});if(url.endsWith('/capabilities'))return Response.json({enabled:true});if(url.endsWith('/snapshot'))return Response.json({sites:[],runs:[],worker:{online:true},settings:{root:'E:\\Recipes',timezone:'Africa/Casablanca'},contentSettings:DEFAULT_CONTENT_SETTINGS,batches:[{id:batch.id,title:item.title,created_at:'2026-11-11T12:00:00Z',count:1,status:batch.status}],imports:[]});if(url.endsWith('/batches/blocked-batch'))return Response.json(batch);if(url.endsWith('/imports/blocked-import'))return Response.json({id:'blocked-import',title:'Blocked recipe',status:'failed',error:item.error,revision:0,photos:[]});throw new Error(url);},'http://127.0.0.1:34567/?tab=recipe-intelligence&view=batches');
  await React.act(async()=>root.render(React.createElement(Component,{active:true})));
  await select('Saved work',batch.id);
  assert.match(document.body.textContent,/Not available yet/);
  assert.match(document.body.textContent,/blocks automatic access/);
  assert.equal(document.querySelector('[aria-label="Budget approval"]'),null);
  assert.ok(![...document.querySelectorAll('button')].some(b=>/Generate article|Approve.*limit/.test(b.textContent)));
  assert.ok(calls.every(c=>!c.url.includes('/approve')));
});

test('extension estimate link opens the selected draft with its spending limit without approving it',async t=>{
  const {DEFAULT_CONTENT_SETTINGS}=require('../.intelligence-build/lib/recipe-intelligence/settings.js');
  const id='d9913fb3-cfa3-4d08-9840-3efc042ce14a';
  const batch={id,status:'awaiting_cost_approval',settings:DEFAULT_CONTENT_SETTINGS,quote:{estimated:.71,recommendedLimit:.9,pending:0,lines:[{kind:'article',estimated:.71}]},budget:{actual:0,held:0,uncertain:0},items:[],calls:[]};
  const calls=[];
  const {root,Component}=await ui(t,async(url,init={})=>{calls.push({url,init});if(url.endsWith('/capabilities'))return Response.json({enabled:true});if(url.endsWith('/snapshot'))return Response.json({sites:[],runs:[],worker:{online:true},settings:{root:'E:\\Recipes',timezone:'Africa/Casablanca'},contentSettings:DEFAULT_CONTENT_SETTINGS,batches:[{id,title:'Captured soup',created_at:'2026-11-11T12:00:00Z',count:1,status:batch.status}],imports:[]});if(url.endsWith(`/batches/${id}`))return Response.json(batch);throw new Error(url);},`http://127.0.0.1:34567/?tab=recipe-intelligence&view=batches&batchId=${id}`);
  await React.act(async()=>root.render(React.createElement(Component,{active:true})));
  assert.match(document.body.textContent,/\$0.7100/);
  assert.ok([...document.querySelectorAll('button')].some(b=>/Generate article/.test(b.textContent)));
  assert.ok(calls.every(c=>c.init.method!=='POST'));
});

test('uncertain article offers an explicit retry with the earlier charge reserved and no silent approval',async t=>{
  const {DEFAULT_CONTENT_SETTINGS}=require('../.intelligence-build/lib/recipe-intelligence/settings.js');
  const id='aac5fa0c-81eb-4ec1-919e-154051012ecd';
  const item={id:'uncertain-item',title:'Saved soup',state:'failed',source:null,files:[],photos:[],warnings:[],stages:[{id:4,kind:'article',state:'uncertain',error:'Connection failed'}]};
  const batch={id,status:'partial',approved_at:'2026-11-11T11:47:29Z',limit_usd:1.69,settings:DEFAULT_CONTENT_SETTINGS,quote:{estimated:.8266,recommendedLimit:1.69,pending:0,lines:[{kind:'article',estimated:.1}]},budget:{actual:0,held:.29375,uncertain:1,remaining:1.39625},items:[item],calls:[]};
  const calls=[];
  const {root,Component,click}=await ui(t,async(url,init={})=>{calls.push({url,init});if(url.endsWith('/capabilities'))return Response.json({enabled:true});if(url.endsWith('/snapshot'))return Response.json({sites:[],runs:[],worker:{online:true},settings:{root:'E:\\Recipes',timezone:'Africa/Casablanca'},contentSettings:DEFAULT_CONTENT_SETTINGS,batches:[{id,title:item.title,created_at:'2026-11-11T12:00:00Z',count:1,status:batch.status}],imports:[]});if(url.endsWith(`/batches/${id}`))return Response.json(batch);if(url.endsWith('/items/uncertain-item/retry'))return Response.json({queued:true});throw new Error(url);},`http://127.0.0.1:34567/?tab=recipe-intelligence&view=batches&batchId=${id}`);
  await React.act(async()=>root.render(React.createElement(Component,{active:true})));
  assert.match(document.body.textContent,/old charge stays unknown and reserved/);
  assert.match(document.body.textContent,/\$1\.6900 limit/);assert.match(document.body.textContent,/\$1\.3962 remains available/);
  assert.ok(calls.every(c=>c.init.method!=='POST'));
  await click('Retry article (possible extra charge)');
  const posts=calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(posts[0].init.body),{kind:'article',regenerate:true,retryUncertain:true});
  assert.ok(calls.every(c=>!c.url.includes('/resolve')&&!c.url.includes('/approve')));
});
