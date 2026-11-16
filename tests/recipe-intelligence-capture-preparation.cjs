const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{JSDOM}=require('jsdom');
const {contentFixture}=require('./helpers/content-fixtures.cjs');
const {ImportStore}=require('../.intelligence-build/lib/recipe-intelligence/imports.js');
const {beginBrowserCapture}=require('../.intelligence-build/lib/recipe-intelligence/browserCapture.js');
const {DecorStore}=require('../.intelligence-build/lib/recipe-intelligence/decor.js');
const folder=path.join(__dirname,'../extensions/recipe-intelligence-capture');
const paragraph='Layer warm oak with soft linen, and keep a clear path between the bedroom door and the window. '.repeat(4);
function page(t,html){const dom=new JSDOM(html,{url:'https://decor.example/bedroom',runScripts:'outside-only'});t.after(()=>dom.window.close());dom.window.eval(fs.readFileSync(path.join(folder,'page-tools.js'),'utf8'));return dom.window;}
test('verification pages are blocked while real articles discussing Cloudflare remain readable',t=>{
  for(const html of ['<title>Just a moment...</title><main>Verify you are human. Enable JavaScript and cookies to continue.</main>','<title>Access denied</title><div id="challenge-form">Please wait</div>']){
    const w=page(t,html);assert.equal(w.RecipeCapturePage.inspect().blocked,true);
    assert.equal(w.eval(fs.readFileSync(path.join(folder,'content.js'),'utf8')).blocked,true);
  }
  const w=page(t,`<title>Cloudflare explained</title><article><h1>How to verify you are human</h1><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p></article><iframe src="https://challenges.cloudflare.com/turnstile"></iframe>`);
  assert.equal(w.RecipeCapturePage.inspect().blocked,false);
});
function scrollable(w,{growing=false}={}){
  let y=135,time=0;const positions=[];
  Object.defineProperty(w,'scrollY',{get:()=>y});Object.defineProperty(w,'innerHeight',{value:800});
  Object.defineProperty(w.document.documentElement,'scrollHeight',{get:()=>growing?1e8:2400});
  w.document.querySelector('article').getBoundingClientRect=()=>({top:-y,bottom:(growing?1e8:2400)-y});
  w.scrollTo=o=>{y=o.top;positions.push(y);if(y>=600)w.document.querySelector('img').src='https://decor.example/loaded.jpg'};
  w.Date.now=()=>time;w.setTimeout=(fn,ms)=>{time+=ms;fn();return 1;};
  return positions;
}
test('bounded scrolling activates lazy images and restores the exact original position',async t=>{
  const w=page(t,`<article><h1>Bedroom</h1><p>${paragraph}</p><img data-src="/loaded.jpg"></article>`),positions=scrollable(w);
  const result=await w.RecipeCapturePage.prepare();
  assert.equal(result.blocked,false);assert.equal(result.loadingIncomplete,false);assert.ok(positions.some(y=>y>=600));assert.equal(positions.at(-1),135);
  assert.equal(w.document.querySelector('img').src,'https://decor.example/loaded.jpg');
});
test('endless page growth stops within the budget and explicitly reports incomplete loading',async t=>{
  const w=page(t,`<article><p>${paragraph}</p><img></article>`),positions=scrollable(w,{growing:true});
  const result=await w.RecipeCapturePage.prepare();assert.equal(result.loadingIncomplete,true);assert.ok(positions.length<=73);assert.equal(positions.at(-1),135);
});
test('capture discovers past 24 photos and reports its 80-photo safety limit',t=>{
  for(const count of [35,85]){
    const w=page(t,`<article><h1>Bedroom ideas</h1><p>${paragraph}</p>${Array.from({length:count},(_,i)=>`<figure><img src="/room-${i}.jpg"><figcaption>Room ${i}</figcaption></figure>`).join('')}</article>`);
    const result=w.eval(fs.readFileSync(path.join(folder,'content.js'),'utf8'));
    assert.equal(result.images.length,Math.min(count,80));assert.equal(result.discoveredPhotos,count);assert.equal(result.imageLimitReached,count>80);
    assert.equal(result.images.at(-1).caption,'Room '+(Math.min(count,80)-1));
  }
});
test('backend refuses challenge HTML and retains capture limitations and explicit missing-photo acceptance',async t=>{
  const f=await contentFixture(t),imports=new ImportStore(f.store),decor=new DecorStore(f.store);
  const blocked={captureId:randomUUID(),url:'https://decor.example/bedroom',html:'<title>Just a moment...</title><article><h1>Verify you are human</h1><p>'+('Enable JavaScript and cookies to continue. '.repeat(12))+'</p></article>'};
  assert.throws(()=>beginBrowserCapture(imports,blocked),/verification page/);assert.throws(()=>decor.beginBrowser(blocked),/verification page/);
  const input={captureId:randomUUID(),url:blocked.url,html:`<title>Bedroom ideas</title><article><h1>Bedroom ideas</h1><p>${paragraph.repeat(140)}</p></article>`,captureReport:{loadingIncomplete:true,imageLimitReached:true}};
  const captured=decor.beginBrowser(input);assert.equal(captured.captureWarnings.length,3);assert.equal(decor.get(input.captureId).source.text.length,40000);
  assert.throws(()=>decor.finishBrowser(input.captureId,{missingPhotos:2}),/Continue with saved/);
  assert.equal(decor.get(input.captureId).state,'capturing');assert.equal(decor.claim(),null);
  const done=decor.finishBrowser(input.captureId,{missingPhotos:2,acceptPartial:true,derivedPhotos:1});assert.equal(done.status,'ready');
  assert.ok(done.captureWarnings.some(s=>s.includes('continue without')));assert.ok(done.captureWarnings.some(s=>s.includes('displayed copies')));
  decor.finishBrowser(input.captureId,{missingPhotos:2,acceptPartial:true,derivedPhotos:1});assert.equal(decor.get(input.captureId).warnings.length,5);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM decor_calls').get().n,0);
});

test('decor keeps 35 browser reference candidates while paid selection still has its separate 12-photo limit',async t=>{
  const f=await contentFixture(t),decor=new DecorStore(f.store),id=randomUUID();
  decor.beginBrowser({captureId:id,url:'https://decor.example/bedroom',html:`<article><h1>Bedroom ideas</h1><p>${paragraph}</p></article>`});
  for(let i=0;i<35;i++){
    const bytes=await require('sharp')({create:{width:200,height:180,channels:3,background:{r:90+i,g:130,b:80}}}).png().toBuffer();
    await decor.uploadBrowser(id,bytes,`https://decor.example/photo-${i}.png`,`Room ${i}`);
  }
  const result=decor.finishBrowser(id,{});assert.equal(result.photos.length,35);assert.equal(result.uploadedUrls.length,35);
  assert.throws(()=>decor.select(id,{brief:'Warm oak',photos:result.photos.slice(0,13).map(p=>({id:p.id,group:'room-1'}))}),/up to 12/);
  assert.equal(decor.claim(),null);assert.equal(f.store.db.prepare('SELECT count(*) n FROM decor_calls').get().n,0);
});
