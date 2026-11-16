(function (scope) {
  const STORAGE_KEY = 'recipeIntelligenceConnection';
  function appOrigin(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Use your HTTPS Recipe Intelligence address or its local loopback address.'); }
    const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
    const cloud = url.protocol === 'https:' && url.hostname.includes('.') && !/^\d+[.\d]*$/.test(url.hostname) && !/(^|\.)(localhost|local|internal|lan|home)$/.test(url.hostname);
    if ((!local && !cloud) || url.username || url.password) {
      throw new Error('Use the secure HTTPS app address or http://127.0.0.1 for a local workspace.');
    }
    // Never retain a launch token, query string, or credentials from a pasted URL.
    return url.origin;
  }
  const appUrl = origin => `${appOrigin(origin)}/?tab=recipe-intelligence`;
  function createConnection(browser, bridgeFunction, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    let saved = null, loaded = false;
    async function readSaved() {
      if (!loaded) {
        const candidate = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
        try { if (candidate && typeof candidate.root === 'string' && candidate.root.length <= 4096) saved = {origin:appOrigin(candidate.origin),root:candidate.root,...(['recipe','home-decor'].includes(candidate.destination)?{destination:candidate.destination}:{})}; } catch { /* Ignore invalid old settings. */ }
        loaded = true;
      }
      return saved;
    }
    async function bridge(target, message) {
      const origin = appOrigin(target.origin);
      const [injection] = await browser.scripting.executeScript({target:{tabId:target.id},world:'ISOLATED',func:bridgeFunction,args:[{...message,origin}]});
      const result = injection?.result;
      if (!result || result.error) {
        const error = new Error(result?.status === 401
          ? 'Your session expired. Sign in to the cloud app, or reopen the local app with the desktop shortcut in this Chrome profile, then reconnect. Your capture is saved.'
          : result?.error || 'The app tab is unavailable. Reconnect to resume your saved capture.');
        error.status = result?.status || 0; throw error;
      }
      return result;
    }
    async function probe(tab) {
      const origin = appOrigin(tab.url);
      const result = await bridge({id:tab.id,origin},{op:'probe'});
      if (result.ready !== true || typeof result.root !== 'string' || !result.root || result.root.length > 4096) throw new Error('This tab is not a connected Recipe Intelligence workspace.');
      return {id:tab.id,origin,root:result.root,...(['recipe','home-decor'].includes(result.destination)?{destination:result.destination}:{}),decorBrowserCapture:result.decorBrowserCapture === true};
    }
    async function scan(requested) {
      const tabs = await browser.tabs.query({url:['http://127.0.0.1/*','https://*/*']});
      const seen = new Set(), candidates = [];
      for (const tab of tabs) {
        try {
          const origin = appOrigin(tab.url), url = new URL(tab.url);
          const appTab = url.hostname === '127.0.0.1' || origin === requested || origin === saved?.origin || ['recipe-intelligence','home-decor'].includes(url.searchParams.get('tab'));
          if (appTab && !seen.has(origin) && Number.isInteger(tab.id)) { seen.add(origin); candidates.push(tab); }
        } catch { /* Unrelated tab. */ }
      }
      const results = await Promise.allSettled(candidates.slice(0,12).map(probe));
      return {ready:results.filter(r=>r.status==='fulfilled').map(r=>r.value), errors:results.filter(r=>r.status==='rejected').map(r=>r.reason)};
    }
    async function remember(target) {
      const next = {origin:appOrigin(target.origin),root:target.root,...(target.destination?{destination:target.destination}:{})};
      await browser.storage.local.set({[STORAGE_KEY]:next}); saved = next; loaded = true;
      return target;
    }
    async function connect({root,origin,allowOpen=true}={}) {
      await readSaved();
      const requested = origin ? appOrigin(origin) : null;
      const expectedRoot = root || (!requested ? saved?.root : null);
      const found = await scan(requested);
      const eligible = found.ready.filter(t=>(!expectedRoot || t.root===expectedRoot) && (!requested || t.origin===requested));
      const preferred = eligible.find(t=>t.origin===(requested || saved?.origin));
      if (preferred || eligible.length===1) return remember(preferred || eligible[0]);
      if (eligible.length>1) {
        const error = new Error('More than one workspace is open. Choose where to save this article.'); error.targets=eligible; throw error;
      }
      const restoreOrigin = requested || saved?.origin;
      const existing = restoreOrigin && found.ready.find(t=>t.origin===restoreOrigin);
      if (existing && expectedRoot && existing.root!==expectedRoot) throw new Error('This address now opens a different storage folder. Open the original workspace to resume this capture.');
      if (allowOpen && restoreOrigin) {
        // Reopen only a saved/entered address. Never scan ports or carry session secrets.
        const tabs = await browser.tabs.query({url:restoreOrigin+'/*'});
        let tab = tabs.find(t=>{try{return appOrigin(t.url)===restoreOrigin;}catch{return false;}});
        if (!tab) tab = await browser.tabs.create({url:appUrl(restoreOrigin),active:false});
        let failure;
        for (let attempt=0;attempt<8;attempt++) {
          try {
            const target = await probe({...tab,url:appUrl(restoreOrigin)});
            if (expectedRoot && target.root!==expectedRoot) throw Object.assign(new Error('This capture belongs to a different storage folder. Open its original workspace.'),{wrongWorkspace:true});
            return remember(target);
          } catch (error) {
            failure=error;
            if (error.status===401 || error.wrongWorkspace) throw error;
            if (attempt<7) await wait(350);
          }
        }
        throw new Error(`Could not reconnect to ${restoreOrigin}. Start Recipe Intelligence at its cloud address or with the desktop shortcut, then reconnect. Your capture is saved.${failure?.status===409 ? ' The app may need an update.' : ''}`);
      }
      const error = found.errors.find(e=>e.status===401);
      if (error) throw error;
      const failure = new Error(expectedRoot
        ? 'Open your saved workspace, then reconnect. The app will not switch workspaces automatically.'
        : 'Open Recipe Intelligence in this Chrome profile, or enter its HTTPS address in Connection settings, then click Connect.');
      failure.targets=found.ready; throw failure;
    }
    async function focus(target, destination=appUrl(target.origin)) {
      if (appOrigin(destination)!==appOrigin(target.origin)) throw new Error('The destination does not match the connected app.');
      let existing;
      try { existing=await browser.tabs.get(target.id); } catch { /* Closed tab. */ }
      let same=false;try{same=appOrigin(existing?.url)===target.origin;}catch{}
      const tab = same ? await browser.tabs.update(target.id,{url:destination,active:true}) : await browser.tabs.create({url:destination,active:true});
      const windowId = tab.windowId ?? (await browser.tabs.get(tab.id)).windowId;
      const window = await browser.windows.get(windowId);
      await browser.windows.update(windowId,{focused:true,...(window.state==='minimized'?{state:'normal'}:{})});
      return tab;
    }
    return {readSaved,bridge,connect,focus};
  }
  scope.CaptureConnection = {appOrigin,appUrl,createConnection};
  if (typeof module!=='undefined') module.exports=scope.CaptureConnection;
})(globalThis);
