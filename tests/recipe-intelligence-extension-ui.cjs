const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const directory=path.join(__dirname,'../extensions/recipe-intelligence-capture');
const batchId='d9913fb3-cfa3-4d08-9840-3efc042ce14a';
test('packaged Chrome icons decode as PNG at their declared dimensions',async()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  for(const [size,file] of Object.entries(manifest.icons)){
    const metadata=await require('sharp')(fs.readFileSync(path.join(directory,file))).metadata();
    assert.equal(metadata.format,'png');assert.equal(metadata.width,Number(size));assert.equal(metadata.height,Number(size));
  }
});
async function until(predicate) { for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Extension UI did not settle'); }
async function ui(t,{storage={},failFirstUpload=false,downloadFailure=false,pageRecovery=false,windowState='normal',offline=false,sourceIsApp=false,destination='recipe',decorSupported=true,reviewSupported=true,photoCount=1,failedUrls=[],preparation={},renderedRecovery=false}={}) {
  const dom=new JSDOM(fs.readFileSync(path.join(directory,'capture.html'),'utf8'),{url:'https://extension.example/capture.html?sourceTab=11',runScripts:'outside-only'});
  const w=dom.window, calls=[],navigations=[],windowUpdates=[]; let uploads=0,stage='capturing',photos=[];
  const capture={url:'https://food.example/soup/',title:'Carrot soup',html:'<article><h1>Carrot soup</h1><p>The captured article.</p></article>',text:'Carrot soup\nA warm soup made from carrots, water and salt.',words:12,images:[{url:'https://cdn.example/soup.jpg',caption:'Carrot soup',alternatives:[]}],truncated:false};
  if(pageRecovery) capture.images[0].url='https://food.example/soup.jpg';
  if(photoCount>1)capture.images=Array.from({length:photoCount},(_,i)=>({url:`https://cdn.example/photo-${i}.jpg`,caption:`Photo ${i+1}`,alternatives:[]}));
  const appTab={id:22,url:'http://127.0.0.1:55543/?tab=recipe-intelligence',windowId:77};
  w.chrome={
    runtime:{getManifest:()=>JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'))},
    tabs:{get:async id=>id===22?appTab:{id:11,url:sourceIsApp?appTab.url:capture.url},query:async()=>offline?[]:[appTab],update:async(id,details)=>{navigations.push({id,details});return {id,windowId:77};}},
    windows:{get:async id=>{assert.equal(id,77);return {id,state:windowState};},update:async(id,details)=>windowUpdates.push({id,details:JSON.parse(JSON.stringify(details))})},
    storage:{local:{get:async()=>JSON.parse(JSON.stringify(storage)),set:async data=>Object.assign(storage,JSON.parse(JSON.stringify(data)))}},
    scripting:{executeScript:async options=>{
      if(options.files)return [{result:JSON.parse(JSON.stringify(options.files.includes('prepare.js')?preparation:capture))}];
      if(options.func.name==='pagePhoto')return [{result:pageRecovery?{base64:'AQID',mime:'image/jpeg'}:null}];
      if(options.func.name==='renderedPhoto')return [{result:renderedRecovery?'AQID':null}];
      assert.equal(options.world,'ISOLATED');const m=options.args[0];calls.push(m);
      if(m.op==='probe')return [{result:{ready:true,root:'E:\\Recipes',destination,decorBrowserCapture:decorSupported,captureReview:reviewSupported}}];
      if(m.op==='begin')return [{result:{id:m.data.captureId,status:stage,photos}}];
      if(m.op==='photo'){
        if(failFirstUpload&&++uploads===1)return [{result:{error:'Local app restarting',status:503}}];
        if(!photos.some(p=>p.source_url===m.url))photos.push({id:'p'+(photos.length+1),state:'ready',source_url:m.url});return [{result:{photos}}];
      }
      if(m.op==='finish'){stage='ready';return [{result:{id:m.id,photos,status:stage}}];}
      if(m.op==='estimate')return [{result:{id:batchId,quote:{estimated:.71}}}];
      throw new Error(`Unexpected operation ${m.op}`);
    }}
  };
  w.navigator.locks={request:async(name,options,callback)=>callback({name})};
  w.fetch=async url=>downloadFailure||failedUrls.includes(url)?new Response('',{status:403}):new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}});
  w.createImageBitmap=async()=>({width:300,height:250,close(){}});
  w.OffscreenCanvas=class {getContext(){return {drawImage(){},getImageData(){return {data:new Uint8ClampedArray([40,30,20,255])};}};}};
  w.AbortController=AbortController;
  w.eval(fs.readFileSync(path.join(directory,'shared.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(directory,'connection.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(directory,'capture.js'),'utf8'));
  t.after(()=>dom.window.close());
  await until(()=>w.document.getElementById('status').textContent===(preparation.blocked?'Capture needs your attention.':sourceIsApp?'Connected. Open a recipe or Home & Decor article and click the extension to capture it.':'Ready to import.'));
  await until(()=>!w.document.getElementById('connect').disabled);
  const button=id=>w.document.getElementById(id);
  const run=async()=>{button('import').click();await until(()=>!button('import').disabled&&(button('status').textContent.startsWith('Imported')||button('status').textContent.startsWith('Import needs')));};
  return {w,calls,navigations,windowUpdates,storage,run,button,setOnline:()=>{offline=false;},recoverPhotos:()=>{downloadFailure=false;failedUrls=[];}};
}
test('extension preview imports image bytes, finishes before estimating, and waits for manual library review',async t=>{
  const screen=await ui(t);assert.equal(screen.button('title').textContent,'Carrot soup');
  assert.match(screen.button('version').textContent,/Capture v2\.6\.0/);
  assert.match(screen.button('connection-status').textContent,/Connected.*E:/);
  await screen.run();
  await until(()=>screen.button('photos').querySelector('img').src.startsWith('data:image/jpeg;base64,'));
  assert.equal(screen.button('photos').querySelector('img').hidden,false);
  const operations=screen.calls.map(m=>m.op).filter(op=>op!=='probe');
  assert.deepEqual(operations,['begin','photo','finish','estimate']);
  assert.equal(screen.calls.find(m=>m.op==='photo').base64,'AQID');
  assert.equal(screen.navigations.length,0);
  assert.equal(screen.windowUpdates.length,0);
  screen.button('open').click();await until(()=>screen.navigations.length===1);
  assert.match(screen.navigations[0].details.url,/view=batches$/);
  assert.deepEqual(screen.windowUpdates,[{id:77,details:{focused:true}}]);
  assert.equal(screen.button('next').hidden,false);
  assert.equal(screen.storage.lastCapture.done,true);assert.match(screen.button('result').textContent,/No generation has started/);
  assert.equal(screen.storage.lastCapture.extensionVersion,'2.6.0');
  assert.ok(!screen.calls.some(c=>c.op==='approve'));
});

test('Home & Decor destination imports photos without recipe estimation and opens the captured decor job',async t=>{
  const screen=await ui(t,{destination:'home-decor'});
  assert.equal(screen.button('destination').value,'home-decor');
  assert.equal(screen.button('import').textContent,'Save to Home & Decor');
  await screen.run();
  const operations=screen.calls.filter(m=>m.op!=='probe');
  assert.deepEqual(operations.map(m=>m.op),['begin','photo','finish']);
  assert.ok(operations.every(m=>m.destination==='home-decor'));
  assert.equal(screen.storage.lastCapture.destination,'home-decor');
  assert.equal(screen.button('destination').disabled,true);
  assert.match(screen.button('result').textContent,/Home & Decor article.*No generation has started/);
  screen.button('open').click();await until(()=>screen.navigations.length===1);
  const url=new URL(screen.navigations[0].details.url);
  assert.equal(url.searchParams.get('tab'),'home-decor');assert.equal(url.searchParams.get('decorId'),screen.storage.lastCapture.id);
  assert.ok(!screen.calls.some(m=>['estimate','approve'].includes(m.op)));
});

test('manual decor choice overrides the open recipe tab and refuses an app without decor capture support',async t=>{
  const screen=await ui(t,{decorSupported:false});
  screen.button('destination').value='home-decor';screen.button('destination').dispatchEvent(new screen.w.Event('change'));
  await screen.run();
  assert.match(screen.button('error').textContent,/Update the app.*Home & Decor/);
  assert.ok(screen.calls.every(m=>m.op==='probe'));
  assert.equal(screen.storage.lastCapture.destination,'home-decor');
  assert.equal(screen.button('destination').disabled,false);
});

test('resuming a decor capture keeps its destination even if the app tab changes to recipes',async t=>{
  const screen=await ui(t,{destination:'home-decor',failFirstUpload:true});await screen.run();
  assert.equal(screen.storage.lastCapture.started,true);assert.equal(screen.storage.lastCapture.done,undefined);
  const next=await ui(t,{storage:screen.storage,destination:'recipe'});
  next.button('resume').click();assert.equal(next.button('destination').value,'home-decor');
  await next.run();assert.equal(next.storage.lastCapture.done,true);
  assert.ok(next.calls.filter(m=>m.op!=='probe').every(m=>m.destination==='home-decor'));
  assert.ok(!next.calls.some(m=>m.op==='estimate'));
});

test('a direct 403 can recover from the source tab and uses those same bytes for preview and import',async t=>{
  const screen=await ui(t,{downloadFailure:true,pageRecovery:true});
  await until(()=>screen.button('photos').querySelector('img').hidden===false);
  assert.equal(screen.button('photos').querySelector('img').src,'data:image/jpeg;base64,AQID');
  await screen.run();
  assert.equal(screen.calls.find(c=>c.op==='photo').base64,'AQID');
  assert.equal(screen.storage.lastCapture.failed.length,0);
  assert.ok(!screen.calls.some(c=>c.op==='approve'));
});
test('resuming an older capture explains that its original photo selection is preserved',async t=>{
  const previous={id:'older-capture',sourceTab:11,started:true,selected:[0],uploaded:[],failed:[],capture:{url:'https://food.example/old/',title:'Older recipe',html:'<article>Older recipe</article>',text:'Older captured recipe text',words:4,images:[{url:'https://cdn.example/old.jpg',caption:'Previous photo',alternatives:[]}]}};
  const screen=await ui(t,{storage:{lastCapture:previous}});
  assert.equal(screen.button('resume').hidden,false);screen.button('resume').click();
  assert.match(screen.button('warnings').textContent,/earlier extension version/);
  assert.equal(screen.button('title').textContent,'Older recipe');
  assert.equal(screen.calls.filter(c=>c.op!=='probe').length,0,'Restoring a capture must not import or start paid work');
  assert.deepEqual(screen.storage.lastCapture.selected,[0]);
});
test('opening generation restores a minimized app window and manual reopen does not approve or re-import',async t=>{
  const screen=await ui(t,{windowState:'minimized'});await screen.run();
  assert.equal(screen.windowUpdates.length,0);
  screen.button('open').click();await until(()=>screen.windowUpdates.length===1);
  assert.deepEqual(screen.windowUpdates,[{id:77,details:{focused:true,state:'normal'}}]);
  assert.equal(screen.calls.filter(c=>c.op==='begin').length,1);
  assert.equal(screen.calls.filter(c=>c.op==='estimate').length,1);
  assert.equal(screen.calls.some(c=>c.op==='approve'),false);
});
test('opening generation preserves a maximized app window',async t=>{
  const screen=await ui(t,{windowState:'maximized'});await screen.run();
  assert.equal(screen.windowUpdates.length,0);screen.button('open').click();await until(()=>screen.windowUpdates.length===1);
  assert.deepEqual(screen.windowUpdates,[{id:77,details:{focused:true}}]);
});
test('lost local connection keeps the capture ID and resumes without finalizing or quoting partial data',async t=>{
  const screen=await ui(t,{failFirstUpload:true});await screen.run();
  const id=screen.storage.lastCapture.id;
  assert.equal(screen.storage.lastCapture.started,true);assert.equal(screen.storage.lastCapture.done,undefined);
  assert.ok(!screen.calls.some(c=>c.op==='finish'||c.op==='estimate'));
  await screen.run();
  assert.equal(screen.storage.lastCapture.id,id);assert.equal(screen.storage.lastCapture.done,true);
  assert.equal(screen.calls.filter(c=>c.op==='begin')[1].data.captureId,id);
});
test('unavailable source photo is reported and does not erase readable article capture',async t=>{
  const screen=await ui(t,{downloadFailure:true});await screen.run();
  await until(()=>screen.button('photos').textContent.includes('Photo unavailable'));
  assert.equal(screen.button('photos').querySelector('img').hasAttribute('src'),false);
  assert.equal(screen.calls.some(c=>c.op==='photo'),false);
  assert.ok(!screen.calls.some(c=>c.op==='finish'||c.op==='estimate'));
  assert.match(screen.button('warnings').textContent,/403/);
  assert.equal(screen.storage.lastCapture.done,undefined);
  assert.equal(screen.button('import').textContent,'Retry missing photos');
  screen.button('continue-partial').click();await until(()=>screen.storage.lastCapture.done);
  assert.equal(screen.calls.find(c=>c.op==='finish').missingPhotos,1);
  assert.equal(screen.calls.find(c=>c.op==='finish').acceptPartial,true);
  assert.match(screen.button('status').textContent,/with limitations/);
  assert.equal(screen.storage.lastCapture.done,true);
});

test('retry saves only missing photos; successful photos and capture ID survive interruption',async t=>{
  const screen=await ui(t,{photoCount:3,failedUrls:['https://cdn.example/photo-1.jpg'],destination:'home-decor'});
  await screen.run();const id=screen.storage.lastCapture.id;
  assert.equal(screen.storage.lastCapture.uploaded.length,2);assert.equal(screen.storage.lastCapture.failed.length,1);
  assert.match(screen.button('coverage').textContent,/2 of 3.*1 unavailable/);
  assert.ok(!screen.calls.some(c=>c.op==='finish'||c.op==='estimate'));
  screen.recoverPhotos();await screen.run();
  assert.equal(screen.storage.lastCapture.id,id);assert.equal(screen.storage.lastCapture.done,true);
  assert.equal(screen.calls.filter(c=>c.op==='photo').length,3);
  assert.equal(screen.calls.filter(c=>c.op==='finish').length,1);
  assert.ok(!screen.calls.some(c=>c.op==='approve'||c.op==='estimate'));
});

test('preview pagination retains all 35 selected photos for import',async t=>{
  const screen=await ui(t,{photoCount:35});
  assert.equal(screen.button('photos').querySelectorAll('input').length,12);
  screen.button('photos-next').click();assert.match(screen.button('photos-page').textContent,/13–24 of 35/);
  screen.button('photos').querySelector('input').click();
  screen.button('photos-next').click();assert.equal(screen.button('photos').querySelectorAll('input').length,11);
  await screen.run();assert.equal(screen.calls.filter(c=>c.op==='photo').length,34);
  assert.equal(screen.storage.lastCapture.selected.length,34);
});

test('challenge pages cannot be saved or sent through any import operation',async t=>{
  const screen=await ui(t,{preparation:{blocked:true,reason:'Complete verification in the original tab.'}});
  assert.equal(screen.button('import').disabled,true);assert.equal(screen.button('preview').hidden,true);
  assert.equal(screen.button('retry').hidden,false);assert.match(screen.button('error').textContent,/Complete verification/);
  assert.equal(screen.storage.lastCapture,undefined);assert.ok(screen.calls.every(c=>c.op==='probe'));
});

test('bounded page loading and rendered image fallbacks are reported without claiming complete originals',async t=>{
  const screen=await ui(t,{downloadFailure:true,renderedRecovery:true,preparation:{loadingIncomplete:true}});
  await until(()=>screen.button('photos').textContent.includes('Displayed copy'));
  await screen.run();assert.match(screen.button('status').textContent,/with limitations/);
  assert.equal(screen.calls.find(c=>c.op==='begin').data.captureReport.loadingIncomplete,true);
  assert.equal(screen.calls.find(c=>c.op==='finish').derivedPhotos,1);
  assert.match(screen.button('warnings').textContent,/time or length limit/);
});

test('new capture features refuse an old backend before sending article data',async t=>{
  const screen=await ui(t,{reviewSupported:false});await screen.run();
  assert.match(screen.button('error').textContent,/latest backend/);assert.ok(screen.calls.every(c=>c.op==='probe'));
});

test('offline capture is saved before connection and can resume from a new extension tab',async t=>{
  const first=await ui(t,{offline:true});await first.run();
  assert.equal(first.storage.lastCapture.started,false);assert.equal(first.storage.lastCapture.pending,true);
  assert.equal(first.calls.length,0);assert.match(first.button('connection-error').textContent,/HTTPS address/);
  const id=first.storage.lastCapture.id;
  const reopened=await ui(t,{storage:first.storage});
  assert.equal(reopened.button('resume').hidden,false);reopened.button('resume').click();await reopened.run();
  assert.equal(reopened.storage.lastCapture.id,id);assert.equal(reopened.storage.lastCapture.done,true);
  assert.equal(reopened.storage.lastCapture.pending,false);
});

test('clicking the extension on the app connects without capturing the app or preparing a paid job',async t=>{
  const screen=await ui(t,{sourceIsApp:true});
  assert.equal(screen.button('import').disabled,true);assert.equal(screen.button('preview').hidden,true);
  assert.equal(screen.storage.recipeIntelligenceConnection.origin,'http://127.0.0.1:55543');
  assert.equal(screen.calls.every(c=>c.op==='probe'),true);assert.equal(screen.storage.lastCapture,undefined);
  screen.button('open-app').click();await until(()=>screen.navigations.length===1);
  assert.equal(screen.navigations[0].details.url,'http://127.0.0.1:55543/?tab=recipe-intelligence');
});
