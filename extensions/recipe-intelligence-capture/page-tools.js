// Runs in the article tab only after a toolbar click. Never solves challenges,
// clicks page controls, changes credentials, or navigates to another page.
(function(root) {
  const excluded='nav,aside,footer,form,[hidden],[aria-hidden="true"],.related,.related-posts,.recommended,[class*="newsletter"],[class*="sidebar"]';
  function articleRoot(isExcluded = el => !!el.closest(excluded)) {
    const heading=document.querySelector('h1');
    const candidates=[...document.querySelectorAll('article,.article-container,.entry-content,.post-content,[itemprop~="articleBody"]')].filter(el=>!isExcluded(el));
    const best = candidates.sort((a,b)=>Number(b.contains(heading))-Number(a.contains(heading))||b.textContent.length-a.textContent.length)[0];
    // Some themes wrap just the headline in <article>, followed by the actual body.
    if (best && heading && best.contains(heading) && !best.querySelector('p,li,h2,figure')) {
      const scope = best.closest('main,[role="main"]') || best.parentElement;
      const bodies = candidates.filter(el => el !== best && scope?.contains(el) &&
        (best.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        el.matches('.entry-content,.post-content,[itemprop~="articleBody"]') && el.querySelector('p,li'));
      if (bodies.length === 1) return bodies[0];
    }
    return best || document.querySelector('main,[role="main"]') || document.body;
  }
  function inspect() {
    const title=(document.title||'').trim(), body=(document.body?.innerText||document.body?.textContent||'').replace(/\s+/g,' ').trim();
    const article=articleRoot();
    const articleText=article && article!==document.body ? article.textContent.replace(/\s+/g,' ').trim() : '';
    const substantive=articleText.length>500 && article.querySelectorAll('p').length>=3;
    const gate=document.querySelector('#challenge-form,#cf-challenge-running,#cf-challenge-error,.cf-browser-verification,#px-captcha');
    const titleGate=/^(just a moment|attention required|access denied|security check|verify (?:you|that)|checking your browser|robot or human)/i.test(title);
    const bodyGate=/verify (?:that )?you(?: are|'re) human|checking (?:your browser|if the site connection is secure)|performing security verification|enable javascript and cookies to continue|sorry, you have been blocked|unusual traffic from your computer/i.test(body);
    const blocked=!!gate&&!substantive || titleGate&&(bodyGate||body.length<1000)&&!substantive;
    return {blocked,reason:blocked?'Open the original tab and complete the website verification. When the article is visible, return here and retry. The verification page has not been saved.':null};
  }
  async function prepare() {
    const initial=inspect(); if(initial.blocked)return initial;
    const href=location.href, x=scrollX, y=scrollY, started=Date.now();
    let complete=false, steps=0, previousBottom=-1, stable=0;
    try {
      const article=articleRoot(); if(!article)return {loadingIncomplete:true};
      let position=Math.max(0,article.getBoundingClientRect().top+scrollY-80);
      for(;steps<72 && Date.now()-started<20000;steps++) {
        if(location.href!==href)throw new Error('The article tab changed while loading. Capture the new page again.');
        const state=inspect();if(state.blocked)return state;
        const bottom=Math.min(document.documentElement.scrollHeight,article.getBoundingClientRect().bottom+scrollY);
        window.scrollTo({left:x,top:position,behavior:'instant'});
        await new Promise(resolve=>setTimeout(resolve,250));
        if(position+innerHeight>=bottom-2) {
          stable=Math.abs(bottom-previousBottom)<4?stable+1:0;
          if(stable>=2){complete=true;break;}
        }
        previousBottom=bottom;position=Math.min(position+Math.max(200,innerHeight*.8),Math.max(0,bottom-innerHeight));
      }
      return {...inspect(),loadingIncomplete:!complete,scrollSteps:steps+1};
    } finally {if(location.href===href)window.scrollTo({left:x,top:y,behavior:'instant'});}
  }
  const blocks = 'h1,h2,h3,h4,h5,h6,p,li,figure,img,blockquote,td';
  function boundaryPath(element) {
    const path = [];
    while (element && element !== document.body) {
      const tag = element.localName;
      const siblings = [...element.parentElement.children].filter(node => node.localName === tag);
      const position = siblings.indexOf(element);
      path.unshift(tag + (position === siblings.length-1 ? ':last-of-type' : ':nth-of-type('+(position+1)+')'));
      if (['article','main'].includes(tag) && document.querySelectorAll(tag).length === 1) { path[0]=tag; break; }
      element = element.parentElement;
    }
    return path.join(' > ');
  }
  function selectionRule() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) throw new Error('Highlight text from the first heading through the last paragraph in the original tab, then try again.');
    const range = selection.getRangeAt(0);
    const matches = [...document.body.querySelectorAll(blocks)].filter(el =>
      !el.closest(excluded+',header nav,script,style') && range.intersectsNode(el));
    if (!matches.length) throw new Error('Select article headings or paragraphs in the source page.');
    return {first:boundaryPath(matches[0]), last:boundaryPath(matches.at(-1)),
      firstContext:boundaryContext(matches[0]),lastContext:boundaryContext(matches.at(-1))};
  }
  function boundaryContext(el) {
    return [el.parentElement.localName,el.previousElementSibling?.localName||'',el.nextElementSibling?.localName||''].join('/');
  }
  function resolveRule(rule) {
    const start = document.querySelectorAll(rule.first), end = document.querySelectorAll(rule.last);
    if (start.length!==1 || end.length!==1) return null;
    if (boundaryContext(start[0])!==rule.firstContext || boundaryContext(end[0])!==rule.lastContext) return null;
    if (start[0]!==end[0] && !(start[0].compareDocumentPosition(end[0]) & Node.DOCUMENT_POSITION_FOLLOWING)) return null;
    const range=document.createRange(); range.setStartBefore(start[0]); range.setEndAfter(end[0]);
    return range;
  }
  root.RecipeCapturePage={inspect,prepare,articleRoot,selectionRule,resolveRule};
})(globalThis);
