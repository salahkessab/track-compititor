(function (root) {
  function publicImageUrl(raw) {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.href.length > 4096 || !host.includes('.') || host.includes(':') || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)) throw new Error('Only public HTTP(S) pages and images can be captured.');
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a,b] = host.split('.').map(Number);
      if ([0,10,127].includes(a) || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0,168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18,19].includes(b)) throw new Error('Private network images are not imported.');
    }
    return url.href;
  }

  // Executed only in a discovered app tab. It uses that tab's existing
  // HttpOnly session, leaving authentication and CSRF checks unchanged.
  async function appBridge(message) {
    if (!(location.protocol === 'https:' || location.protocol === 'http:' && location.hostname === '127.0.0.1') || location.origin !== message.origin) return { error: 'The app tab changed. Reopen Recipe Intelligence.', status: 409 };
    const uuid = /^[a-f0-9-]{36}$/i;
    async function api(route, method = 'GET', data, headers = {}) {
      const response = await fetch(`/api/recipe-intelligence/${route}`, { method, credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(message.op === 'probe' ? 3000 : 45000), headers:{'X-Recipe-Intelligence':'1', ...(data instanceof Uint8Array ? {} : {'Content-Type':'application/json'}), ...headers}, ...(data === undefined ? {} : {body:data instanceof Uint8Array ? data : JSON.stringify(data)}) });
      const result = await response.json().catch(() => ({error:response.status===401 ? 'Sign in to Recipe Intelligence in this browser profile.' : 'The app did not return a valid response.'}));
      if (!response.ok) { const error = new Error(result.error || 'The local app could not finish this request.'); error.status = response.status; throw error; }
      return result;
    }
    try {
      if (message.op === 'probe') {
        const capability = await api('capabilities');
        if (!capability.enabled || capability.browserCapture !== 1) return {error:'This local app needs the browser capture update.',status:409};
        const snapshot = await api('snapshot'); return { ready:true, root:snapshot.runtime === 'server' ? `workspace:${snapshot.settings.workspaceId}` : snapshot.settings.root,
          destination:new URLSearchParams(location.search).get('tab') === 'home-decor' ? 'home-decor' : 'recipe', decorBrowserCapture:capability.decorBrowserCapture === 1, captureReview:capability.captureReview===1, photoSectionLinks:capability.photoSectionLinks===1 };
      }
      const destination = message.destination || 'recipe';
      if (!['recipe','home-decor'].includes(destination)) throw new Error('Choose Recipes or Home & Decor.');
      const prefix = destination === 'home-decor' ? 'decor' : 'imports';
      if (message.op === 'begin') return await api(`${prefix}/browser`, 'POST', message.data);
      if (!uuid.test(message.id || '')) throw new Error('Invalid import ID.');
      if (message.op === 'photo') {
        if (message.base64.length > 14000000) throw new Error('Photo exceeds the transfer limit.');
        const bytes = Uint8Array.from(atob(message.base64), c => c.charCodeAt(0));
        return await api(`${prefix}/${message.id}/browser-photo`, 'POST', bytes, {'Content-Type':message.mime,'X-File-Name':message.name,'X-Source-Url':encodeURIComponent(message.url),'X-Photo-Caption':encodeURIComponent(message.caption || '')});
      }
      if (message.op === 'finish') return await api(`${prefix}/${message.id}/browser-finish`, 'POST', {missingPhotos:message.missingPhotos,acceptPartial:message.acceptPartial===true,derivedPhotos:message.derivedPhotos||0});
      if (message.op === 'estimate' && destination === 'recipe') return await api(`imports/${message.id}/estimate`, 'POST', {});
      throw new Error('Unsupported import operation.');
    } catch (error) { return { error:error.message || 'The local workspace is unavailable.', status:error.status || 0 }; }
  }

  // Use already decoded pixels only when the normal canvas security rules allow
  // it. Cross-origin tainted canvases fail; no browser security is bypassed.
  function renderedPhoto(urls) {
    for (const img of document.images) {
      // data-src describes a future image, not the pixels currently decoded.
      // A transparent lazy placeholder can have the full photograph's dimensions.
      if (!urls.includes(img.currentSrc || img.src) || !img.complete || img.naturalWidth < 160 || img.naturalHeight < 120) continue;
      try {
        const canvas = document.createElement('canvas'); const scale = Math.min(1, 4096 / Math.max(img.naturalWidth,img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        const sample = document.createElement('canvas'); sample.width = 64; sample.height = 64;
        const ctx = sample.getContext('2d'); ctx.drawImage(canvas, 0, 0, 64, 64);
        const pixels = ctx.getImageData(0, 0, 64, 64).data;
        let useful = false;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i+3] > 8 && (pixels[i] > 2 || pixels[i+1] > 2 || pixels[i+2] > 2)) { useful = true; break; }
        if (!useful) continue;
        return canvas.toDataURL('image/jpeg', .94).split(',')[1];
      } catch { /* Chrome does not permit pixel access to this image. */ }
    }
    return null;
  }

  // Serialized into the original tab: use its ordinary same-origin request
  // context, without transferring cookies or bypassing CORS/access challenges.
  async function pagePhoto(url, pageUrl, timeoutMs=15000) {
    const current = new URL(location.href), captured = new URL(pageUrl);
    current.hash = ''; captured.hash = '';
    if (current.href !== captured.href) return null;
    const target = new URL(url);
    if (target.origin !== current.origin || target.username || target.password || !/^https?:$/.test(target.protocol)) return null;
    const present = [...document.images].some(img =>
      [img.currentSrc, img.src, img.getAttribute('data-src'), img.getAttribute('data-lazy-src'),
        ...(img.getAttribute('srcset') || '').split(',').map(part => part.trim().split(/\s+/)[0])]
        .filter(Boolean).some(value => { try { return new URL(value, location.href).href === target.href; } catch { return false; } }));
    if (!present) return null;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(100,Math.min(15000,timeoutMs)));
    try {
      const response = await fetch(target.href, {credentials:'same-origin', mode:'same-origin', redirect:'error', signal:controller.signal});
      if (!response.ok) return null;
      const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!mime.startsWith('image/') || Number(response.headers.get('content-length')) > 10485760) return null;
      const reader = response.body?.getReader(); if (!reader) return null;
      const chunks = []; let size = 0;
      try {
        while (true) {
          const {done,value} = await reader.read(); if (done) break;
          size += value.length; if (size > 10485760) return null;
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!size) return null;
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return {base64:btoa(binary), mime};
    } catch { return null; } finally { clearTimeout(timer); }
  }

  async function fetchPhoto(url, fetcher = fetch, timeoutMs=25000) {
    publicImageUrl(url);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(100,Math.min(25000,timeoutMs)));
    const maximum = 10 * 1024 * 1024;
    try {
      const response = await fetcher(url, {credentials:'omit', referrerPolicy:'no-referrer', redirect:'error', signal:controller.signal});
      if (!response.ok) throw new Error(`Image returned HTTP ${response.status}.`);
      if (Number(response.headers.get('content-length')) > maximum) throw new Error('Image exceeds 10 MB.');
      const reader = response.body?.getReader(); if (!reader) throw new Error('Image is empty.');
      const chunks = []; let size = 0;
      try {
        while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > maximum) throw new Error('Image exceeds 10 MB.'); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); }
      if (!size) throw new Error('Image is empty.');
      return new Blob(chunks, {type:response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'});
    } finally { clearTimeout(timer); }
  }
  // Work only on the allow-listed HTML produced by content.js. Keep lists,
  // tables and inline formatting together when combining article sections.
  function sectionsOf(capture) {
    const doc = new DOMParser().parseFromString(capture.html,'text/html');
    const sections = [{heading:'',tag:'',blocks:[]}];
    function visit(node) {
      if (node.nodeType === 3 && !node.textContent.trim()) return;
      if (node.nodeType === 1) {
        if (node.matches('h1,script,style')) return;
        if (node.matches('h2,h3,h4,h5,h6')) {
          sections.push({heading:node.textContent.trim(),tag:node.localName,blocks:[]}); return;
        }
        if (node.localName === 'div') { node.childNodes.forEach(visit); return; }
      }
      sections.at(-1).blocks.push(node);
    }
    doc.querySelector('article')?.childNodes.forEach(visit);
    return {doc,sections};
  }
  function mergePart(base, part) {
    if (new URL(base.url).origin !== new URL(part.url).origin) throw new Error('Open the next part on the same website.');
    const {doc,sections} = sectionsOf(base), incoming=sectionsOf(part).sections;
    const blockKey = node => node.nodeType===3 ? node.textContent.trim() : node.outerHTML;
    const used = new Set();
    let added=0;
    for (const [position,section] of incoming.entries()) {
      if (!section.blocks.length && !section.heading) continue;
      const keys=section.blocks.map(blockKey);
      let target=sections.find(s=>!used.has(s) && s.heading===section.heading &&
        (base.url===part.url || (s.blocks.some(node=>keys.includes(blockKey(node))))));
      if (!target && !section.heading) target=sections.at(-1);
      if (!target) {
        const next=base.url===part.url && incoming.slice(position+1).map(later=>
          sections.find(s=>!used.has(s) && s.heading===later.heading)).find(Boolean);
        sections.splice(next?sections.indexOf(next):sections.length,0,section);
        used.add(section); added+=1+keys.length; continue;
      }
      used.add(target);
      const positions=new Map();
      target.blocks.forEach((block,i)=>{
        const key=blockKey(block);
        if(!positions.has(key))positions.set(key,[]);
        positions.get(key).push(i);
      });
      const combined=[], pending=[];
      let cursor=0;
      for (const [i,key] of keys.entries()) {
        const found=positions.get(key)?.find(index=>index>=cursor);
        if(found===undefined){pending.push(section.blocks[i]);added++;continue;}
        combined.push(...target.blocks.slice(cursor,found),...pending,target.blocks[found]);
        pending.length=0;cursor=found+1;
      }
      target.blocks=combined.concat(target.blocks.slice(cursor),pending);
    }
    const article=doc.querySelector('article'), title=doc.createElement('h1');title.textContent=base.title;
    article.replaceChildren(title);
    for (const section of sections) {
      if(section.tag){const h=doc.createElement(section.tag);h.textContent=section.heading;article.append(h);}
      for(const block of section.blocks)article.append(block);
    }
    const photos=new Map(base.images.map(p=>[p.url,p]));
    for(const p of part.images)if(!photos.has(p.url))photos.set(p.url,{...p,pageUrl:part.url});
    const images=[...photos.values()],html=doc.documentElement.outerHTML;
    const text=[base.title,...sections.flatMap(s=>[s.heading,...s.blocks.map(n=>n.textContent.trim())])].filter(Boolean).join('\n\n');
    if(images.length>80 || text.length>200000 || new Blob([html]).size>1500000)
      throw new Error('This part exceeds the capture limit. Use a smaller range or import it separately.');
    return {added,capture:{...base,html,text,words:text.split(/\s+/).length,images,discoveredPhotos:images.length,
      truncated:base.truncated||part.truncated,loadingIncomplete:base.loadingIncomplete||part.loadingIncomplete,
      imageLimitReached:base.imageLimitReached||part.imageLimitReached}};
  }
  function articleAddress(raw) {
    const url = new URL(publicImageUrl(raw));
    url.hash = '';
    return url.href;
  }

  // Import photo positions and heading identities from the source without copying its prose.
  function addArticlePhotos(base,source,title) {
    if(articleAddress(base.url)!==articleAddress(source.url))throw new Error('Reopen this article in the original tab.');
    const name=title.trim() || source.title;
    if(!name)throw new Error('Enter the article title first.');
    const {doc}=sectionsOf(base), article=doc.querySelector('article');
    article.querySelector('h1').textContent=name;doc.title=name;
    const headingSelector='h2,h3,h4,h5,h6';
    const sourceDoc=new DOMParser().parseFromString(source.html,'text/html');
    const sourceArticle=sourceDoc.querySelector('article');
    const sourceHeadings=[...sourceArticle.querySelectorAll(headingSelector)];
    const targetsByName=new Map();
    for(const h of article.querySelectorAll(headingSelector)){
      const key=h.textContent.trim();
      if(!targetsByName.has(key))targetsByName.set(key,[]);
      targetsByName.get(key).push(h);
    }
    const positions=new Map();
    const targets=sourceHeadings.map(h=>{
      const key=h.textContent.trim(), n=positions.get(key)||0;
      positions.set(key,n+1);
      return targetsByName.get(key)?.[n];
    });
    const locationByUrl=new Map();
    let index=-1;
    for(const node of sourceArticle.querySelectorAll(headingSelector+',img')){
      if(node.localName!=='img'){index++;continue;}
      const url=node.getAttribute('src');
      if(!locationByUrl.has(url))locationByUrl.set(url,index);
    }
    const images=[...base.images], known=new Set(images.map(p=>p.url));
    for(const photo of source.images){
      const url=publicImageUrl(photo.url);
      if(known.has(url))continue;
      const i=locationByUrl.get(url) ?? -1;
      if(i>=0 && !targets[i]){
        const newHeading=doc.createElement(sourceHeadings[i].localName);
        newHeading.textContent=sourceHeadings[i].textContent;
        const later=targets.slice(i+1).find(Boolean);
        if(later)later.before(newHeading);else article.append(newHeading);
        targets[i]=newHeading;
      }
      const headings=[...article.querySelectorAll(headingSelector)];
      const next=headings[i<0?0:headings.indexOf(targets[i])+1];
      const img=doc.createElement('img');img.setAttribute('src',url);img.alt=photo.caption||'';
      if(next)next.before(img);else article.append(img);
      images.push({...photo,url,sourceHeading:i<0?name:targets[i].textContent.trim()});known.add(url);
    }
    const html=doc.documentElement.outerHTML;
    if(images.length>80 || new Blob([html]).size>1500000)throw new Error('The combined draft exceeds the capture limit. Your draft was kept.');
    const {sections}=sectionsOf({html});
    const text=[name,...sections.flatMap(s=>[s.heading,...s.blocks.map(b=>b.textContent.trim())])].filter(Boolean).join('\n\n');
    if(text.length>200000)throw new Error('The combined draft exceeds the article text limit.');
    return {...base,title:name,html,text,words:text.split(/\s+/).length,images,
      hasArticleText:sections.some(s=>s.blocks.some(b=>b.textContent.trim())),
      discoveredPhotos:Math.max(images.length,source.discoveredPhotos||0,base.discoveredPhotos||0),
      loadingIncomplete:!!(source.loadingIncomplete||base.loadingIncomplete),imageLimitReached:!!(source.imageLimitReached||base.imageLimitReached)};
  }

  function addManualItem(base,{kind,value,title,section,newHeading,recipe=false}) {
    const doc = new DOMParser().parseFromString(base.html,'text/html');
    const article = doc.querySelector('article');
    const headings = [...article.querySelectorAll('h2,h3,h4,h5,h6')];
    const name = title.trim();
    if (!name || name.length > 300) throw new Error('Enter an article title up to 300 characters.');
    article.querySelector('h1').textContent = name;
    doc.title = name;
    let heading;
    if (section === 'new') {
      const label = newHeading.trim();
      if (!label || label.length > 300) throw new Error('Enter a section heading up to 300 characters.');
      heading = doc.createElement('h2');
      heading.textContent = label;
      article.append(heading);
    } else {
      if (!Number.isInteger(section) || section < 0 || section > headings.length) throw new Error('Choose a section.');
      heading = headings[section-1];
    }
    const before = headings[section];
    const insert = node => before ? before.before(node) : article.append(node);
    const images = base.images.map(p=>({...p}));
    if (kind === 'text') {
      if (!value.trim() || value.length > 200000) throw new Error('Enter article text up to 200,000 characters.');
      const listTag = label => {
        if(!recipe)return '';
        const key=label.trim().toLowerCase().replace(/:$/,'');
        if(['ingredients','ingredients list'].includes(key))return 'ul';
        if(['instructions','directions','method','steps','preparation'].includes(key))return 'ol';
        return '';
      };
      let tag=listTag(heading?.textContent || '');
      const prior=before?before.previousElementSibling:article.lastElementChild;
      let list=tag && prior?.localName===tag ? prior : null;
      for (const line of value.trim().split(/\r?\n+/).filter(l=>l.trim())) {
        const nextTag=listTag(line);
        if(nextTag){
          const label=doc.createElement('h2');label.textContent=line.trim();insert(label);
          tag=nextTag;list=null;continue;
        }
        const block=doc.createElement(tag?'li':'p');
        block.textContent=line.trim();
        if(tag){
          if(!list){list=doc.createElement(tag);insert(list);}
          list.append(block);
        }else insert(block);
      }
    } else if (kind === 'image') {
      const url = publicImageUrl(value.trim());
      const photo = images.find(p=>p.url===url);
      const sourceHeading = heading?.textContent || name;
      // Relinking a photo moves just that image. Its previous paragraph stays in place.
      for (const img of article.querySelectorAll('img')) if (img.getAttribute('src')===url) img.remove();
      if (photo) photo.sourceHeading = sourceHeading;
      else images.push({url,caption:'',sourceHeading,alternatives:[],pageUrl:base.url});
      const img = doc.createElement('img');
      img.setAttribute('src',url);
      img.alt = photo?.caption || '';
      insert(img);
    } else throw new Error('Choose text or photo.');
    const html = doc.documentElement.outerHTML;
    const {sections} = sectionsOf({html});
    const text = [name,...sections.flatMap(s=>[s.heading,...s.blocks.map(n=>n.textContent.trim())])].filter(Boolean).join('\n\n');
    if (images.length > 80 || text.length > 200000 || new Blob([html]).size > 1500000)
      throw new Error('The draft exceeds the article or photo limit. Choose a smaller selection.');
    const hasArticleText=sections.some(s=>s.blocks.some(b=>b.textContent.trim()));
    return {...base,title:name,html,text,hasArticleText,words:text.split(/\s+/).length,images,discoveredPhotos:images.length};
  }
  async function openManualReview(tab,page) {
    const url = chrome.runtime.getURL('capture.html?'+new URLSearchParams({sourceTab:tab.id,manual:'1',article:page}));
    await navigator.locks.request('manual-review:'+tab.id,async()=>{
      const contexts=()=>chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[url]});
      const [open]=await contexts();
      if(open){await chrome.tabs.update(open.tabId,{active:true});return;}
      await chrome.tabs.create({windowId:tab.windowId,url});
      // A second click can arrive while Chrome is still creating the review document.
      for(let attempt=0;attempt<20 && !(await contexts()).length;attempt++)
        await new Promise(resolve=>setTimeout(resolve,100));
    });
  }
  const helpers = {publicImageUrl,appBridge,renderedPhoto,pagePhoto,fetchPhoto,sectionsOf,mergePart,articleAddress,addManualItem,addArticlePhotos,openManualReview};
  root.CaptureHelpers = helpers;
  if (typeof module !== 'undefined') module.exports = helpers;
})(globalThis);
