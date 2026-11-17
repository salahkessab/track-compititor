const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { contentFixture, html, recipeData } = require('./helpers/content-fixtures.cjs');
const { ImportStore } = require('../.intelligence-build/lib/recipe-intelligence/imports.js');
const { beginBrowserCapture, finishBrowserCapture } = require('../.intelligence-build/lib/recipe-intelligence/browserCapture.js');
const { prepareImportEstimate } = require('../.intelligence-build/lib/recipe-intelligence/referenceWorkflow.js');
const { publicImageUrl, fetchPhoto, appBridge } = require('../extensions/recipe-intelligence-capture/shared.js');
const extension = path.join(__dirname, '../extensions/recipe-intelligence-capture');
const recipeHtml = html(recipeData(), '').replace('</body>','<article><p>A warming carrot soup, made with carrots, water and salt.</p><h2>Storage</h2><p>Keep the cooked soup in a covered container in the refrigerator for up to three days.</p></article></body>');
const captureInput = (extra = {}) => ({captureId:randomUUID(),url:'https://food.example/blocked/',html:recipeHtml,...extra});

test('imports reject transparent and black loading placeholders but preserve readable dark photographs', async t => {
  const f=await contentFixture(t), imports=new ImportStore(f.store), row=beginBrowserCapture(imports,captureInput());
  const sharp=require('sharp');
  for(const background of [{r:0,g:0,b:0,alpha:1},{r:255,g:255,b:255,alpha:0}]) {
    const bytes=await sharp({create:{width:600,height:900,channels:4,background}}).png().toBuffer();
    await assert.rejects(imports.add(row.id,bytes,'Placeholder','https://cdn.example/blank.png'),/placeholder/);
  }
  const dark=await sharp({create:{width:600,height:900,channels:3,background:'#080808'}}).png().toBuffer();
  await imports.add(row.id,dark,'Dark photograph','https://cdn.example/dark.png');
  assert.equal(imports.detail(row.id).photos.length,1);
});

test('rendered fallback rejects unloaded data-src, transparent and black pixels, and accepts loaded photographs', () => {
  const dom=new JSDOM('<img>',{url:'https://food.example/',runScripts:'outside-only'}), w=dom.window;
  const img=w.document.querySelector('img'), url='https://cdn.example/photo.jpg';
  img.src='https://cdn.example/placeholder.png';img.dataset.src=url;
  for(const [key,value] of Object.entries({complete:true,naturalWidth:600,naturalHeight:900})) Object.defineProperty(img,key,{value});
  let pixel=[0,0,0,255];
  w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){},getImageData(){return {data:pixel};}});
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,cGhvdG8=';
  w.eval(fs.readFileSync(path.join(extension,'shared.js'),'utf8'));
  assert.equal(w.CaptureHelpers.renderedPhoto([url]),null);
  img.src=url;
  assert.equal(w.CaptureHelpers.renderedPhoto([url]),null);
  pixel=[255,255,255,0];assert.equal(w.CaptureHelpers.renderedPhoto([url]),null);
  pixel=[10,12,15,255];assert.equal(w.CaptureHelpers.renderedPhoto([url]),'cGhvdG8=');
  dom.window.close();
});

function capture(html) {
  const dom = new JSDOM(html,{url:'https://food.example/blocked/',runScripts:'outside-only'});
  dom.window.eval(fs.readFileSync(path.join(extension,'page-tools.js'),'utf8'));
  const result = dom.window.eval(fs.readFileSync(path.join(extension,'content.js'),'utf8'));
  dom.window.close();
  return JSON.parse(JSON.stringify(result));
}

test('Chrome capture preserves recipe facts and article context without scripts, forms or unrelated photos', () => {
  const result = capture(`<html><head><script type="application/ld+json">${JSON.stringify(recipeData({image:'https://cdn.example/soup.jpg',author:{email:'private@example.com'}}))}</script></head><body>
    <nav>Account secret</nav><article><h1>Carrot soup</h1><p>A warming carrot soup with carrots, water and salt.</p>
    <h2>Storage</h2><p>Keep the cooked soup in the refrigerator for up to three days.</p>
    <form><input value="secret"><textarea>Private draft</textarea></form><div hidden>Hidden private text</div><div style="display:none">Invisible text</div>
    <script>steal()</script><img src="https://cdn.example/soup-800x600.jpg" alt="Carrot soup"><img src="https://cdn.example/soup-300x200.jpg">
    <img src="https://cdn.example/author.jpg" alt="About Heather"><aside><img src="https://cdn.example/advert.jpg"></aside><div class="related-posts"><img src="https://cdn.example/other.jpg"></div>
    </article></body></html>`);
  assert.equal(result.images.length,1);
  assert.equal(result.title,'Carrot soup');
  assert.match(result.html,/recipeIngredient/); assert.match(result.html,/Storage/);
  assert.doesNotMatch(result.html,/secret|Private draft|steal|Invisible text|Hidden private text|private@example|<input|<form/);
  const markers=new JSDOM(result.html);const imageMarkers=[...markers.window.document.querySelectorAll('img')];
  assert.equal(imageMarkers.length,1);assert.deepEqual([...imageMarkers[0].attributes].map(a=>a.name),['src','alt']);
  assert.equal(imageMarkers[0].getAttribute('src'),result.images[0].url);markers.window.close();
  assert.doesNotMatch(result.text,/recipeIngredient|Account secret/);
});

test('capture excludes other-post image links even without descriptive classes, before the photo limit', () => {
  const recommendations = Array.from({length:30},(_,i)=>`<div class="css-${i}"><a href="/other-${i}/#recipe"><div><picture><img src="https://cdn.example/dip-${i}.jpg"></picture></div><h3>Suggested dip ${i}</h3></a></div>`).join('');
  const result = capture(`<article><h1>Chicken</h1><p>Cook the chicken.</p>${recommendations}
    <figure><img src="https://cdn.example/chicken.jpg"><figcaption>Finished chicken</figcaption></figure>
    <a href="#instructions"><img src="https://cdn.example/step-1.jpg"></a>
    <a href="/blocked?utm_source=newsletter"><img src="https://cdn.example/step-2.jpg"></a>
    <a href="https://cdn.example/step-3-full.avif"><img src="https://cdn.example/step-3.jpg"></a>
    <a href="/?p=another-post"><img src="https://cdn.example/another-post.jpg"></a>
    <p>Serve with <a href="/other-side-dish/">a side salad</a>.</p></article>`);
  assert.deepEqual(result.images.map(i=>new URL(i.url).pathname),['/chicken.jpg','/step-1.jpg','/step-2.jpg','/step-3.jpg']);
  assert.doesNotMatch(result.text,/Suggested dip/);
  assert.match(result.text,/Serve with\s+a side salad/,'Ordinary article links remain readable');
  assert.equal(result.images[0].caption,'Finished chicken');
});

test('capture excludes deeply nested recommendation regions identified by class, ID, label or site data', () => {
  const wrappers = ['class="recommendedPosts"','id="related-posts-7"','aria-label="More recipes"','data-nitrous-content-id="recirculation_unit_like_this_recipe"','data-block="transporter"','data-component="ContentRecommendations"'];
  const cards = wrappers.map((attributes,i)=>`<section ${attributes}><div><div><div><div><div><img src="https://cdn.example/unrelated-${i}.jpg"><p>Unrelated suggestion ${i}</p></div></div></div></div></div></section>`).join('');
  const result=capture(`<article><h1>Chicken</h1><div class="recipe-card"><img src="https://cdn.example/chicken.jpg"><p>Chicken cooking instructions.</p></div>${cards}</article>`);
  assert.deepEqual(result.images.map(i=>i.url),['https://cdn.example/chicken.jpg']);
  assert.doesNotMatch(result.text,/Unrelated suggestion/);
  assert.match(result.text,/Chicken cooking instructions/);
});

test('capture uses the recipe article container instead of sibling recommendations in main', () => {
  const result=capture(`<main><h1>Chicken</h1><div class="article-container"><p>The chicken recipe.</p><img src="https://cdn.example/chicken.jpg"></div>
    <section><h2>Recommendations</h2><img src="https://cdn.example/other.jpg"><p>Other recipe text.</p></section></main>`);
  assert.deepEqual(result.images.map(i=>i.url),['https://cdn.example/chicken.jpg']);
  assert.doesNotMatch(result.text,/Other recipe text/);
  const nested=capture(`<main><h1>Chicken</h1><p>The chicken recipe.</p><img src="https://cdn.example/chicken.jpg">
    <section data-component="ContentRecommendations"><article><h2>Other recipe</h2><img src="https://cdn.example/other.jpg"><p>Other recipe text.</p></article></section></main>`);
  assert.deepEqual(nested.images.map(i=>i.url),['https://cdn.example/chicken.jpg']);
  assert.doesNotMatch(nested.text,/Other recipe text/);
});

test('capture excludes app badges and author avatars inside the article', () => {
  const result=capture(`<article><h1>Chicken</h1><img src="https://cdn.example/chicken.jpg" alt="Chicken on a plate">
    <img src="https://cdn.example/badge.png" alt="Get it on Google Play"><img src="https://cdn.example/badge2.png" alt="Download on the App Store">
    <img src="https://cdn.example/person.jpg" class="authorAvatar"><img src="https://cdn.example/brand.png" alt="Brand logo"></article>`);
  assert.deepEqual(result.images.map(i=>i.url),['https://cdn.example/chicken.jpg']);
});

test('capture preserves comma-containing CDN srcsets, picture sources and lazy photos without inventing URLs', () => {
  const result=capture(`<article><h1>Chicken</h1>
    <img src="https://cdn.example/chicken.jpg?resize=320:*" srcset="https://cdn.example/chicken.jpg?crop=1xw:1xh;center,top&amp;resize=480:* 480w, https://cdn.example/chicken.jpg?crop=1xw:1xh;center,top&amp;resize=1200:* 1200w">
    <picture><source srcset="https://cdn.example/steps.avif?crop=0.250xw,0&amp;resize=980:* 980w"><img src="https://cdn.example/steps.jpg"></picture>
    <img data-src="/lazy-chicken.jpg" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP">
    <img><img src="https://cdn.example/small.jpg" srcset="https://cdn.example/small.jpg, https://cdn.example/large.jpg 2x">
    <div hidden><img src="https://cdn.example/hidden.jpg"></div></article>`);
  assert.deepEqual(result.images.map(i=>i.url),[
    'https://cdn.example/chicken.jpg?crop=1xw:1xh;center,top&resize=1200:*',
    'https://cdn.example/steps.avif?crop=0.250xw,0&resize=980:*',
    'https://food.example/lazy-chicken.jpg','https://cdn.example/large.jpg'
  ]);
  assert.deepEqual(result.images[1].alternatives,['https://cdn.example/steps.jpg']);
});

test('capture deduplicates metadata crop variants and rejects images belonging to another recipe', () => {
  const metadata=[recipeData({name:'Chicken',url:'https://food.example/blocked/',image:['https://cdn.example/chicken.jpg?crop=1,1&resize=1200:*','https://cdn.example/chicken.jpg?crop=0.5,1&resize=600:*']}),
    recipeData({name:'Dip',image:'https://cdn.example/dip.jpg'}),
    recipeData({name:'Chicken',url:'https://food.example/another-chicken/',image:'https://cdn.example/other-chicken.jpg'}),
    {'@type':'Recipe',image:'https://cdn.example/unnamed.jpg'}];
  const result=capture(`<head><script type="application/ld+json">${JSON.stringify(metadata)}</script></head><body><article><h1>Chicken</h1><p>Cook the chicken.</p></article></body>`);
  assert.equal(result.images.length,1);
  assert.equal(new URL(result.images[0].url).pathname,'/chicken.jpg');
});

test('browser import stages safely, survives worker recovery, deduplicates retries and quotes without fetching source or paying', async t => {
  const f = await contentFixture(t), imports = new ImportStore(f.store), input = captureInput();
  let imported = beginBrowserCapture(imports,input);
  assert.equal(imported.kind,'browser'); assert.equal(imported.status,'capturing');
  assert.deepEqual(imported.recipe.ingredients,recipeData().recipeIngredient);
  assert.throws(()=>prepareImportEstimate(f.batches,imported.id,f.defaults),/Still reading/);
  assert.throws(()=>f.batches.create([{importId:imported.id}],f.defaults),/Finish the browser import/);
  imports.recover(); assert.equal(imports.get(imported.id).status,'capturing'); assert.ok(!imports.claim(f.owner));
  assert.equal(beginBrowserCapture(imports,input).id,imported.id);
  assert.throws(()=>beginBrowserCapture(imports,{...input,url:'https://other.example/a'}),/different content/);
  const bytes = fs.readFileSync(path.join(__dirname,'fixtures/approved-recipe-photos/08-skillet.jpg'));
  await imports.add(imported.id,bytes,'Photo 1','https://cdn.example/soup.jpg');
  await imports.add(imported.id,bytes,'Retry','https://cdn.example/soup.jpg');
  assert.throws(()=>finishBrowserCapture(imports,imported.id,{missingPhotos:1}),/Continue with saved/);
  imported = finishBrowserCapture(imports,imported.id,{missingPhotos:1,acceptPartial:true});
  assert.equal(imported.photos.length,1); assert.equal(imported.photos[0].selected,1); assert.equal(imported.status,'ready');
  assert.match(imported.recipe.sourceNotes.join(' '),/1 selected source photographs.*continue without/);
  assert.equal(finishBrowserCapture(imports,imported.id,{}).revision,imported.revision);
  assert.equal(imported.selection_confirmed,0,'captured photos require review before a paid estimate');
  imports.select(imported.id,imported.photos.map(photo=>photo.id));
  const settings={...f.defaults,images:true,imageWorkflow:'reference',output:'article_images'};
  const batch=prepareImportEstimate(f.batches,imported.id,settings);
  assert.equal(batch.quote.pending,0); assert.ok(batch.quote.estimated>0); assert.equal(batch.approved_at,null);
  assert.equal(prepareImportEstimate(f.batches,imported.id,settings).id,batch.id);
  await f.drainBatch(); assert.equal(f.providerCalls.length,0); assert.equal(f.calls.length,0);
  const saved=JSON.parse(fs.readFileSync(path.join(f.store.root,'research/browser',`${imported.id}.json`),'utf8'));
  assert.match(saved.text,/warming carrot soup/); assert.equal(saved.html,undefined);
});

test('rendered recipe without JSON-LD can become an estimate; incomplete pages never invent recipe facts', async t => {
  const f=await contentFixture(t),imports=new ImportStore(f.store);
  const captured=capture('<article><h1>Carrot soup</h1><p>A simple soup for lunch, made with carrots.</p><h2>Ingredients</h2><ul><li>500 g carrots</li><li>750 ml water</li></ul><h2>Instructions</h2><ol><li>Simmer the carrots in water for 20 minutes.</li><li>Blend and serve.</li></ol></article>');
  let row=beginBrowserCapture(imports,captureInput({html:captured.html}));
  assert.ok(row.recipe); assert.equal(row.recipe.ingredients.length,2);
  finishBrowserCapture(imports,row.id,{});
  assert.ok(prepareImportEstimate(f.batches,row.id,f.defaults).quote.estimated>0);
  row=beginBrowserCapture(imports,captureInput({html:'<article><h1>Unavailable</h1><p>Please enable your browser to view this page. Checking your browser.</p></article>'}));
  finishBrowserCapture(imports,row.id,{});
  assert.equal(row.recipe,null); assert.throws(()=>prepareImportEstimate(f.batches,row.id,f.defaults),/ingredients and instructions/);
  assert.equal(f.calls.length,0);
});

test('approved browser recipe uses saved facts for writing and new images without revisiting a blocked website',async t=>{
  const f=await contentFixture(t),imports=new ImportStore(f.store);
  const row=beginBrowserCapture(imports,captureInput());finishBrowserCapture(imports,row.id,{});
  const batch=prepareImportEstimate(f.batches,row.id,{...f.defaults,images:true,output:'article_images',imageWorkflow:'reference',correction:false});
  f.approve(batch);await f.drainBatch();
  assert.equal(f.calls.length,0);assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,3);
  const result=f.batches.detail(batch.id);assert.equal(result.status,'completed');
  assert.ok(result.items[0].files.some(file=>file.name==='article.html'));
});

test('capture rejects private URLs, oversized data and malformed IDs', async t => {
  const f=await contentFixture(t),imports=new ImportStore(f.store);
  for (const extra of [{url:'http://127.0.0.1/private'},{captureId:'../../outside'},{html:'x'.repeat(1500001)},{html:'<p>Empty</p>'}]) assert.throws(()=>beginBrowserCapture(imports,captureInput(extra)));
  assert.equal(imports.list().length,0);
  for (const url of ['file:///secret','javascript:alert(1)','http://127.1/a','http://192.168.1.1/a','http://[::1]/a','http://localhost/a','https://user:pass@example.com/a','http://server.local/a']) assert.throws(()=>publicImageUrl(url));
  assert.equal(publicImageUrl('https://cdn.example/soup.jpg'),'https://cdn.example/soup.jpg');
});

test('photo downloads omit cookies and redirects and stop oversized/error responses', async () => {
  let options;
  const blob=await fetchPhoto('https://cdn.example/soup.jpg',async(url,init)=>{options=init;return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}});});
  assert.equal(blob.size,3); assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
  await assert.rejects(fetchPhoto('https://cdn.example/no.jpg',async()=>new Response('',{status:403})),/403/);
  await assert.rejects(fetchPhoto('https://cdn.example/large.jpg',async()=>new Response('a',{headers:{'Content-Length':'10485761'}})),/10 MB/);
  await assert.rejects(fetchPhoto('https://cdn.example/stream.jpg',async()=>new Response(new Uint8Array(10485761))),/10 MB/);
});

test('bridge refuses a changed origin and only exposes import/estimate operations', async () => {
  const old=globalThis.location; globalThis.location=new URL('https://hostile.example/');
  try { assert.equal((await appBridge({origin:'http://127.0.0.1:55543',op:'begin'})).status,409);
    globalThis.location=new URL('http://127.0.0.1:55543/');
    assert.match((await appBridge({origin:location.origin,op:'approve',id:randomUUID()})).error,/Unsupported/);
  } finally { if(old===undefined)delete globalThis.location;else globalThis.location=old; }
});

test('extension manifest runs on click only and bundles no external app endpoint or remote executable code', () => {
  const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
  assert.equal(manifest.manifest_version,3); assert.equal(manifest.content_scripts,undefined); assert.equal(manifest.externally_connectable,undefined);
  assert.equal(manifest.action.default_popup,undefined);
  for(const name of ['background.js','content.js','shared.js','connection.js','capture.js']) {
    const code=fs.readFileSync(path.join(extension,name),'utf8'); new (require('node:vm').Script)(code,{filename:name});
    assert.doesNotMatch(code,/scrape-roan|vercel\.app|api\.openai|eval\(/);
  }
});

test('authenticated browser bridge imports text and image bytes, rejects cross-origin and late uploads, then returns an unpaid estimate', async t => {
  const { temporary }=require('./helpers/recipe-fixtures.cjs');
  const { handleIntelligence }=require('../.intelligence-build/lib/recipe-intelligence/api.js');
  const origin='http://127.0.0.1:34567',root=temporary(t);
  const keys=['RECIPE_INTELLIGENCE_ROOT','RECIPE_INTELLIGENCE_LOCAL','RECIPE_INTELLIGENCE_TOKEN','RECIPE_INTELLIGENCE_ORIGIN','VERCEL'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const savedFetch=globalThis.fetch,savedLocation=globalThis.location;
  let cookie='ri_session=capture-test-session'; const requests=[];
  Object.assign(process.env,{RECIPE_INTELLIGENCE_ROOT:root,RECIPE_INTELLIGENCE_LOCAL:'1',RECIPE_INTELLIGENCE_TOKEN:'capture-test-session',RECIPE_INTELLIGENCE_ORIGIN:origin});delete process.env.VERCEL;
  globalThis.location=new URL(origin);
  globalThis.fetch=async(route,options={})=>{
    requests.push(route);
    assert.equal(options.credentials,'same-origin');
    assert.equal(options.headers['X-RI-Key'],undefined,'Extension must not receive a launcher token');
    return handleIntelligence(new Request(new URL(route,origin),{...options,headers:{Host:new URL(origin).host,Origin:origin,Cookie:cookie,...options.headers}}));
  };
  t.after(async()=>{
    globalThis.fetch=savedFetch;if(savedLocation===undefined)delete globalThis.location;else globalThis.location=savedLocation;
    for(const p of globalThis.recipeIntelligenceStores?.values()||[])(await p).close();globalThis.recipeIntelligenceStores?.clear();
    for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];
  });
  const call=message=>appBridge({...message,origin});
  assert.equal((await call({op:'probe'})).ready,true);
  const input=captureInput();
  cookie='';assert.equal((await call({op:'begin',data:input})).status,401);cookie='ri_session=capture-test-session';
  const row=await call({op:'begin',data:input});assert.equal(row.status,'capturing');
  assert.equal((await call({op:'estimate',id:row.id})).status,400);
  const bytes=fs.readFileSync(path.join(__dirname,'fixtures/approved-recipe-photos/08-skillet.jpg'));
  const photo={op:'photo',id:row.id,base64:bytes.toString('base64'),mime:'image/jpeg',name:'Capture',caption:'Soupe à la carotte',url:'https://cdn.example/soup.jpg'};
  const uploaded=await call(photo);assert.equal(uploaded.photos.length,1);assert.equal(uploaded.photos[0].caption,photo.caption);
  assert.equal((await call(photo)).photos.length,1);
  const finished=await call({op:'finish',id:row.id,missingPhotos:0});assert.equal(finished.status,'ready');
  assert.equal((await call(photo)).status,400,'Finished captures cannot be modified by a retry');
  const batch=await call({op:'estimate',id:row.id});assert.equal(batch.quote.pending,1,'browser capture waits for photo selection in the app');assert.equal(batch.approved_at,null);
  assert.equal((await call({op:'estimate',id:row.id})).id,batch.id);
  assert.ok(requests.every(r=>!r.includes('approve')));
  const store=await [...globalThis.recipeIntelligenceStores.values()][0];assert.equal(store.db.prepare('SELECT count(*) n FROM api_calls').get().n,0);
  const untrusted=await handleIntelligence(new Request(`${origin}/api/recipe-intelligence/imports/browser`,{method:'POST',headers:{Host:new URL(origin).host,Origin:'https://food.example',Cookie:cookie,'X-Recipe-Intelligence':'1','Content-Type':'application/json'},body:JSON.stringify(input)}));assert.equal(untrusted.status,403);
  const tooLarge=await handleIntelligence(new Request(`${origin}/api/recipe-intelligence/imports/browser`,{method:'POST',headers:{Host:new URL(origin).host,Origin:origin,Cookie:cookie,'X-Recipe-Intelligence':'1','Content-Type':'application/json'},body:JSON.stringify({...input,html:'x'.repeat(2100000)})}));assert.equal(tooLarge.status,400);
  const decorStart=requests.length;
  globalThis.location=new URL(origin+'/?tab=home-decor');
  const capability=await call({op:'probe'});assert.equal(capability.destination,'home-decor');assert.equal(capability.decorBrowserCapture,true);
  const decorInput={captureId:randomUUID(),url:'https://decor.example/living-room/',html:'<article><h1>Small living room ideas</h1><p>'+ 'Arrange a linen sofa beside the window, keeping a clear path to the doorway. Add a wool rug and oak side table. '.repeat(5)+'</p><script>untrusted instructions</script></article>'};
  const decorCall=message=>call({...message,destination:'home-decor'});
  cookie='';assert.equal((await decorCall({op:'begin',data:decorInput})).status,401);cookie='ri_session=capture-test-session';
  const decorRow=await decorCall({op:'begin',data:decorInput});assert.equal(decorRow.status,'capturing');
  assert.equal((await decorCall({op:'begin',data:decorInput})).id,decorRow.id);
  assert.equal((await decorCall({op:'begin',data:{...decorInput,html:decorInput.html+'different'}})).status,400);
  const decorPhoto={...photo,id:decorRow.id,url:'https://cdn.example/living-room.jpg',caption:'Living room'};
  assert.equal((await decorCall(decorPhoto)).photos.length,1);assert.equal((await decorCall(decorPhoto)).photos.length,1);
  assert.deepEqual((await decorCall({op:'begin',data:decorInput})).uploadedUrls,[decorPhoto.url]);
  const {DecorStore}=require('../.intelligence-build/lib/recipe-intelligence/decor.js');const decor=new DecorStore(store);
  assert.equal(decor.claim(),null);assert.throws(()=>decor.select(decorRow.id,{photos:[],brief:''}),/already been queued/);
  assert.equal((await decorCall({op:'finish',id:decorRow.id,missingPhotos:1})).status,400);
  const finishedDecor=await decorCall({op:'finish',id:decorRow.id,missingPhotos:1,acceptPartial:true});assert.equal(finishedDecor.status,'ready');
  await decorCall({op:'finish',id:decorRow.id,missingPhotos:1,acceptPartial:true});
  const detail=decor.detail(decorRow.id);assert.equal(detail.state,'review');assert.equal(detail.photos[0].selected,false);assert.equal(detail.quote,undefined);assert.equal(detail.warnings.length,1);assert.ok(!detail.source.text.includes('untrusted instructions'));
  assert.equal((await decorCall({...decorPhoto,url:'https://cdn.example/late.jpg'})).status,400);
  assert.match((await decorCall({op:'estimate',id:decorRow.id})).error,/Unsupported/);
  assert.equal(decor.claim(),null);assert.equal(store.db.prepare('SELECT count(*) n FROM decor_calls').get().n,0);
  assert.ok(requests.slice(decorStart).every(r=>!r.includes('/imports/')&&!r.includes('/estimate')&&!r.includes('/approve')));
  const deniedDecor=await handleIntelligence(new Request(`${origin}/api/recipe-intelligence/decor/browser`,{method:'POST',headers:{Host:new URL(origin).host,Origin:'https://decor.example',Cookie:cookie,'X-Recipe-Intelligence':'1','Content-Type':'application/json'},body:JSON.stringify(decorInput)}));assert.equal(deniedDecor.status,403);
  assert.equal(store.integrity(),'ok');
});
