const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { JSDOM } = require('jsdom');
const { VerifiedImage, ImagePreparationNotifications } = require('./helpers/load-component.cjs')('VerifiedImage');
const { resolveImageResponse } = require('./helpers/load-client.cjs')('preparedImageClient');
const { readGenerationResponse } = require('./helpers/load-client.cjs')('generationResponse');
async function setup(t, fetcher) {
  const dom = new JSDOM('<div id="root"></div>', { url:'http://localhost:3000' });
  const values = { window:dom.window, document:dom.window.document, CustomEvent:dom.window.CustomEvent, navigator:dom.window.navigator, HTMLElement:dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT:true, fetch:fetcher };
  const saved = Object.fromEntries(Object.keys(values).map(k => [k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for (const [k,value] of Object.entries(values)) Object.defineProperty(globalThis,k,{value,configurable:true,writable:true});
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async()=>{ await React.act(async()=>root.unmount()); dom.window.close(); for(const k of Object.keys(values)) if(saved[k])Object.defineProperty(globalThis,k,saved[k]);else delete globalThis[k]; });
  return root;
}
test('preview stays a placeholder until verified, then shows a small badge outside the image', async t => {
  const id='a'.repeat(64); let finish; const pending=new Promise(r=>finish=r), calls=[];
  const root=await setup(t,async(url,init)=>{ calls.push(url); return init?.method==='POST' ? pending : new Response('verified pixels',{headers:{'Content-Type':'image/png','X-Image-Metadata':'verified'}}); });
  const blob=new Blob(['private generation'],{type:'image/png'});
  await React.act(async()=>root.render(React.createElement(VerifiedImage,{source:blob,alt:'Clean photo'})));
  assert.equal(document.querySelector('img'),null); assert.match(document.body.textContent,/Preparing image/);
  assert.equal(document.querySelector('[aria-label="Metadata cleanup verified"]'),null);
  await React.act(async()=>finish(Response.json({imageUrl:'/api/image-assets/'+id,metadata:{state:'verified',c2pa:{present:false}},variants:{png:'/api/image-assets/'+id}})));
  const image=document.querySelector('img'),badge=document.querySelector('[aria-label="Metadata cleanup verified"]');
  assert.equal(image.getAttribute('src'),'/api/image-assets/'+id); assert.ok(badge);
  assert.equal(badge.nextElementSibling,image,'badge is a separate element above the img');
  assert.match(badge.title,/does not mean SynthID was removed/); assert.equal(calls.length,2);
});
test('one preparation Retry releases every waiting consumer without calling generation',async t=>{
  const id='b'.repeat(64),calls=[], result={imageUrl:'/api/image-assets/'+'c'.repeat(64),metadata:{state:'verified',c2pa:{present:false}}};
  const root=await setup(t,async(url,init)=>{calls.push({url,init});return Response.json(result);});
  await React.act(async()=>root.render(React.createElement(ImagePreparationNotifications)));
  let one,two;
  await React.act(async()=>{ const data={assetId:id,retryable:true,error:'Preparation failed'}; one=resolveImageResponse(new Response(null,{status:422}),data); two=resolveImageResponse(new Response(null,{status:422}),data); await Promise.resolve(); });
  assert.equal(document.querySelectorAll('button').length,1); assert.equal(calls.length,0);
  await React.act(async()=>document.querySelector('button').click());
  assert.deepEqual(await one,result); assert.deepEqual(await two,result);
  assert.equal(calls.length,1); assert.equal(calls[0].url,'/api/image-assets/'+id); assert.equal(calls[0].init.method,'POST');
  assert.equal(document.querySelector('[role=alert]'),null);
});

test('a failed preview offers Retry without nesting it inside the image-open button',async t=>{
  let fail=true,opened=0;
  const imageUrl='/api/image-assets/'+'e'.repeat(64);
  const root=await setup(t,async(url,init)=>{
    if(init?.method==='POST')return fail ? Response.json({error:'Verification failed'},{status:422}) : Response.json({imageUrl,metadata:{state:'verified',c2pa:{present:false}}});
    return new Response('verified pixels',{headers:{'Content-Type':'image/png','X-Image-Metadata':'verified'}});
  });
  await React.act(async()=>root.render(React.createElement(VerifiedImage,{source:new Blob(['pixels']),alt:'Output',action:{'aria-label':'Open image',onClick:()=>opened++}})));
  assert.equal(document.querySelector('[aria-label="Open image"]'),null);
  assert.equal(document.querySelector('button button'),null);
  assert.equal(document.querySelector('button').textContent,'Retry');
  fail=false;await React.act(async()=>document.querySelector('button').click());
  assert.equal(document.querySelector('button button'),null);
  assert.ok(document.querySelector('[aria-label="Open image"] img'));
  await React.act(async()=>document.querySelector('[aria-label="Open image"]').click());
  assert.equal(opened,1);
});
test('streaming shows processing phases and never exposes provider partial images',async()=>{
  const phases=[], events=[{type:'status',phase:'generating'},{type:'partial',imageUrl:'https://provider.invalid/raw.png'},{type:'status',phase:'preparing'},{type:'result',data:{imageUrl:'/api/image-assets/'+'d'.repeat(64)}}];
  const response=new Response(events.map(e=>JSON.stringify(e)).join('\n'),{headers:{'Content-Type':'application/x-ndjson'}});
  const output=await readGenerationResponse(response,phase=>phases.push(phase));
  assert.deepEqual(phases,['Generating image…','Preparing image…']); assert.match(output.imageUrl,/^\/api\/image-assets\//);
});
