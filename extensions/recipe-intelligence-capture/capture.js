const {publicImageUrl,appBridge,renderedPhoto,fetchPhoto} = CaptureHelpers;
const connection = CaptureConnection.createConnection(chrome,appBridge);
const $ = id => document.getElementById(id);
const extensionVersion = chrome.runtime.getManifest().version;
$('version').textContent = `Capture v${extensionVersion} · Recipe photo filter enabled`;
const sourceTab = Number(new URLSearchParams(location.search).get('sourceTab'));
let job, previous, app, busy = false;
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
  $('title').textContent = capture.title;
  $('source').textContent = capture.url; $('source').href = capture.url;
  $('counts').textContent = `${capture.words.toLocaleString()} words · ${capture.images.length} photos found`;
  $('text').textContent = capture.text; $('preview').hidden = false;
  $('photo-count').textContent = `Photos (${capture.images.length})`;
  $('photos').replaceChildren();
  capture.images.forEach((photo,index) => {
    const label = document.createElement('label'); label.className = 'photo';
    const img = document.createElement('img'); img.src = photo.url; img.alt = photo.caption || `Photo ${index+1}`; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    const span = document.createElement('span'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = job.selected.includes(index); checkbox.disabled = !!job.started;
    checkbox.onchange = () => { job.selected = checkbox.checked ? [...job.selected,index].sort((a,b)=>a-b) : job.selected.filter(i=>i!==index); };
    span.append(checkbox,document.createTextNode(photo.caption || `Photo ${index+1}`)); label.append(img,span); $('photos').append(label);
  });
  $('warnings').replaceChildren();
  if (job.extensionVersion !== extensionVersion) warn('This saved capture comes from an earlier extension version. Its photo selection is preserved. Start a fresh capture from the recipe page to use the current filter.');
  if (capture.truncated) warn('This is a long page. The preview contains the first part; check that the recipe is present.');
  if (!capture.images.length) warn('No source photos were found. The app can estimate new images from the recipe text.');
  for (const failed of job.failed || []) warn(`Photo ${failed.index+1}: ${failed.message}`);
  $('import').disabled = false;
  $('import').hidden = !!job.done; $('open').hidden = !job.done; $('next').hidden = !job.done;
  $('import').textContent = job.started ? 'Resume import and see estimate' : 'Import and see estimate';
}
function warn(message) { const li = document.createElement('li'); li.textContent = message; $('warnings').append(li); }
async function capturePage() {
  clearError(); status('Reading the open page…'); $('retry').hidden = true;
  try {
    const tab = await chrome.tabs.get(sourceTab);
    if (new URL(tab.url).hostname === '127.0.0.1') {
      await findApp({origin:tab.url,allowOpen:false});
      status('Connected. Open a recipe website and click the extension to capture it.');
      return;
    }
    publicImageUrl(tab.url);
    const [result] = await chrome.scripting.executeScript({target:{tabId:sourceTab}, files:['content.js']});
    const capture = result?.result;
    if (!capture || capture.text.length < 40) throw new Error('No readable article found. Open the article itself, let it load, then capture it again.');
    publicImageUrl(capture.url);
    if (new Blob([capture.html]).size > 1500000) throw new Error('This page is too large. Open the individual recipe page and try again.');
    capture.images = capture.images.filter(p => { try { p.url = publicImageUrl(p.url); p.alternatives = p.alternatives.map(u => new URL(u,capture.url).href).filter(u => {try {publicImageUrl(u);return true;}catch{return false;}}); return true; } catch { return false; } });
    job = {id:crypto.randomUUID(),extensionVersion,capture,sourceTab,selected:capture.images.map((_,i)=>i),uploaded:[],failed:[],started:false};
    render(); status('Ready to import.');
  } catch (e) { status('Capture needs your attention.'); showError(e); $('retry').hidden = false; }
}
const base64 = blob => new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
async function normalizedPhoto(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < 160 || bitmap.height < 120 || bitmap.width * bitmap.height > 40000000) throw new Error('Photo must be at least 160 × 120 and at most 40 megapixels.');
    // Normalize AVIF and other browser-readable formats to a supported still JPEG.
    if (!['image/jpeg','image/png','image/webp'].includes(blob.type)) {
      const canvas = new OffscreenCanvas(bitmap.width,bitmap.height); canvas.getContext('2d').drawImage(bitmap,0,0);
      blob = await canvas.convertToBlob({type:'image/jpeg',quality:.94});
    }
    if (blob.size > 10*1024*1024) throw new Error('Photo exceeds 10 MB.');
    return {base64:await base64(blob),mime:blob.type};
  } finally { bitmap.close(); }
}
async function getPhoto(photo) {
  let failure;
  for (const url of [...new Set([photo.url,...photo.alternatives])]) {
    try { return await normalizedPhoto(await fetchPhoto(url)); } catch (e) { failure = e; }
  }
  try {
    const source = await chrome.tabs.get(job.sourceTab);
    const current = new URL(source.url), captured = new URL(job.capture.url); current.hash = ''; captured.hash = '';
    if (current.href !== captured.href) throw new Error('The source tab has navigated away from this recipe.');
    const [result] = await chrome.scripting.executeScript({target:{tabId:job.sourceTab},func:renderedPhoto,args:[[photo.url,...photo.alternatives]]});
    if (result?.result && result.result.length <= 14000000) return {base64:result.result,mime:'image/jpeg'};
  } catch { /* Source tab closed or pixels are unavailable. */ }
  throw failure || new Error('This photograph could not be read.');
}
async function importRecipe() {
  if (busy || !job) return;
  busy = true; clearError(); $('import').disabled = true; $('resume').disabled = true;
  try {
    await navigator.locks.request('recipe-intelligence-import',{ifAvailable:true},async lock => {
      if (!lock) throw new Error('Another capture tab is importing. Let it finish first.');
      // Persist even when the app is offline, before trying any connection.
      job.pending = true; await save();
      status('Connecting to your local workspace…'); await findApp();
      if (job.workspaceRoot && job.workspaceRoot !== app.root) throw new Error('This capture belongs to another storage folder. Open the original workspace to resume it.');
      // Save before the first request, so any interrupted import can be resumed.
      job.started = true; job.workspaceRoot = app.root; await save(); render(); $('import').disabled = true;
      let imported = await bridge(app,{op:'begin',data:{captureId:job.id,url:job.capture.url,html:job.capture.html}});
      if (imported.status === 'capturing') {
        job.uploaded = job.selected.filter(index => imported.photos.some(p => p.state === 'ready' && p.source_url === job.capture.images[index].url));
        job.failed = [];
        for (const index of job.selected) {
          if (job.uploaded.includes(index)) continue;
          status(`Importing photo ${job.selected.indexOf(index)+1} of ${job.selected.length}…`);
          const photo = job.capture.images[index]; let data;
          try { data = await getPhoto(photo); } catch (e) { job.failed.push({index,message:e.message}); await save(); continue; }
          try {
            await bridge(app,{op:'photo',id:job.id,...data,url:photo.url,caption:photo.caption,name:`Photo ${index+1}`}); job.uploaded.push(index);
          } catch (e) { if (e.status !== 400) throw e; job.failed.push({index,message:e.message}); }
          await save();
        }
        imported = await bridge(app,{op:'finish',id:job.id,missingPhotos:job.failed.length});
      }
      status('Calculating the estimate…');
      const batch = await bridge(app,{op:'estimate',id:job.id});
      if (!/^[a-f0-9-]{36}$/i.test(batch.id)) throw new Error('The app returned an invalid estimate.');
      job.batchId = batch.id; job.appOrigin = app.origin; job.done = true; job.pending = false; await save(); render();
      $('result').textContent = `Saved the recipe and ${imported.photos.filter(p=>p.state==='ready').length} photos. Estimated cost: $${Number(batch.quote.estimated).toFixed(4)}. No generation has started.`;
      status('Imported. Your estimate is ready.'); $('open').hidden = false; $('next').hidden = false; $('import').hidden = true;
      await openEstimate();
    });
  } catch (e) { status('Import needs your attention. Your saved progress is kept.'); showError(e); }
  finally { busy = false; $('import').disabled = false; $('resume').disabled = false; connectionControls(false); }
}
async function openEstimate() {
  if (!job?.batchId) return;
  await findApp();
  if (app.root !== job.workspaceRoot) throw new Error('Open the workspace that received this capture.');
  await connection.focus(app,`${app.origin}/?tab=recipe-intelligence&view=batches&batchId=${encodeURIComponent(job.batchId)}`);
}
$('connect').onclick = () => void findApp().catch(()=>{});
$('save-connection').onclick = () => void findApp({origin:$('app-url').value}).catch(()=>{});
$('workspace').onchange = () => { if ($('workspace').value) void findApp({origin:$('workspace').value}).catch(()=>{}); };
$('open-app').onclick = () => void findApp().then(target=>connection.focus(target)).catch(showError);
$('import').onclick = () => void importRecipe();
$('retry').onclick = () => void capturePage();
$('open').onclick = () => void openEstimate().catch(showError);
$('resume').onclick = () => { job = previous; render(); $('resume').hidden = true; status('Previous capture restored. Click Resume import to continue.'); };
(async () => {
  previous = (await chrome.storage.local.get('lastCapture')).lastCapture;
  if (previous?.capture && (previous.started || previous.pending) && !previous.done) $('resume').hidden = false;
  const saved=await connection.readSaved(); if (saved) $('app-url').value=saved.origin;
  await capturePage();
  if (!app) await findApp({allowOpen:false}).catch(()=>{});
})();
