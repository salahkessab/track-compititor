// Runs in the article tab only after a toolbar click. Never solves challenges,
// clicks page controls, changes credentials, or navigates to another page.
(function(root) {
  const excluded='nav,aside,footer,form,[hidden],[aria-hidden="true"],.related,.related-posts,.recommended,[class*="newsletter"],[class*="sidebar"]';
  function articleRoot() {
    const heading=document.querySelector('h1');
    const candidates=[...document.querySelectorAll('article,.article-container,.entry-content,.post-content,[itemprop~="articleBody"]')].filter(el=>!el.closest(excluded));
    return candidates.sort((a,b)=>Number(b.contains(heading))-Number(a.contains(heading))||b.textContent.length-a.textContent.length)[0] || document.querySelector('main,[role="main"]') || document.body;
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
  root.RecipeCapturePage={inspect,prepare};
})(globalThis);
