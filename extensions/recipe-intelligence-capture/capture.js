const {publicImageUrl,appBridge,renderedPhoto,pagePhoto,fetchPhoto} = CaptureHelpers;
const connection = CaptureConnection.createConnection(chrome,appBridge);
const $ = id => document.getElementById(id);
const extensionVersion = chrome.runtime.getManifest().version;
$('version').textContent = `Capture v${extensionVersion} · Recipes and Home & Decor`;
const sourceTab = Number(new URLSearchParams(location.search).get('sourceTab'));
let job, previous, app, busy = false, capturing = false, photoPage = 0;
const photoCache = new Map();
const previewQueues = Array.from({length:3}, () => Promise.resolve());
function readablePhoto(photo, captureJob = job) {
  const key = `${captureJob.id}:${photo.url}`;
  if (!photoCache.has(key)) {
    const entry={promise:null,size:0};
    entry.promise=getPhoto(photo,captureJob).then(data=>{
      entry.size=data.base64.length;
      let total=[...photoCache.values()].reduce((sum,item)=>sum+item.size,0);
      for(const [oldKey,item] of photoCache){if(total<=24*1024*1024)break;if(oldKey!==key&&item.size){photoCache.delete(oldKey);total-=item.size;}}
      return data;
    }).catch(error=>{photoCache.delete(key);throw error;});
    photoCache.set(key,entry);
  }
  return photoCache.get(key).promise;
}
const status = text => { $('status').textContent = text; };
const showError = error => { $('error').hidden = false; $('error').textContent = error.message || String(error); };
const clearError = () => { $('error').hidden = true; $('error').textContent = ''; };
const save = () => chrome.storage.local.set({lastCapture:job});
const bridge = (target,message) => connection.bridge(target,message);
function connectionControls(disabled) {
  for (const id of ['connect','open-app','save-connection','workspace','app-url']) $(id).disabled=disabled;
}
async function findApp(options={}) {
  $('connection-status').textContent='Connecting to your workspace…'; $('connection-error').hidden=true;
  $('connection').hidden=true; connectionControls(true);
  try {
    app=await connection.connect({root:job?.workspaceRoot,...options});
    if (job && !job.started && !job.destinationChosen && app.destination) { job.destination=app.destination; render(); }
    $('connection-status').textContent=`Connected · ${app.root}`;
    $('app-url').value=app.origin; $('connect').textContent='Reconnect'; $('open-app').hidden=false;
    return app;
  } catch (error) {
    app=null; $('connection-status').textContent='Not connected'; $('open-app').hidden=true;
    $('connection-error').hidden=false; $('connection-error').textContent=error.message;
    if (error.targets?.length) {
      $('connection').hidden=false; $('connection-settings').open=true; $('workspace').replaceChildren();
      const placeholder=document.createElement('option'); placeholder.value=''; placeholder.textContent='Choose a workspace…'; $('workspace').append(placeholder);
      for (const target of error.targets) { const option=document.createElement('option'); option.value=target.origin; option.textContent=`${target.root} · ${target.origin}`; $('workspace').append(option); }
    }
    throw error;
  } finally { connectionControls(busy); }
}
function render() {
  const capture = job.capture;
  job.destination ||= 'recipe';
  $('destination').value=job.destination; $('destination').disabled=!!job.started || busy || capturing;
  $('title').textContent = capture.title;
  $('source').textContent = capture.url; $('source').href = capture.url;
  $('counts').textContent = `${capture.words.toLocaleString()} words · ${capture.discoveredPhotos || capture.images.length} photos discovered · ${job.selected.length} selected`;
  $('text').textContent = capture.text; $('preview').hidden = false;
  $('photo-count').textContent = `Photos (${capture.images.length})`;
  $('photos').replaceChildren();
  photoPage=Math.min(photoPage,Math.max(0,Math.ceil(capture.images.length/12)-1));
  $('photo-pages').hidden=capture.images.length<=12;
  $('photos-page').textContent=`${photoPage*12+1}–${Math.min(capture.images.length,(photoPage+1)*12)} of ${capture.images.length}`;
  $('photos-prev').disabled=photoPage===0; $('photos-next').disabled=(photoPage+1)*12>=capture.images.length;
  capture.images.slice(photoPage*12,(photoPage+1)*12).forEach((photo,offset) => {
    const index=photoPage*12+offset;
    const label = document.createElement('label'); label.className = 'photo';
    const img = document.createElement('img'); img.alt = photo.caption || `Photo ${index+1}`; img.hidden = true;
    const notice = document.createElement('p'); notice.textContent = 'Loading photo…';
    const captureJob = job;
    const lane = index % previewQueues.length;
    previewQueues[lane] = previewQueues[lane].then(async () => {
      if (!label.isConnected) return;
      try {
        const data = await readablePhoto(photo, captureJob);
        img.src = `data:${data.mime};base64,${data.base64}`;
        img.hidden = false;
        if(data.method==='rendered')notice.textContent='Displayed copy · the original file could not be downloaded.';
        else if(data.method==='converted')notice.textContent='Converted reference · normalized from a browser-readable format.';
        else notice.remove();
      } catch {
        notice.textContent = 'Photo unavailable. Open the article tab, scroll to this photo and let it load, then capture again. This photo will not be imported unless it can be read.';
      }
    });
    const span = document.createElement('span'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = job.selected.includes(index); checkbox.disabled = !!job.started || busy;
    checkbox.onchange = () => { job.selected = checkbox.checked ? [...job.selected,index].sort((a,b)=>a-b) : job.selected.filter(i=>i!==index); $('counts').textContent=`${capture.words.toLocaleString()} words · ${capture.discoveredPhotos || capture.images.length} photos discovered · ${job.selected.length} selected`; };
    span.append(checkbox,document.createTextNode(photo.caption || `Photo ${index+1}`)); label.append(img,notice,span); $('photos').append(label);
  });
  $('warnings').replaceChildren();
  if (job.extensionVersion !== extensionVersion) warn('This saved capture comes from an earlier extension version. Its photo selection is preserved. Start a fresh capture from the article page to use the current filter.');
  if (capture.truncated) warn('This is a long page. The preview contains the first part; check that the article content you need is present.');
  if (capture.imageLimitReached) warn(`Photo discovery reached its safety limit. Only the first ${capture.photoLimit || 80} candidates are available; this is not a complete capture of every image on the page.`);
  if (capture.loadingIncomplete) warn('Automatic scrolling reached its time or length limit. More content may still be unloaded. Check the original page; this capture may be incomplete.');
  for(const warning of job.serverWarnings || [])warn(warning);
  if (!capture.images.length) warn(job.destination === 'home-decor' ? 'No source photos were found. You can upload reference photos in Home & Decor before reviewing the estimate.' : 'No source photos were found. The app can estimate new images from the recipe text.');
  for (const failed of job.failed || []) warn(`Photo ${failed.index+1}: ${failed.message}`);
  $('import').disabled = busy || capturing;
  $('import').hidden = !!job.done; $('open').hidden = !job.done; $('next').hidden = !job.done;
  $('import').textContent = job.failed?.length && !job.done ? 'Retry missing photos' : job.started ? 'Resume saving' : job.destination === 'home-decor' ? 'Save to Home & Decor' : 'Save to My articles';
  $('continue-partial').hidden=!!job.done || !job.failed?.length;
  $('continue-partial').disabled=busy; $('continue-partial').textContent=`Continue with ${job.uploaded.length} saved photos`;
  $('coverage').textContent=job.started ? `${job.uploaded.length} of ${job.selected.length} selected photos saved${job.failed?.length ? ` · ${job.failed.length} unavailable` : ''}${capture.truncated || capture.imageLimitReached || capture.loadingIncomplete ? ' · capture has limitations' : ''}.` : '';
  $('open').textContent = job.destination === 'home-decor' ? 'Review Home & Decor' : 'Review My articles';
  $('next').textContent = job.destination === 'home-decor' ? 'Open Home & Decor to choose photos and room groups, review the estimate, and approve generation.' : 'Keep collecting recipes. When you finish, open My articles to review photos and click Generate for each article.';
}
function warn(message) { const li = document.createElement('li'); li.textContent = message; $('warnings').append(li); }
async function capturePage() {
  if(capturing || busy)return;
  capturing=true; job=null; photoPage=0;
  $('import').disabled=true; $('continue-partial').hidden=true; $('open').hidden=true; $('next').hidden=true; $('preview').hidden=true; $('title').textContent=''; $('counts').textContent=''; $('coverage').textContent=''; $('warnings').replaceChildren(); $('result').textContent='';
  clearError(); status('Reading the open page…'); $('retry').hidden = true;
  try {
    const tab = await chrome.tabs.get(sourceTab);
    const savedConnection = await connection.readSaved();
    if (new URL(tab.url).hostname === '127.0.0.1' || ['recipe-intelligence','home-decor'].includes(new URL(tab.url).searchParams.get('tab')) || new URL(tab.url).origin === savedConnection?.origin) {
      await findApp({origin:tab.url,allowOpen:false});
      status('Connected. Open a recipe or Home & Decor article and click the extension to capture it.');
      return;
    }
    publicImageUrl(tab.url);
    $('source').textContent='Open original article'; $('source').href=tab.url;
    status('Loading article photos… Scrolling the original page, then restoring its position.');
    const [prepared]=await chrome.scripting.executeScript({target:{tabId:sourceTab},files:['page-tools.js','prepare.js']});
    if(prepared?.result?.blocked)throw new Error(prepared.result.reason);
    const [result] = await chrome.scripting.executeScript({target:{tabId:sourceTab}, files:['content.js']});
    const capture = result?.result;
    if(capture?.blocked)throw new Error(capture.reason);
    if (!capture || capture.text.length < 40) throw new Error('No readable article found. Open the article itself, let it load, then capture it again.');
    publicImageUrl(capture.url);
    if (new Blob([capture.html]).size > 1500000) throw new Error('This page is too large. Open the individual article page and try again.');
    capture.loadingIncomplete=prepared?.result?.loadingIncomplete===true;
    capture.images = capture.images.filter(p => { try { p.url = publicImageUrl(p.url); p.alternatives = (p.alternatives||[]).map(u => new URL(u,capture.url).href).filter(u => {try {publicImageUrl(u);return true;}catch{return false;}}); return true; } catch { return false; } });
    job = {id:crypto.randomUUID(),extensionVersion,capture,sourceTab,destination:savedConnection?.destination || 'recipe',selected:capture.images.map((_,i)=>i),uploaded:[],failed:[],started:false};
    status('Ready to import.');
  } catch (e) { status('Capture needs your attention.'); showError(e); $('retry').hidden = false; }
  finally {capturing=false;if(job)render();}
}
const base64 = blob => new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
async function normalizedPhoto(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < 160 || bitmap.height < 120 || bitmap.width * bitmap.height > 40000000) throw new Error('Photo must be at least 160 × 120 and at most 40 megapixels.');
    const sample = new OffscreenCanvas(64,64), ctx = sample.getContext('2d');
    ctx.drawImage(bitmap,0,0,64,64);
    const pixels = ctx.getImageData(0,0,64,64).data;
    let useful = false;
    for (let i=0;i<pixels.length;i+=4) if (pixels[i+3]>8 && (pixels[i]>2 || pixels[i+1]>2 || pixels[i+2]>2)) { useful=true; break; }
    if (!useful) throw new Error('Photo is an empty or black loading placeholder. Let the photo load in the article tab, then retry.');
    // Normalize AVIF and other browser-readable formats to a supported still JPEG.
    const converted=!['image/jpeg','image/png','image/webp'].includes(blob.type);
    if (converted) {
      const canvas = new OffscreenCanvas(bitmap.width,bitmap.height); canvas.getContext('2d').drawImage(bitmap,0,0);
      blob = await canvas.convertToBlob({type:'image/jpeg',quality:.94});
    }
    if (blob.size > 10*1024*1024) throw new Error('Photo exceeds 10 MB.');
    return {base64:await base64(blob),mime:blob.type,method:converted?'converted':'original'};
  } finally { bitmap.close(); }
}
async function getPhoto(photo, captureJob = job) {
  let failure; const started=Date.now(), urls=[...new Set([photo.url,...photo.alternatives])].slice(0,6);
  for (const url of urls) {
    if(Date.now()-started>=30000)break;
    try { return await normalizedPhoto(await fetchPhoto(url,fetch,Math.min(10000,30000-(Date.now()-started)))); } catch (e) { failure = e; }
  }
  try {
    const source = await chrome.tabs.get(captureJob.sourceTab);
    const current = new URL(source.url), captured = new URL(captureJob.capture.url); current.hash = ''; captured.hash = '';
    if (current.href !== captured.href) throw new Error('The source tab has navigated away from this article.');
    for (const url of urls) {
      if(Date.now()-started>=50000)break;
      if (new URL(url).origin !== captured.origin) continue;
      const [pageResult] = await chrome.scripting.executeScript({target:{tabId:captureJob.sourceTab},func:pagePhoto,args:[url,captureJob.capture.url,Math.min(10000,50000-(Date.now()-started))]});
      const data = pageResult?.result;
      if (data?.base64 && data.base64.length <= 14000000) {
        try { return await normalizedPhoto(new Blob([Uint8Array.from(atob(data.base64), c => c.charCodeAt(0))], {type:data.mime})); }
        catch { /* Try another actual image URL or decoded source pixels. */ }
      }
    }
    const [result] = await chrome.scripting.executeScript({target:{tabId:captureJob.sourceTab},func:renderedPhoto,args:[[photo.url,...photo.alternatives]]});
    if (result?.result && result.result.length <= 14000000) return {base64:result.result,mime:'image/jpeg',method:'rendered'};
  } catch { /* Source tab closed or pixels are unavailable. */ }
  throw failure || new Error('This photograph could not be read.');
}
async function importRecipe(allowMissing=false) {
  if (busy || !job) return;
  busy = true; clearError(); $('import').disabled = true; $('resume').disabled = true;
  try {
    await navigator.locks.request('recipe-intelligence-import',{ifAvailable:true},async lock => {
      if (!lock) throw new Error('Another capture tab is importing. Let it finish first.');
      // Persist even when the app is offline, before trying any connection.
      job.pending = true; await save();
      status('Connecting to your workspace…'); await findApp();
      if (job.workspaceRoot && job.workspaceRoot !== app.root) throw new Error('This capture belongs to another storage folder. Open the original workspace to resume it.');
      if (job.destination === 'home-decor' && !app.decorBrowserCapture) throw new Error('Update the app to support Home & Decor browser imports. This article has not been sent to the recipe importer.');
      if(!app.captureReview)throw new Error('Update the app before using this extension version. Photo retries and capture-limit reporting need the latest backend. Your capture has been kept.');
      // Save before the first request, so any interrupted import can be resumed.
      job.started = true; job.workspaceRoot = app.root; await save(); render(); $('import').disabled = true;
      const destination = job.destination || 'recipe';
      let imported = await bridge(app,{op:'begin',destination,data:{captureId:job.id,url:job.capture.url,html:job.capture.html,captureReport:{textTruncated:!!job.capture.truncated,imageLimitReached:!!job.capture.imageLimitReached,loadingIncomplete:!!job.capture.loadingIncomplete}}});
      job.serverWarnings=imported.captureWarnings || imported.warnings || [];
      if (imported.status === 'capturing') {
        job.uploaded = job.selected.filter(index => job.uploaded.includes(index) || imported.uploadedUrls?.includes(job.capture.images[index].url) || imported.photos.some(p => p.state === 'ready' && p.source_url === job.capture.images[index].url));
        if(!allowMissing)job.failed = [];
        for (const index of job.selected) {
          if (job.uploaded.includes(index)) continue;
          if(allowMissing && job.failed.some(f=>f.index===index))continue;
          status(`Importing photo ${job.selected.indexOf(index)+1} of ${job.selected.length}…`);
          const photo = job.capture.images[index]; let data;
          try { data = await readablePhoto(photo); } catch (e) { job.failed.push({index,message:e.message}); await save(); continue; }
          try {
            await bridge(app,{op:'photo',destination,id:job.id,...data,url:photo.url,caption:photo.caption,name:`Photo ${index+1}`}); job.uploaded.push(index); (job.photoMethods ||= {})[index]=data.method || 'original';
          } catch (e) { if (e.status !== 400) throw e; job.failed.push({index,message:e.message}); }
          await save();
        }
        if(job.failed.length && !allowMissing){await save();status('Import needs your attention. Saved photos are kept; retry the missing photos or continue without them.');render();return;}
        imported = await bridge(app,{op:'finish',destination,id:job.id,missingPhotos:job.failed.length,acceptPartial:allowMissing,derivedPhotos:Object.values(job.photoMethods||{}).filter(method=>method!=='original').length});
      }
      status(destination === 'home-decor' ? 'Saving for photo selection and review…' : 'Calculating the estimate…');
      const batch = destination === 'home-decor' ? imported : await bridge(app,{op:'estimate',destination,id:job.id});
      if (!/^[a-f0-9-]{36}$/i.test(batch.id)) throw new Error('The app returned an invalid estimate.');
      job.batchId = batch.id; job.appOrigin = app.origin; job.done = true; job.pending = false; await save(); render();
      $('result').textContent = `Saved the ${destination === 'home-decor' ? 'Home & Decor article' : 'recipe'} and ${imported.photos.filter(p=>p.state==='ready').length} photos. ${destination === 'home-decor' ? 'Choose photos and review the estimate in Home & Decor.' : 'Finish collecting recipes, then review them in My articles.'} No generation has started.`;
      const partial=job.failed.length || job.capture.truncated || job.capture.imageLimitReached || job.capture.loadingIncomplete || job.serverWarnings.length;
      status(partial?'Imported with limitations. Review the import notes.':'Imported. Saved for your review.'); $('open').hidden = false; $('next').hidden = false; $('import').hidden = true;
      // Stay here so the user can finish collecting recipes before review.
    });
  } catch (e) { status('Import needs your attention. Your saved progress is kept.'); showError(e); }
  finally { busy = false; $('resume').disabled = false; if(job)render();connectionControls(false); }
}
async function openEstimate() {
  if (!job?.batchId) return;
  await findApp();
  if (app.root !== job.workspaceRoot) throw new Error('Open the workspace that received this capture.');
  await connection.focus(app,job.destination === 'home-decor' ? `${app.origin}/?tab=home-decor&decorId=${job.batchId}` : `${app.origin}/?tab=recipe-intelligence&view=batches`);
}
$('destination').onchange = () => { if (!job || job.started || busy) return; job.destination=$('destination').value; job.destinationChosen=true; render(); };
$('connect').onclick = () => void findApp().catch(()=>{});
$('save-connection').onclick = () => void findApp({origin:$('app-url').value}).catch(()=>{});
$('workspace').onchange = () => { if ($('workspace').value) void findApp({origin:$('workspace').value}).catch(()=>{}); };
$('open-app').onclick = () => void findApp().then(target=>connection.focus(target)).catch(showError);
$('import').onclick = () => void importRecipe();
$('continue-partial').onclick = () => void importRecipe(true);
$('photos-prev').onclick = () => {photoPage--;render();};
$('photos-next').onclick = () => {photoPage++;render();};
$('retry').onclick = () => void capturePage();
$('open').onclick = () => void openEstimate().catch(showError);
$('resume').onclick = () => { if(busy||capturing)return;job = previous;photoPage=0;render(); $('resume').hidden = true; status('Previous capture restored. Click Resume saving or Retry missing photos to continue.'); };
(async () => {
  previous = (await chrome.storage.local.get('lastCapture')).lastCapture;
  if (previous?.capture && (previous.started || previous.pending) && !previous.done) $('resume').hidden = false;
  const saved=await connection.readSaved(); if (saved) $('app-url').value=saved.origin;
  await capturePage();
  if (!app) await findApp({allowOpen:false}).catch(()=>{});
})();
