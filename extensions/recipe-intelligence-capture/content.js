/* Runs once, only in the article tab selected by the user. Returns data, not code. */
(() => {
  const pageState=globalThis.RecipeCapturePage?.inspect();
  if(pageState?.blocked)return pageState;
  const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const excluded = 'script,style,noscript,nav,aside,footer,form,input,textarea,button,iframe,object,embed,[hidden],[aria-hidden="true"],[role="navigation"],[role="complementary"],.comments,#comments,.comment-list,.related,.related-posts,.related-recipes,.recommended,.author-box,.advertisement,.ad-container,.adsbygoogle,[class*="newsletter"],[class*="share-buttons"],[class*="social-share"],[class*="cookie-banner"]';
  const regionAttributes = ['id','class','aria-label','data-component','data-module','data-block','data-embed','data-testid','data-test','data-nitrous-content-id','data-theme-key','data-id'];
  function unrelated(el) {
    const label = regionAttributes.map(name => el.getAttribute(name) || '').join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[^a-z0-9]+/gi, ' ').toLowerCase();
    return /\b(?:related|recommended?|recommendations?|recirc(?:ulation)?|transporter|readers also read|you may also like|more (?:recipes|stories|articles)|author|advert(?:isement|ising)?|newsletter|sidebar)\b/.test(label);
  }
  const hidden = el => { const style = getComputedStyle(el); return el.matches(excluded) || unrelated(el) || style.display === 'none' || style.visibility === 'hidden'; };
  const title = cleanText(document.querySelector('h1')?.textContent || document.querySelector('meta[property="og:title"]')?.content || document.title).slice(0, 500);
  const heading = document.querySelector('h1');
  const roots = [...document.querySelectorAll('article,.article-container,.entry-content,.post-content,[itemprop~="articleBody"]')].filter(el => {
    for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) if (hidden(ancestor)) return false;
    return true;
  });
  let root = roots.sort((a, b) => Number(b.contains(heading)) - Number(a.contains(heading)) || b.textContent.length - a.textContent.length)[0];
  root ||= document.querySelector('main,[role="main"]') || document.body;
  function pageKey(raw) {
    try {
      const url = new URL(raw, location.href);
      if (!/^https?:$/.test(url.protocol)) return '';
      url.hash = ''; url.pathname = url.pathname.replace(/\/$/, '') || '/';
      for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort(); return url.href;
    } catch { return ''; }
  }
  const pageUrls = new Set([pageKey(location.href)]);
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  try { if (canonical && new URL(canonical).origin === location.origin) pageUrls.add(pageKey(canonical)); } catch { /* Invalid site metadata. */ }
  function linksElsewhere(anchor) {
    const href = anchor?.getAttribute('href');
    if (!href) return false;
    try {
      const url = new URL(href, location.href);
      // Retain in-page jumps and full-size image/lightbox links, not other posts.
      return !pageUrls.has(pageKey(url.href)) && !(/^https?:$/.test(url.protocol) && /\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname));
    } catch { return true; }
  }
  const escape = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let visited = 0, characters = 0, truncated = false;
  const capturedNodes = new Map();
  const allowed = new Set(['P','H2','H3','H4','H5','H6','UL','OL','LI','TABLE','TBODY','THEAD','TR','TD','TH','BLOCKQUOTE','STRONG','EM','B','I','BR','FIGCAPTION','DL','DT','DD']);
  function serialize(node, depth = 0) {
    if (++visited > 40000 || characters > 180000 || depth > 60) { truncated = true; return ''; }
    if (node.nodeType === Node.TEXT_NODE) { characters += node.textContent.length; return escape(node.textContent); }
    if (node.nodeType !== Node.ELEMENT_NODE || hidden(node) || node.tagName === 'H1') return '';
    if (node.tagName === 'IMG') { const photo = capturedNodes.get(node); return photo ? `<img src="${escape(photo.url)}" alt="${escape(photo.caption)}">` : ''; }
    if (node.tagName === 'A' && node.querySelector('img') && linksElsewhere(node)) return '';
    const children = [...node.childNodes].map(n => serialize(n, depth + 1)).join('');
    const tag = allowed.has(node.tagName) ? node.tagName.toLowerCase() : 'div';
    return tag === 'br' ? '<br>' : `<${tag}>${children}</${tag}>`;
  }
  const recipes = [];
  function visit(value, depth = 0) {
    if (!value || depth > 12 || recipes.length > 10) return;
    if (Array.isArray(value)) { value.slice(0, 200).forEach(v => visit(v, depth + 1)); return; }
    if (typeof value !== 'object') return;
    if ([value['@type']].flat().some(t => /(?:^|[/#])Recipe$/.test(t))) {
      // Only recipe fields. Do not copy publisher accounts, user IDs or page scripts.
      const keep = ['@type','name','headline','description','recipeIngredient','recipeInstructions','recipeYield','prepTime','cookTime','totalTime','image','url','mainEntityOfPage'];
      recipes.push(Object.fromEntries(keep.filter(k => k in value).map(k => [k, value[k]])));
    }
    if (value['@graph']) visit(value['@graph'], depth + 1);
    if (value.mainEntity) visit(value.mainEntity, depth + 1);
  }
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 30)) {
    if (script.textContent.length > 500000) continue;
    try { visit(JSON.parse(script.textContent)); } catch { /* Invalid site metadata. */ }
  }
  const images = [], groups = new Set(); let imageScanLimited=false;
  function addImage(raw, caption, alternatives = [], sourceHeading = title) {
    if (typeof raw !== 'string' || !raw.trim()) return;
    try {
      const url = new URL(raw, location.href);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || /\.(svg|gif)(?:$|\?)/i.test(url.href) || /\b(logo|avatar|gravatar|tracking|advertisement|banner)\b/i.test(url.href)) return;
      const key = new URL(url); key.pathname = key.pathname.replace(/-\d+x\d+(?=\.(jpe?g|png|webp)$)/i, '');
      for (const k of ['w','h','width','height','resize','fit','quality','q','crop']) key.searchParams.delete(k);
      if (groups.has(key.href)) return;
      groups.add(key.href);
      if(images.length>=80)return;
      const photo = { url: url.href, caption: cleanText(caption).slice(0, 500), alternatives: alternatives.filter(Boolean).slice(0, 8), sourceHeading: cleanText(sourceHeading).slice(0,300) };
      images.push(photo); return photo;
    } catch { /* Not an image URL. */ }
  }
  function srcset(value) {
    // URLs may contain commas (for example Hearst's crop=center,top). Only a
    // comma after a descriptor or at the end of a URL separates candidates.
    const candidates = []; let rest = String(value || '');
    while (rest) {
      rest = rest.replace(/^[\s,]+/, ''); if (!rest) break;
      const token = rest.match(/^\S+/)[0]; rest = rest.slice(token.length);
      if (token.endsWith(',')) { candidates.push({url:token.replace(/,+$/, ''),size:1}); continue; }
      const end = rest.indexOf(',');
      const descriptor = (end < 0 ? rest : rest.slice(0, end)).trim();
      rest = end < 0 ? '' : rest.slice(end + 1);
      if (!descriptor || /^\d+(?:\.\d+)?[wx]$/.test(descriptor)) candidates.push({url:token,size:parseFloat(descriptor) || 1});
    }
    return candidates;
  }
  const articleImages=[...root.querySelectorAll('img')];
  const articleHeadings=[...root.querySelectorAll('h2,h3,h4,h5,h6')].filter(el => {
    if (!cleanText(el.textContent)) return false;
    for(let ancestor=el;ancestor && ancestor!==root.parentElement;ancestor=ancestor.parentElement)if(hidden(ancestor))return false;
    return true;
  });
  imageScanLimited=articleImages.length>2500;
  for (const img of articleImages.slice(0,2500)) {
    if (img.closest(excluded) || linksElsewhere(img.closest('a[href]'))) continue;
    if (/^about\s+[a-z]+(?:\s+[a-z]+)?$/i.test((img.alt || '').trim())) continue;
    const label = [img.alt, img.title, img.id, img.className].join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    if (/\b(?:logo|avatar|gravatar|advertisement|tracking|pin[- ]button|(?:get it|available) on google play|download on the app store|app[- ]store[- ]badge|google[- ]play[- ]badge|about (?:the author|me)|author (?:photo|portrait|bio))\b/i.test(label)) continue;
    let invisible = false;
    for (let ancestor = img; ancestor && ancestor !== root.parentElement; ancestor = ancestor.parentElement) { if (hidden(ancestor)) { invisible = true; break; } }
    if (invisible) continue;
    if (img.naturalWidth && (img.naturalWidth < 160 || img.naturalHeight < 120) && !img.dataset.src && !img.dataset.lazySrc) continue;
    const variants = [img.dataset.srcset, img.srcset, ...[...(img.closest('picture')?.querySelectorAll('source[srcset]') || [])].map(el => el.srcset)].flatMap(srcset).sort((a,b) => b.size - a.size);
    const sources = [...new Set([variants[0]?.url, img.dataset.lazySrc, img.dataset.src, img.dataset.original, img.currentSrc, img.src,...variants.slice(1).map(v=>v.url)].filter(v => v && !v.startsWith('data:')).map(v => { try { return new URL(v, location.href).href; } catch { return ''; } }).filter(Boolean))];
    const linkedHeading=articleHeadings.filter(h=>h.compareDocumentPosition(img)&Node.DOCUMENT_POSITION_FOLLOWING).at(-1)?.textContent || title;
    const photo=addImage(sources[0], img.closest('figure')?.querySelector('figcaption')?.textContent || img.alt, sources.slice(1), linkedHeading);
    if(photo)capturedNodes.set(img,photo);
  }
  // Metadata supplies a hero image when the theme renders it outside <article>.
  for (const recipe of recipes) {
    const name = cleanText(recipe.name).toLowerCase();
    if (name && !title.toLowerCase().includes(name) && !name.includes(title.toLowerCase())) continue;
    const owner = recipe.url || recipe.mainEntityOfPage;
    const ownerUrl = typeof owner === 'string' ? owner : owner?.['@id'] || owner?.url;
    if (ownerUrl && !pageUrls.has(pageKey(ownerUrl))) continue;
    if (!name && !pageUrls.has(pageKey(ownerUrl || 'about:blank'))) continue;
    for (const img of [recipe.image].flat()) addImage(typeof img === 'string' ? img : img?.url || img?.contentUrl, recipe.name);
  }
  if (!images.length) addImage(document.querySelector('meta[property="og:image"]')?.content, title);
  // Keep image markers in their original DOM locations even when a photo is
  // unchecked. The backend derives stable heading links from this complete body.
  const body = serialize(root);
  const script = recipes.length ? `<script type="application/ld+json">${JSON.stringify(recipes).replace(/</g, '\\u003c')}</script>` : '';
  const html = `<html><head><title>${escape(title)}</title>${script}</head><body><article><h1>${escape(title)}</h1>${body}</article></body></html>`;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script').forEach(s => s.remove());
  doc.querySelectorAll('p,h1,h2,h3,h4,li,div,br,figcaption,tr').forEach(el => el.append('\n'));
  const text = doc.querySelector('article').textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
  return { url: location.href, title, html, text: text.slice(0, 200000), images, truncated:truncated||text.length>200000, imageLimitReached:groups.size>80||imageScanLimited, discoveredPhotos:groups.size, photoLimit:80, words: text.split(/\s+/).filter(Boolean).length };
})();
