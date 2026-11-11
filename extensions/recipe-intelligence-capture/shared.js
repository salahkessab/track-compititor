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

  // Executed only in a discovered loopback app tab. It uses that tab's existing
  // HttpOnly session, leaving authentication and CSRF checks unchanged.
  async function appBridge(message) {
    if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1' || location.origin !== message.origin) return { error: 'The local app tab changed. Reopen Recipe Intelligence.', status: 409 };
    const uuid = /^[a-f0-9-]{36}$/i;
    async function api(route, method = 'GET', data, headers = {}) {
      const response = await fetch(`/api/recipe-intelligence/${route}`, { method, credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(message.op === 'probe' ? 3000 : 45000), headers:{'X-Recipe-Intelligence':'1', ...(data instanceof Uint8Array ? {} : {'Content-Type':'application/json'}), ...headers}, ...(data === undefined ? {} : {body:data instanceof Uint8Array ? data : JSON.stringify(data)}) });
      const result = await response.json();
      if (!response.ok) { const error = new Error(result.error || 'The local app could not finish this request.'); error.status = response.status; throw error; }
      return result;
    }
    try {
      if (message.op === 'probe') {
        const capability = await api('capabilities');
        if (!capability.enabled || capability.browserCapture !== 1) return {error:'This local app needs the browser capture update.',status:409};
        const snapshot = await api('snapshot'); return { ready:true, root:snapshot.settings.root };
      }
      if (message.op === 'begin') return await api('imports/browser', 'POST', message.data);
      if (!uuid.test(message.id || '')) throw new Error('Invalid import ID.');
      if (message.op === 'photo') {
        if (message.base64.length > 14000000) throw new Error('Photo exceeds the transfer limit.');
        const bytes = Uint8Array.from(atob(message.base64), c => c.charCodeAt(0));
        return await api(`imports/${message.id}/browser-photo`, 'POST', bytes, {'Content-Type':message.mime,'X-File-Name':message.name,'X-Source-Url':encodeURIComponent(message.url),'X-Photo-Caption':encodeURIComponent(message.caption || '')});
      }
      if (message.op === 'finish') return await api(`imports/${message.id}/browser-finish`, 'POST', {missingPhotos:message.missingPhotos});
      if (message.op === 'estimate') return await api(`imports/${message.id}/estimate`, 'POST', {});
      throw new Error('Unsupported import operation.');
    } catch (error) { return { error:error.message || 'The local workspace is unavailable.', status:error.status || 0 }; }
  }

  // Use already decoded pixels only when the normal canvas security rules allow
  // it. Cross-origin tainted canvases fail; no browser security is bypassed.
  function renderedPhoto(urls) {
    for (const img of document.images) {
      if (![img.currentSrc,img.src,img.dataset.src,img.dataset.lazySrc].some(url => urls.includes(url)) || !img.complete || img.naturalWidth < 160 || img.naturalHeight < 120) continue;
      try {
        const canvas = document.createElement('canvas'); const scale = Math.min(1, 4096 / Math.max(img.naturalWidth,img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        return canvas.toDataURL('image/jpeg', .94).split(',')[1];
      } catch { /* Chrome does not permit pixel access to this image. */ }
    }
    return null;
  }

  async function fetchPhoto(url, fetcher = fetch) {
    publicImageUrl(url);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
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
  const helpers = {publicImageUrl,appBridge,renderedPhoto,fetchPhoto};
  root.CaptureHelpers = helpers;
  if (typeof module !== 'undefined') module.exports = helpers;
})(globalThis);
