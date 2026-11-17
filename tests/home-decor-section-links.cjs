const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{JSDOM}=require('jsdom'),sharp=require('sharp');
const {fixture}=require('./helpers/recipe-fixtures.cjs');
const {textResponse}=require('./helpers/content-fixtures.cjs');
const {DecorStore}=require('../.intelligence-build/lib/recipe-intelligence/decor.js');
const {extractDecor,validateDecorArticle,decorHtml,decorWritingPayload,decorImagePrompt}=require('../.intelligence-build/lib/recipe-intelligence/decorArticle.js');
const {DEFAULT_CONTENT_SETTINGS}=require('../.intelligence-build/lib/recipe-intelligence/settings.js');
const sourceUrl='https://decor.example/room-guide';
const paragraphs=['Place linen cushions on the sofa and leave a clear path through the seating area.','Group open shelves by purpose so the items you use often remain easy to reach.','Use curtains to soften daylight around the window without obstructing the doorway.'];
const sourceHtml=`<article><h1>A calm room</h1><p>${'Plan the room around everyday use and the available space. '.repeat(4)}</p>${['Seating','Storage','Window'].map((h,i)=>`<section><h2>${h}</h2><p>${paragraphs[i]}</p><figure><img src="/photo-${i}-800x600.jpg" alt="${h} view"><figcaption>${h} details</figcaption></figure></section>`).join('')}</article>`;
const bytes=color=>sharp({create:{width:320,height:240,channels:3,background:color}}).png().toBuffer();
function modelArticle(source,photos,order=[2,0,1]){
 const sections=order.map(i=>({sourceSectionId:source.sections[i].id,heading:source.sections[i].heading,paragraphs:source.sections[i].paragraphs}));
 return {title:source.title,seoTitle:source.title,metaDescription:'A calm and practical room guide.',slug:'calm-room',introduction:'Arrange the room for everyday use.',sections,notes:[],imagePlans:photos.map(p=>({id:p.id,relevant:true,kitchen:false,subject:p.caption || 'Room view',reason:'',alt:p.caption || 'Room view',section:sections.findIndex(s=>s.sourceSectionId===p.sourceSectionId)}))};
}
function sectionPhotos(html){const dom=new JSDOM(html);const rows=[...dom.window.document.querySelectorAll('section')].map(s=>({heading:s.querySelector('h2').textContent,text:s.querySelector('p').textContent,images:[...s.querySelectorAll('img')].map(i=>i.getAttribute('src'))}));dom.window.close();return rows;}

test('source DOM headings survive capture and upload selection independently of photo indexes',async t=>{
 const page=new JSDOM(sourceHtml,{url:sourceUrl,runScripts:'outside-only'});t.after(()=>page.window.close());
 const capture=page.window.eval(fs.readFileSync(path.join(__dirname,'../extensions/recipe-intelligence-capture/content.js'),'utf8'));
 assert.deepEqual(Array.from(capture.images,p=>p.sourceHeading),['Seating','Storage','Window']);
 const f=await fixture(t),decor=new DecorStore(f.store),id=randomUUID();
 decor.beginBrowser({captureId:id,url:sourceUrl,html:capture.html});
 await decor.uploadBrowser(id,await bytes('#aa9977'),capture.images[0].url,capture.images[0].caption);
 await decor.uploadBrowser(id,await bytes('#778899'),capture.images[2].url,capture.images[2].caption);
 decor.finishBrowser(id,{missingPhotos:0});
 const job=decor.detail(id);
 assert.equal(job.source.sections.length,3);assert.equal(job.source.sections[1].heading,'Storage');assert.deepEqual(job.photos.map(p=>p.sourceSectionId),['source-section-1','source-section-3']);
 const payload=decorWritingPayload(decor.get(id).source,job.photos,DEFAULT_CONTENT_SETTINGS,'');
 const data=JSON.parse(payload.input[0].content[0].text);
 assert.equal(data.source.sections.length,3);assert.equal(data.references[1].sourceHeading,'Window');
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM decor_calls').get().n,0);
});

test('repeated headings, lazy image variants and title-level photos have distinct stable links',()=>{
 const source=extractDecor(`<article><h1>Room</h1><img src="/hero.jpg"><p>${paragraphs.join(' ').repeat(2)}</p><h2>Details</h2><img data-src="/one-900x600.jpg" src="/one-100x80.jpg"><h3>Details</h3><img src="/two.jpg"></article>`,sourceUrl);
 assert.deepEqual(source.sections.map(s=>s.id),['source-section-1','source-section-2']);
 assert.deepEqual(source.photos.map(p=>p.sourceSectionId),['article-title','source-section-1','source-section-2']);
});

test('validation rejects cross-heading image placement and omitted or duplicate text-only sections',()=>{
 const source=extractDecor(sourceHtml,sourceUrl),photos=[{id:'first',sourceSectionId:source.sections[0].id},{id:'third',sourceSectionId:source.sections[2].id}];
 const value=modelArticle(source,photos);
 const accepted=validateDecorArticle(value,['first','third'],source,photos);
 assert.deepEqual(accepted.imagePlans.map(p=>p.sectionId),['source-section-1','source-section-3']);
 const wrong=structuredClone(value);wrong.imagePlans[1].section=1;
 assert.throws(()=>validateDecorArticle(wrong,['first','third'],source,photos),/different heading/);
 const omitted=structuredClone(value);omitted.sections.pop();
 assert.throws(()=>validateDecorArticle(omitted,['first','third'],source,photos),/omitted or changed/);
 const duplicated=structuredClone(value);duplicated.sections[2].sourceSectionId=duplicated.sections[1].sourceSectionId;
 assert.throws(()=>validateDecorArticle(duplicated,['first','third'],source,photos),/repeated/);
 const noImages=modelArticle(source,[]);assert.equal(validateDecorArticle(noImages,[],source).sections.length,3);
 const prompt=decorImagePrompt(accepted.imagePlans[1],'Soft linen','room',accepted);
 assert.match(prompt,/"heading":"Window"/);assert.match(prompt,/Use curtains/);assert.doesNotMatch(prompt,/Group open shelves/);
});

test('removing a generated image keeps exact article text and other image links in preview and ZIP; restoring reuses files',async t=>{
 const f=await fixture(t),decor=new DecorStore(f.store),id=randomUUID(),image=await bytes('#aabbcc');
 decor.beginBrowser({captureId:id,url:sourceUrl,html:sourceHtml});
 for(let i=0;i<3;i++)await decor.uploadBrowser(id,await bytes(['#445566','#778899','#aabbcc'][i]),new URL(`/photo-${i}-800x600.jpg`,sourceUrl).href,['Seating','Storage','Window'][i]);
 decor.finishBrowser(id,{missingPhotos:0});
 let view=decor.detail(id);const photos=view.photos;
 const quote=decor.select(id,{brief:'Soft linen',photos:photos.map(p=>({id:p.id,group:'same-room'}))}).quote;
 decor.approve(id,quote.version);decor.claim();let calls=0;
 await decor.process(id,f.fetcher,{async request(op,payload){calls++;return op==='text'?textResponse(modelArticle(decor.get(id).source,photos)):{body:{data:[{b64_json:image.toString('base64')}],usage:{input_tokens:100,output_tokens:100}},requestId:'image-'+calls};}});
 view=decor.detail(id);assert.equal(view.state,'completed',view.error);const original=JSON.stringify(view.article),before=sectionPhotos((await decor.document(id)).toString());
 const output=fs.readFileSync(path.join(f.store.root,decor.get(id).photos[1].output));const count=calls;
 decor.setImageIncluded(id,photos[1].id,false);
 const after=sectionPhotos((await decor.document(id)).toString());
 assert.equal(JSON.stringify(decor.get(id).article),original);
 assert.deepEqual(after.map(({images,...row})=>row),before.map(({images,...row})=>row));
 assert.equal(after.find(s=>s.heading==='Storage').images.length,0);
 assert.deepEqual(after.find(s=>s.heading==='Window').images,before.find(s=>s.heading==='Window').images);
 const zip=(await decor.document(id,true)).toString('latin1');assert.ok(!zip.includes(`image-${photos[1].id}.webp`));assert.ok(zip.includes(`image-${photos[2].id}.webp`));
 decor.setImageIncluded(id,photos[1].id,true);
 assert.deepEqual(sectionPhotos((await decor.document(id)).toString()),before);assert.equal(calls,count);
 assert.deepEqual(fs.readFileSync(path.join(f.store.root,decor.get(id).photos[1].output)),output);
 assert.equal(JSON.stringify(decor.get(id).article),original);
 const current=decor.get(id);current.state='running';f.store.db.prepare('UPDATE decor_jobs SET state=?,data_json=? WHERE id=?').run('running',JSON.stringify(current),id);
 assert.throws(()=>decor.setImageIncluded(id,photos[0].id,false),/current request/);
});

test('unmapped uploads require an explicit matching heading and stale section choices are rejected',async t=>{
 const f=await fixture(t),decor=new DecorStore(f.store),id=randomUUID();decor.beginBrowser({captureId:id,url:sourceUrl,html:sourceHtml});decor.finishBrowser(id,{});
 await decor.upload(id,await bytes('#ad8765'),'Uploaded view');const p=decor.detail(id).photos[0];
 assert.throws(()=>decor.select(id,{brief:'',photos:[{id:p.id,group:'room'}]}),/matching article heading/);
 assert.throws(()=>decor.select(id,{brief:'',photos:[{id:p.id,group:'room',sourceSectionId:'not-found'}]}),/matching article heading/);
 assert.equal(decor.select(id,{brief:'',photos:[{id:p.id,group:'room',sourceSectionId:'source-section-2'}]}).photos[0].sourceHeading,'Storage');
});

test('legacy generated articles retain their numeric placements when an image is omitted',()=>{
 const article={title:'Room',seoTitle:'Room',metaDescription:'Room',introduction:'Intro',sections:[{heading:'One',paragraphs:['Keep one.']},{heading:'Two',paragraphs:['Keep two.']}],imagePlans:[{id:'a',section:0,alt:'A'},{id:'b',section:1,alt:'B'}]};
 const rows=sectionPhotos(decorHtml(article,[{id:'b',url:'/b.webp'}]));
 assert.deepEqual(rows,[{heading:'One',text:'Keep one.',images:[]},{heading:'Two',text:'Keep two.',images:['/b.webp']}]);
});
