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

test('extension review link opens its decor article without any paid approval',async t=>{
  const id='c8411ee3-c45c-4ea0-a9d7-98becd9a76ae',calls=[];
  const job={id,state:'review',source:{title:'Captured bedroom guide',url:'https://decor.example/bedroom',text:'A bedroom guide'},brief:'Soft linen',warnings:[],photos:[],settings:{},actual:0,held:0};
  const ui=await setup(t,async(url,init={})=>{calls.push({url,init});return Response.json({jobs:[job],worker:{online:true}})});
  window.history.replaceState(null,'','/?tab=home-decor&decorId='+id);
  await React.act(async()=>ui.root.render(React.createElement(HomeDecor,{active:true})));
  assert.ok(document.querySelector('a[href="https://decor.example/bedroom"]'));
  assert.ok(document.body.textContent.includes('Imported article text'));
  assert.ok(calls.every(c=>!c.init.method||c.init.method==='GET'));
  assert.ok(!document.body.textContent.includes('Approve $'));
});

test('photo selection preserves section identities when the middle photo is unchecked',async t=>{
  const sections=['Seating','Storage','Window'].map((heading,i)=>({id:`source-section-${i+1}`,heading,paragraphs:[`${heading} paragraph.`]}));
  const job={id:'linked',state:'review',source:{title:'Room',text:'Room body',sections},brief:'Natural light',warnings:[],settings:{},photos:sections.map((s,i)=>({id:`photo-${i}`,caption:s.heading,group:'room',selected:true,sourceSectionId:s.id,originalUrl:`/source-${i}.png`}))};
  let selection;
  const ui=await setup(t,async(url,init={})=>{if(url.endsWith('/selection')){selection=JSON.parse(init.body);return Response.json(job);}return Response.json({jobs:[job],worker:{online:true}})});
  await React.act(async()=>ui.root.render(React.createElement(HomeDecor,{active:true})));await ui.click('Choose photos & estimate');
  assert.deepEqual([...document.querySelectorAll('select')].map(s=>s.value),sections.map(s=>s.id));
  await React.act(async()=>document.querySelectorAll('input[type=checkbox]')[1].click());await ui.click('Confirm 2 photos & show estimate');
  assert.deepEqual(selection.photos.map(p=>[p.id,p.sourceSectionId]),[['photo-0','source-section-1'],['photo-2','source-section-3']]);
  assert.equal(job.source.sections.length,3);assert.match(document.body.textContent,/headings and paragraphs stay/);
});

test('removing and restoring an article image uses the inclusion endpoint without modifying article prose or starting generation',async t=>{
  const article={title:'Room guide',introduction:'Keep this introduction.',sections:[{id:'window',heading:'Window light',paragraphs:['Keep the full paragraph.']}],imagePlans:[{id:'image',section:0,sectionId:'window',alt:'A window'}]};
  const original=JSON.stringify(article),calls=[];
  const job={id:'linked-ready',state:'completed',source:{title:'Room guide',text:'Source text'},article,photos:[{id:'image',caption:'Window',group:'room',selected:true,originalUrl:'/original.png'}]};
  const ui=await setup(t,async(url,init={})=>{calls.push({url,init});if(url.endsWith('/image-inclusion')){const data=JSON.parse(init.body);assert.equal(data.photoId,'image');job.photos[0].excluded=!data.included;return Response.json(job);}return Response.json({jobs:[job],worker:{online:true}})});
  await React.act(async()=>ui.root.render(React.createElement(HomeDecor,{active:true})));await ui.click('Open article & images');
  assert.match(document.body.textContent,/Linked heading: Window light/);await ui.click('Remove from article');
  assert.match(document.body.textContent,/heading and paragraphs are kept/);assert.equal(JSON.stringify(job.article),original);
  await ui.click('Restore image');assert.equal(job.photos[0].excluded,false);assert.equal(JSON.stringify(job.article),original);
  assert.deepEqual(calls.filter(c=>c.init.method==='POST').map(c=>JSON.parse(c.init.body).included),[false,true]);assert.ok(!calls.some(c=>/approve|generate/.test(c.url)));
});
