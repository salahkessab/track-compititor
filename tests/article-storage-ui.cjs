const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{JSDOM}=require('jsdom');
const {ArticleStorage}=require('./helpers/load-component.cjs')('ArticleStorage');
test('combined stored count, explicit confirmation, cancellation and successful empty state',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://workspace.example/'}),calls=[];
 let summary={total:9,recipes:8,decor:1,active:6,archived:3},cleared=0,offline=false;
 const capacity=()=>({status:'available',totalBytes:20000000000,usedBytes:summary.total?19000000000:4000000000,freeBytes:summary.total?1000000000:16000000000,usedPercent:summary.total?95:20});
 const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true,
 fetch:async(url,init={})=>{calls.push({url,init});if(offline)throw Error('Network offline');if(init.method==='DELETE'){assert.deepEqual(JSON.parse(init.body),{confirmed:true,revision:'reviewed-version'});assert.equal(init.headers['X-Recipe-Intelligence'],'1');summary={total:0,recipes:0,decor:0,active:0,archived:0};return Response.json({...summary,deleted:true});}return Response.json(url.endsWith('/preview')?{...summary,revision:'reviewed-version',fileCount:400,bytes:600000000}:{...summary,storage:capacity()});}};
 const saved=Object.fromEntries(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const[k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 const root=require('react-dom/client').createRoot(document.getElementById('root'));
 t.after(async()=>{await React.act(async()=>root.unmount());dom.window.close();for(const k of Object.keys(globals))if(saved[k])Object.defineProperty(globalThis,k,saved[k]);else delete globalThis[k];});
 window.addEventListener('article-library-cleared',()=>cleared++);
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 const click=async text=>{const b=button(text);assert.ok(b,text);assert.equal(b.disabled,false,text);await React.act(async()=>b.click());};
 await React.act(async()=>root.render(React.createElement(ArticleStorage)));
 assert.match(document.body.textContent,/Stored articles 9/);assert.match(document.body.textContent,/8 recipes · 1 decor · 6 active · 3 archived/);
 assert.equal(document.querySelector('[role=meter]').getAttribute('aria-valuenow'),'95');assert.match(document.body.textContent,/1.0 GB free/);assert.match(document.body.textContent,/Storage almost full/);
 await click('Delete all articles');assert.ok(document.querySelector('[role=dialog]'));assert.equal(button('Delete all permanently').disabled,true);
 assert.match(document.body.textContent,/Posts and media already sent to WordPress are not deleted/);
 await click('Keep my articles');assert.equal(document.querySelector('[role=dialog]'),null);assert.equal(calls.filter(c=>c.init.method==='DELETE').length,0);
 await click('Delete all articles');await React.act(async()=>document.querySelector('input[type=checkbox]').click());await click('Delete all permanently');
 assert.equal(calls.filter(c=>c.init.method==='DELETE').length,1);assert.equal(cleared,1);assert.equal(document.querySelector('[role=dialog]'),null);assert.match(document.body.textContent,/Stored articles 0/);assert.equal(button('Delete all articles').disabled,true);
 assert.equal(document.querySelector('[role=meter]').getAttribute('aria-valuenow'),'20');assert.match(document.body.textContent,/16.0 GB free/);assert.doesNotMatch(document.body.textContent,/Storage almost full/);
 offline=true;await React.act(async()=>window.dispatchEvent(new Event('article-library-cleared')));
 assert.equal(document.querySelector('[role=meter]'),null);assert.match(document.body.textContent,/temporarily unavailable/);
 offline=false;await React.act(async()=>window.dispatchEvent(new Event('article-library-cleared')));
 assert.equal(document.querySelector('[role=meter]').getAttribute('aria-valuenow'),'20');assert.equal(calls.filter(c=>c.init.method==='DELETE').length,1);
});
