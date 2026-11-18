const {publicImageUrl,appBridge,renderedPhoto,pagePhoto,fetchPhoto} = CaptureHelpers;
const connection = CaptureConnection.createConnection(chrome,appBridge);
const $ = id => document.getElementById(id);
const extensionVersion = chrome.runtime.getManifest().version;
$('version').textContent = `Capture v${extensionVersion} · Recipes and Home & Decor`;
const sourceTab = Number(new URLSearchParams(location.search).get('sourceTab'));
const manualPage = new URLSearchParams(location.search).get('manual') === '1';
const manualKey = url => 'manualDraft:'+CaptureHelpers.articleAddress(url);
let manualItem, manualLoading=false, previewVersion=0;
let job, previous, app, busy = false, capturing = false, photoPage = 0;
let proposal, currentRule, savedRule;
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
const save = () => chrome.storage.local.set(manualPage ? {lastCapture:job,[manualKey(job.capture.url)]:job} : {lastCapture:job});
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
  $('parts').hidden=manualPage || !!job.started || !!job.done;
  $('manual-open').hidden=manualPage || !!job.started || !!job.done;
  $('manual-editor').hidden=!manualPage || !!job.started || !!job.done;
  for(const id of ['append','range','keep','remember','forget','accept-part','discard-part']) $(id).disabled=busy||capturing;
  $('part-review').hidden=!proposal;
  $('remember').hidden=!currentRule || !!proposal;
  $('forget').hidden=!savedRule;
  $('outline').hidden=false;
  $('outline-list').replaceChildren();
  for(const section of CaptureHelpers.sectionsOf(proposal?.capture || capture).sections){
    if(!section.heading && !section.blocks.length)continue;
    const row=document.createElement('li');
    const count=section.blocks.reduce((n,b)=>n+(b.nodeName==='IMG'?1:b.querySelectorAll?.('img').length||0),0);
    row.textContent=(section.heading||capture.title)+' · '+count+' photos · '+section.blocks.map(b=>b.textContent.trim()).filter(Boolean).join(' ').slice(0,120);
    $('outline-list').append(row);
  }
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
      if (captureJob.fileCopies?.[index]) { notice.textContent = 'Saved from your file for this article photo.'; return; }
      try {
        const data = await readablePhoto(photo, captureJob);
        img.src = `data:${data.mime};base64,${data.base64}`;
        img.hidden = false;
        const dimensions=document.createElement('small');
        img.after(dimensions);
        const showSize=()=>{const width=data.width||img.naturalWidth,height=data.height||img.naturalHeight;
          if(width&&height)dimensions.textContent=width+' × '+height+(data.upgraded?' · larger source selected':Math.min(width,height)<400?' · low resolution':'');};
        img.onload=showSize; showSize();
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
    if(photo.sourceHeading){const heading=document.createElement('p');heading.textContent=`Linked heading: ${photo.sourceHeading}`;label.append(heading);}
  });
  $('warnings').replaceChildren();
  if (job.extensionVersion !== extensionVersion) warn('This saved capture comes from an earlier extension version. Its photo selection is preserved. Start a fresh capture from the article page to use the current filter.');
  if (capture.truncated) warn('This is a long page. The preview contains the first part; check that the article content you need is present.');
  if (capture.imageLimitReached) warn(`Photo discovery reached its safety limit. Only the first ${capture.photoLimit || 80} candidates are available; this is not a complete capture of every image on the page.`);
  if (capture.loadingIncomplete) warn('Automatic scrolling reached its time or length limit. More content may still be unloaded. Check the original page; this capture may be incomplete.');
  for(const warning of job.serverWarnings || [])warn(warning);
  if (!capture.images.length) warn(job.destination === 'home-decor' ? 'No source photos were found. You can upload reference photos in Home & Decor before reviewing the estimate.' : 'No source photos were found. The app can estimate new images from the recipe text.');
  for (const failed of job.failed || []) {
    const photo = capture.images[failed.index];
    const row = warn(`Photo ${failed.index+1}: ${failed.message}`);
    if (job.done || !photo) continue;
    const label = document.createElement('label');
    label.textContent = `Use a saved copy of photo ${failed.index+1}${photo.sourceHeading ? ' · '+photo.sourceHeading : ''}`;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/avif'; input.disabled = busy;
    input.onchange = () => {
      const file = input.files[0];
      if (!file || busy) return;
      if (file.size > 10*1024*1024) { showError(new Error('Choose a photo up to 10 MB.')); return; }
      void importRecipe(false, {index:failed.index,file});
    };
    label.append(input); row.append(label);
  }
  $('import').disabled = busy || capturing || !!proposal;
  if(manualPage && !job.started)manualControls();
  $('import').hidden = !!job.done; $('open').hidden = !job.done; $('next').hidden = !job.done;
  $('import').textContent = job.failed?.length && !job.done ? 'Retry missing photos' : job.started ? 'Resume saving' : job.destination === 'home-decor' ? 'Save to Home & Decor' : 'Save to My articles';
  $('continue-partial').hidden=!!job.done || !job.failed?.length;
  $('continue-partial').disabled=busy; $('continue-partial').textContent=`Continue with ${job.uploaded.length} saved photos`;
  $('coverage').textContent=job.started ? `${job.uploaded.length} of ${job.selected.length} selected photos saved${job.failed?.length ? ` · ${job.failed.length} unavailable` : ''}${capture.truncated || capture.imageLimitReached || capture.loadingIncomplete ? ' · capture has limitations' : ''}.` : '';
  $('open').textContent = job.destination === 'home-decor' ? 'Review Home & Decor' : 'Review My articles';
  $('next').textContent = job.destination === 'home-decor' ? 'Open Home & Decor to choose photos and room groups, review the estimate, and approve generation.' : 'Keep collecting recipes. When you finish, open My articles to review photos and click Generate for each article.';
}
function warn(message) { const li = document.createElement('li'); li.textContent = message; $('warnings').append(li); return li; }
const ruleKey = url => 'captureRange:'+new URL(url).origin;
async function readPart(tab,rule,photosOnly=false) {
    publicImageUrl(tab.url);
    const [prepared]=await chrome.scripting.executeScript({target:{tabId:sourceTab},files:['page-tools.js','prepare.js']});
    if(prepared?.result?.blocked)throw new Error(prepared.result.reason);
    if(rule)await chrome.scripting.executeScript({target:{tabId:sourceTab},func:(url,rule)=>{globalThis.recipeCaptureBounds={url,rule};},args:[tab.url,rule]});
    const [result]=await chrome.scripting.executeScript({target:{tabId:sourceTab},files:['content.js']});
    const capture=result?.result;
    if(capture?.boundsMismatch)throw new Error('The website layout changed. Choose a new range or forget the saved range.');
    if(capture?.blocked)throw new Error(capture.reason);
    if (!capture || (!photosOnly && capture.text.length < 40)) throw new Error('No readable article found. Open the article itself, let it load, then capture it again.');
    if (capture.url!==tab.url) throw new Error('The source page changed. Read it again.');
    if (new Blob([capture.html]).size > 1500000) throw new Error('This page is too large. Choose a smaller part.');
    capture.loadingIncomplete=prepared?.result?.loadingIncomplete===true;
    capture.images = capture.images.filter(p => { try { p.url = publicImageUrl(p.url); p.alternatives = (p.alternatives||[]).map(u => new URL(u,capture.url).href).filter(u => {try {publicImageUrl(u);return true;}catch{return false;}}); return true; } catch { return false; } });
    return capture;
}
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
    $('manual-open').hidden=false;
    status('Loading article photos… Scrolling the original page, then restoring its position.');
    savedRule=(await chrome.storage.local.get(ruleKey(tab.url)))[ruleKey(tab.url)];
    let capture;
    try {capture=await readPart(tab,savedRule);}
    catch(e){if(!savedRule || !e.message.includes('website layout changed'))throw e;
      capture=await readPart(tab,null);capture.rangeNotice='Saved range did not match. Review the full page or choose new boundaries.';}
    currentRule=null;proposal=null;
    job = {id:crypto.randomUUID(),extensionVersion,capture,sourceTab,destination:savedConnection?.destination || 'recipe',selected:capture.images.map((_,i)=>i),uploaded:[],failed:[],started:false};
    status(capture.rangeNotice || (savedRule?'Saved website range applied. Review the sections.':'Ready to import.'));
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
    return {base64:await base64(blob),mime:blob.type,width:bitmap.width,height:bitmap.height,method:converted?'converted':'original'};
  } finally { bitmap.close(); }
}
async function getPhoto(photo, captureJob = job) {
  let failure; const started=Date.now(), urls=[...new Set([photo.url,...photo.alternatives])].slice(0,6);
  for (const url of urls) {
    if(Date.now()-started>=30000)break;
    try {
      const data=await normalizedPhoto(await fetchPhoto(url,fetch,Math.min(10000,30000-(Date.now()-started))));
      if(photo.fullSize && photo.fullSize!==url && Math.min(data.width,data.height)<400){
        try { const larger=await normalizedPhoto(await fetchPhoto(publicImageUrl(photo.fullSize),fetch,6500));
          if(larger.width>=data.width && larger.height>=data.height && larger.width*larger.height>data.width*data.height)return {...larger,upgraded:true};
        }catch { /* Keep the readable version. */ }
      }
      return data;
    } catch (e) { failure = e; }
  }
  try {
    const source = await chrome.tabs.get(captureJob.sourceTab);
    const current = new URL(source.url), captured = new URL(photo.pageUrl || captureJob.capture.url); current.hash = ''; captured.hash = '';
    if (current.href !== captured.href) throw new Error('The source tab has navigated away from this article.');
    for (const url of urls) {
      if(Date.now()-started>=50000)break;
      if (new URL(url).origin !== captured.origin) continue;
      const [pageResult] = await chrome.scripting.executeScript({target:{tabId:captureJob.sourceTab},func:pagePhoto,args:[url,captured.href,Math.min(10000,50000-(Date.now()-started))]});
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
async function importRecipe(allowMissing=false, replacement=null) {
  if (busy || capturing || !job || (manualPage && !job.started && $('import').disabled)) return;
  busy = true; clearError(); $('import').disabled = true; $('resume').disabled = true;
  try {
    await navigator.locks.request('recipe-intelligence-import',{ifAvailable:true},async lock => {
      if (!lock) throw new Error('Another capture tab is importing. Let it finish first.');
      // Persist even when the app is offline, before trying any connection.
      if(manualPage && !job.started){
        const key=manualKey(job.capture.url);
        await navigator.locks.request(key,async()=>{
          const latest=(await chrome.storage.local.get(key))[key];
          if(!latest || latest.id!==job.id || latest.manualRevision!==job.manualRevision || latest.started)
            throw new Error('This draft changed in another tab. Reload before importing.');
          job.pending=true;
          await save();
        });
      }else{job.pending = true; await save();}
      status('Connecting to your workspace…'); await findApp();
      if (job.workspaceRoot && job.workspaceRoot !== app.root) throw new Error('This capture belongs to another storage folder. Open the original workspace to resume it.');
      if (job.destination === 'home-decor' && !app.decorBrowserCapture) throw new Error('Update the app to support Home & Decor browser imports. This article has not been sent to the recipe importer.');
      if (job.destination === 'home-decor' && !app.photoSectionLinks) throw new Error('Update the app to preserve photo-to-heading links before importing. Your capture has been kept.');
      if(!app.captureReview)throw new Error('Update the app before using this extension version. Photo retries and capture-limit reporting need the latest backend. Your capture has been kept.');
      // Save before the first request, so any interrupted import can be resumed.
      job.started = true; job.workspaceRoot = app.root; await save(); render(); $('import').disabled = true;
      const destination = job.destination || 'recipe';
      let imported = await bridge(app,{op:'begin',destination,data:{captureId:job.id,url:job.capture.url,html:job.capture.html,captureReport:{textTruncated:!!job.capture.truncated,imageLimitReached:!!job.capture.imageLimitReached,loadingIncomplete:!!job.capture.loadingIncomplete}}});
      job.serverWarnings=imported.captureWarnings || imported.warnings || [];
      if (imported.status === 'capturing') {
        job.uploaded = job.selected.filter(index => job.uploaded.includes(index) || imported.uploadedUrls?.includes(job.capture.images[index].url) || imported.photos.some(p => p.state === 'ready' && p.source_url === job.capture.images[index].url));
        if(!allowMissing)job.failed = replacement ? job.failed.filter(f=>f.index!==replacement.index) : [];
        for (const index of job.selected) {
          if (job.uploaded.includes(index)) continue;
          if (replacement && job.failed.some(f=>f.index===index)) continue;
          if(allowMissing && job.failed.some(f=>f.index===index))continue;
          status(`Importing photo ${job.selected.indexOf(index)+1} of ${job.selected.length}…`);
          const photo = job.capture.images[index]; let data;
          const fromFile = replacement?.index === index;
          try { data = fromFile ? await normalizedPhoto(replacement.file) : await readablePhoto(photo); } catch (e) { job.failed.push({index,message:e.message}); await save(); continue; }
          try {
            await bridge(app,{op:'photo',destination,id:job.id,...data,url:photo.url,caption:photo.caption,name:`Photo ${index+1}`}); job.uploaded.push(index); (job.photoMethods ||= {})[index]=data.method || 'original';
            if (fromFile) (job.fileCopies ||= {})[index] = true;
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
const draftKey=url=>'captureDraft:'+new URL(url).origin;
async function openManual() {
  const tab=await chrome.tabs.get(sourceTab);
  const page=CaptureHelpers.articleAddress(tab.url), key=manualKey(page);
  // Seed the editor with the current reviewed capture, including its selection.
  if (job && !job.started && CaptureHelpers.articleAddress(job.capture.url)===page) {
    await navigator.locks.request(key,async()=>{
      if (!(await chrome.storage.local.get(key))[key]) {
        const seed={...job,id:crypto.randomUUID(),manualRevision:0};
        await chrome.storage.local.set({[key]:seed});
      }
    });
  }
  await CaptureHelpers.openManualReview(tab,page);
}
$('manual-open').onclick=()=>void openManual().catch(showError);
function manualSections(selected) {
  const select=$('manual-section');
  select.replaceChildren(new Option('Article introduction','0'));
  const {sections}=CaptureHelpers.sectionsOf(job.capture);
  for(const [i,s] of sections.entries()) if(i) select.add(new Option(s.heading,String(i)));
  select.add(new Option('Add a new heading…','new'));
  select.value=String(selected ?? 0);
  $('manual-heading').hidden=select.value!=='new';
}
function manualControls() {
  $('manual-add-photos').disabled=busy||capturing||!!job?.started;
  const photo=$('manual-kind').value==='image';
  $('manual-recipe-tip').hidden=photo || job?.destination!=='recipe';
  $('manual-label').textContent=photo?'Photo URL':'Article text';
  $('manual-value').placeholder=photo?'https://…':'Paste the selected paragraphs here';
  $('manual-add').disabled=busy||capturing||!$('manual-value').value.trim();
  $('manual-discard').disabled=busy||capturing;
  for(const id of ['manual-section','manual-title','manual-heading','manual-kind','manual-value'])$(id).disabled=busy||capturing;
  $('import').disabled=busy||capturing||!!manualItem||!!$('manual-value').value.trim()||job?.capture.hasArticleText===false||!job||job.capture.text.length<40||$('manual-title').value.trim()!==job.capture.title;
}
async function manualPreview() {
  const version=++previewVersion;
  $('manual-photo').hidden=true;
  if($('manual-kind').value!=='image'||!$('manual-value').value.trim())return;
  try{
    const url=publicImageUrl($('manual-value').value.trim());
    const data=await readablePhoto({url,alternatives:[]});
    if(version!==previewVersion)return;
    $('manual-photo').src='data:'+data.mime+';base64,'+data.base64;
    $('manual-photo').hidden=false;
  }catch(e){if(version===previewVersion)$('manual-notice').textContent='Photo preview unavailable. '+e.message;}
}
async function addAllArticlePhotos() {
  if(!job || job.started || busy || capturing)return;
  const priorSection=$('manual-section').value;
  const priorHeadings=CaptureHelpers.sectionsOf(job.capture).sections;
  capturing=true;clearError();manualControls();
  $('manual-notice').textContent='Reading photos from the original article…';
  try{
    const tab=await chrome.tabs.get(sourceTab);
    if(CaptureHelpers.articleAddress(tab.url)!==CaptureHelpers.articleAddress(job.capture.url))
      throw new Error('Reopen this article in its original tab before adding photos.');
    const source=await readPart(tab,null,true);
    if(!source.images.length)throw new Error('No article photos found. Open the article, let the photos load and try again.');
    const key=manualKey(job.capture.url);
    await navigator.locks.request(key,async()=>{
      const latest=(await chrome.storage.local.get(key))[key];
      if(latest && (latest.id!==job.id || latest.manualRevision!==job.manualRevision || latest.started || latest.pending && !job.pending))
        throw new Error('This draft changed in another tab. Reload to see the latest version.');
      const capture=CaptureHelpers.addArticlePhotos(job.capture,source,$('manual-title').value);
      const wanted=new Set(source.images.map(p=>p.url));
      const selected=capture.images.flatMap((p,i)=>wanted.has(p.url)||job.selected.includes(i)?[i]:[]);
      const updated={...job,capture,selected,manualRevision:(job.manualRevision||0)+1};
      await chrome.storage.local.set({[key]:updated});job=updated;
    });
    $('manual-title').value=job.capture.title;
    let choice=priorSection;
    if(Number(priorSection)>0){
      const label=priorHeadings[Number(priorSection)].heading;
      const occurrence=priorHeadings.slice(1,Number(priorSection)).filter(s=>s.heading===label).length;
      choice=CaptureHelpers.sectionsOf(job.capture).sections.flatMap((s,i)=>s.heading===label?[i]:[])[occurrence];
    }
    manualSections(choice);
    $('manual-notice').textContent=source.images.length+' article photos selected in the draft.'+
      (source.loadingIncomplete||source.imageLimitReached?' Capture was partial. Review the warnings below.':'');
  }catch(e){$('manual-notice').textContent='Photos were not added.';showError(e);}
  finally{capturing=false;render();}
}
async function nextManualItem() {
  if(manualLoading||manualItem||!manualPage||!job||job.started||$('manual-value').value.trim())return;
  manualLoading=true;
  try{
    const items=Object.entries(await chrome.storage.session.get(null))
      .filter(([k,v])=>k.startsWith('manualItem:')&&v.sourceTab===sourceTab&&v.page===CaptureHelpers.articleAddress(job.capture.url))
      .sort((a,b)=>a[1].time-b[1].time);
    if(!items.length||$('manual-value').value.trim())return;
    const [key,item]=items[0];
    manualItem=key;
    $('manual-kind').value=item.kind;
    $('manual-value').value=item.value||'';
    $('manual-notice').textContent=item.error||'Review the selection and choose its section.';
    manualControls();void manualPreview();
  }finally{manualLoading=false;}
}
async function finishManual(add) {
  if(busy||capturing||!job||job.started)return;
  clearError();capturing=true;manualControls();
  const key=manualKey(job.capture.url);
  try{
    let section=$('manual-section').value;
    if(add){
      await navigator.locks.request(key,async()=>{
        const latest=(await chrome.storage.local.get(key))[key];
        if(latest && (latest.started || latest.pending && !job.pending || latest.id!==job.id || latest.manualRevision!==job.manualRevision))
          throw new Error('This draft changed in another tab. Reload to review the latest version.');
        // A pending menu item may be replayed if the browser closed immediately after saving.
        if(manualItem && latest?.lastManualItem===manualItem)return;
        const next=CaptureHelpers.addManualItem(job.capture,{title:$('manual-title').value,kind:$('manual-kind').value,recipe:job.destination==='recipe',
          value:$('manual-value').value,section:section==='new'?'new':Number(section),newHeading:$('manual-heading').value});
        const selected=new Set(job.selected);
        if($('manual-kind').value==='image')selected.add(next.images.findIndex(p=>p.url===publicImageUrl($('manual-value').value.trim())));
        const updated={...job,capture:next,selected:[...selected].sort((a,b)=>a-b),manualRevision:(job.manualRevision||0)+1,lastManualItem:manualItem};
        await chrome.storage.local.set({[key]:updated});
        job=updated;
      });
      if(section==='new')section=CaptureHelpers.sectionsOf(job.capture).sections.length-1;
      manualSections(section);
    }
    if(manualItem)await chrome.storage.session.remove(manualItem);
    manualItem=null;
    $('manual-value').value='';$('manual-heading').value='';
    $('manual-photo').hidden=true;previewVersion++;
    $('manual-notice').textContent=add?'Saved to this article draft.':'Selection cleared.';
  }catch(e){showError(e);}finally{capturing=false;render();manualControls();}
  await nextManualItem();
}
async function initManual(saved) {
  const page=CaptureHelpers.articleAddress(new URLSearchParams(location.search).get('article'));
  const key=manualKey(page);
  const tab=await chrome.tabs.get(sourceTab).catch(()=>null);
  const existing=(await chrome.storage.local.get(key))[key];
  const title=tab?.url?.split('#')[0]===page ? tab.title || '' : '';
  job=existing?{...existing,sourceTab}:{id:crypto.randomUUID(),sourceTab,extensionVersion,destination:saved?.destination||'recipe',
    selected:[],uploaded:[],failed:[],manualRevision:0,capture:{url:page,title:title.slice(0,300),html:'<html><head></head><body><article><h1></h1></article></body></html>',
      text:'',words:0,images:[],hasArticleText:false}};
  $('manual-title').value=job.capture.title;
  manualSections();render();manualControls();
  if(job.started){render();status(job.done?'This draft was imported.':'Resume this import.');return;}
  status('Review your manual draft before saving it to the app.');
  $('manual-section').onchange=()=>{$('manual-heading').hidden=$('manual-section').value!=='new';};
  $('manual-title').oninput=manualControls;
  $('manual-kind').onchange=()=>{manualControls();void manualPreview();};
  $('manual-value').oninput=()=>{previewVersion++;$('manual-photo').hidden=true;manualControls();};
  $('manual-value').onchange=()=>void manualPreview();
  $('manual-add').onclick=()=>void finishManual(true).catch(showError);
  $('manual-add-photos').onclick=()=>void addAllArticlePhotos().catch(showError);
  $('manual-discard').onclick=()=>void finishManual(false).catch(showError);
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='session'&&Object.keys(changes).some(k=>k.startsWith('manualItem:')))void nextManualItem().catch(showError);
  });
  await nextManualItem();
}
async function reviewPart(highlighted) {
  if(!job || job.started || capturing || busy)return;
  capturing=true; clearError(); proposal=null; render();
  try {
    const tab=await chrome.tabs.get(sourceTab);
    if(new URL(tab.url).origin!==new URL(job.capture.url).origin)throw new Error('Use the same website for all parts of this article.');
    let rule=savedRule;
    if(highlighted){
      await chrome.scripting.executeScript({target:{tabId:sourceTab},files:['page-tools.js']});
      const [picked]=await chrome.scripting.executeScript({target:{tabId:sourceTab},func:()=>globalThis.RecipeCapturePage.selectionRule()});
      rule=picked.result;
    }
    const part=await readPart(tab,rule);
    const replace=highlighted && !job.multipart && tab.url===job.capture.url;
    const merged=replace?{capture:part}:CaptureHelpers.mergePart(job.capture,part);
    const delta=merged.capture.images.length-job.capture.images.length;
    proposal={capture:merged.capture,rule:highlighted?rule:null,replace};
    $('part-description').textContent=(replace?'Replace the current capture with the highlighted range':merged.added||delta?'Merge this part':'Already captured')+
      ' · '+part.title+' · '+merged.capture.words+' words · '+merged.capture.images.length+' photos total ('+(delta>=0?'+':'')+delta+'). Review the section list below.';
    status('Review the changes, then apply them to your draft.');
  }catch(e){showError(e);}finally{capturing=false;render();}
}
$('append').onclick=()=>void reviewPart(false);
$('range').onclick=()=>void reviewPart(true);
$('accept-part').onclick=async()=>{
  if(!proposal || busy || capturing)return;
  const next=proposal.capture;
  const skipped=new Set(job.capture.images.filter((_,i)=>!job.selected.includes(i)).map(p=>p.url));
  const updated={...job,capture:next,multipart:job.multipart||!proposal.replace,
    selected:next.images.flatMap((photo,i)=>skipped.has(photo.url)?[]:[i])};
  const rule=proposal.rule;
  capturing=true;render();
  try{
    await chrome.storage.local.set({[draftKey(updated.capture.url)]:updated});
    job=updated;currentRule=rule;proposal=null;photoPage=0;status('Draft saved. Add another part or save to the app.');
  }catch(e){showError(e);}finally{capturing=false;render();}
};
$('discard-part').onclick=()=>{proposal=null;status('Current draft kept.');render();};
$('keep').onclick=()=>chrome.storage.local.set({[draftKey(job.capture.url)]:job}).then(()=>status('Draft saved for this website. Open the next part and click Add part.')).catch(showError);
$('remember').onclick=async()=>{
  try{await chrome.storage.local.set({[ruleKey(job.capture.url)]:currentRule});savedRule=currentRule;status('Range remembered for this website.');render();}catch(e){showError(e);}
};
$('forget').onclick=async()=>{
  try{await chrome.storage.local.remove(ruleKey(job.capture.url));savedRule=null;status('Website range forgotten.');render();}catch(e){showError(e);}
};
$('retry').onclick = () => void capturePage();
$('source').onclick = async event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  try {
    const tab = await chrome.tabs.get(sourceTab);
    await chrome.tabs.update(tab.id, {active:true});
    if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId,{focused:true});
  } catch { showError(new Error('The original tab is no longer open. Open the article again and click the extension there.')); }
};
$('open').onclick = () => void openEstimate().catch(showError);
$('resume').onclick = () => { if(busy||capturing)return;job = previous;photoPage=0;render(); $('resume').hidden = true; status('Previous capture restored. Click Resume saving or Retry missing photos to continue.'); };
(async () => {
  previous = (await chrome.storage.local.get('lastCapture')).lastCapture;
  if (previous?.capture && (previous.started || previous.pending) && !previous.done) $('resume').hidden = false;
  const saved=await connection.readSaved(); if (saved) $('app-url').value=saved.origin;
  if(manualPage){
    $('resume').hidden=true;
    try{await initManual(saved);}catch(e){showError(e);status('Manual draft needs your attention.');}
    if(job)await findApp({allowOpen:false}).catch(()=>{});
    return;
  }
  await capturePage();
  const key=job && draftKey(job.capture.url);
  const draft=key && (await chrome.storage.local.get(key))[key];
  if(draft && job && new URL(draft.capture.url).origin===new URL(job.capture.url).origin && previous?.id!==draft.id){
    const restore=document.createElement('button');restore.textContent='Restore draft · '+draft.capture.title;
    restore.className='secondary';$('parts').prepend(restore);
    restore.onclick=()=>{if(busy||capturing||job.started)return;job={...draft,sourceTab};currentRule=null;proposal=null;photoPage=0;restore.remove();render();status('Draft restored. Add the next part or save to the app.');};
  }
  if (!app) await findApp({allowOpen:false}).catch(()=>{});
})();
