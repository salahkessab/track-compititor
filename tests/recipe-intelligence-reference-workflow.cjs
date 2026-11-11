const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const sharp = require('sharp');
const { contentFixture, html, recipeData, article, textResponse } = require('./helpers/content-fixtures.cjs');
const { ImportStore, discoverPhotos } = require('../.intelligence-build/lib/recipe-intelligence/imports.js');
const { prepareReferenceBatch, reviewPhoto } = require('../.intelligence-build/lib/recipe-intelligence/referenceWorkflow.js');
const { PHOTO_PROFILE_VERSION, PHOTO_INSTRUCTIONS, analysisPayload } = require('../.intelligence-build/lib/recipe-intelligence/photoProfile.js');
const { DEFAULT_CONTENT_SETTINGS, saveContentSettings, validateContentSettings } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');
const { ProviderFailure } = require('../.intelligence-build/lib/recipe-intelligence/provider.js');
const { IntelligenceStore } = require('../.intelligence-build/lib/recipe-intelligence/database.js');
const { BatchStore } = require('../.intelligence-build/lib/recipe-intelligence/batches.js');
const directory = path.join(__dirname, 'fixtures/approved-recipe-photos');
const names = ['01-ingredients','02-sauteed-onions','03-onions-and-spices','04-broth-and-beans','05-chicken-in-broth','06-creamy-chili','07-served-chili','08-skillet'];
const contexts = [
 {role:'ingredients', cookingStage:'Uncombined ingredients in separate containers', visibleFood:'Tomatoes, shredded chicken, northern beans, cannellini beans, corn, chopped onion, chicken broth, cream cheese, olive oil, garlic and a shared dish of spices.', vessel:'Clear glass ingredient containers and a ceramic seasoning dish', labels:['Tomatoes','Chicken','Northern beans','Cannellini beans','Corn','Onion','Chicken broth','Cream cheese','Olive oil','Garlic','Cumin, salt, oregano, coriander, paprika, chili powder'],placement:'ingredients'},
 ...['Pale sautéed onions','Onions coated in browned spices','Clear red broth with beans and corn','Shredded chicken added to red broth','Opaque creamy chili after cream cheese'].map((stage,i)=>({role:'cooking', cookingStage:stage,visibleFood:stage,vessel:'Round enamel Dutch oven with two loop handles; wooden spoon'+(i===3?' absent':' present'),labels:[],placement:'gallery'})),
 {role:'served', cookingStage:'Served chili',visibleFood:'Creamy chili with chicken, beans, corn, tomatoes and visible cilantro',vessel:'Ceramic serving bowls and metal spoon; chips, cheese, board and cloth remain',labels:[],placement:'hero'},
 {role:'cooking',cookingStage:'Cooked pasta mixed with sauce',visibleFood:'Cooked rigatoni, chicken and thick orange cream sauce',vessel:'Frying pan with metal handles',labels:[],placement:'gallery'}
];
async function referenceFixture(t, options={}) {
 let photoMap = new Map(); let imageCount=0;
 const f = await contentFixture(t,{provider:async(op,payload,signal,n)=>{
   if(options.provider) { const custom = await options.provider(op,payload,++imageCount); if(custom) return custom; }
   if(op==='image') return {body:{data:[{b64_json:fs.readFileSync(path.join(directory,'08-skillet-approved.jpg')).toString('base64')}],usage:{input_tokens:2200,output_tokens:1400,input_tokens_details:{text_tokens:200,image_tokens:2000}}},requestId:'image-'+n};
   if(payload.text?.format?.name==='recipe_photographs') {
     const records = JSON.parse(payload.input[0].content[0].text).photos;
     return textResponse({photos:records.map((p,i)=>({id:p.id,...contexts[photoMap.get(p.id)||0],stepIndex:null,needsReview:options.reviewFirst===true&&i===0,reason:options.reviewFirst&&i===0?'Confirm ingredient labels.':''}))});
   }
   return textResponse(article());
 }});
 const imports=new ImportStore(f.store);
 const upload=async(count=1,start=0)=>{const row=imports.create(); for(let i=0;i<count;i++){ const index=(start+i)%8; const id=await imports.add(row.id,fs.readFileSync(path.join(directory,names[index]+'.jpg')),names[index]+'.jpg');photoMap.set(id,index); }return imports.detail(row.id);};
 const settings={...DEFAULT_CONTENT_SETTINGS,output:'images_only',correction:false};
 return {...f,imports,upload,settings};
}
test('reference defaults retain the approved model controls and vessel/cooking context',()=>{
 assert.equal(DEFAULT_CONTENT_SETTINGS.textModel,'gpt-5.5'); assert.equal(DEFAULT_CONTENT_SETTINGS.imageModel,'gpt-image-2.6-sunburst'); assert.equal(DEFAULT_CONTENT_SETTINGS.imageSettings.size,'1536x864'); assert.equal(DEFAULT_CONTENT_SETTINGS.imageSettings.quality,'high');
 assert.match(PHOTO_INSTRUCTIONS,/camera angle/);assert.match(PHOTO_INSTRUCTIONS,/skillet stays a skillet/);assert.match(PHOTO_INSTRUCTIONS,/clear glass transparent/);
 assert.throws(()=>analysisPayload(Array(11).fill({}),null),/ten/);
});

test('new preparations upgrade a two-color palette and validate an explicitly chosen utensil color',()=>{
 const input={...DEFAULT_CONTENT_SETTINGS,palette:{cookware:'#123456',surface:'#abcdef'}};
 const upgraded=validateContentSettings(input);
 assert.deepEqual(upgraded.palette,{cookware:'#123456',surface:'#abcdef',utensil:'#5C3A2E'});
 assert.equal(input.palette.utensil,undefined);
 assert.equal(validateContentSettings({...input,palette:{...input.palette,utensil:'#3a705e'}}).palette.utensil,'#3a705e');
 for(const utensil of [null,123,'red','#123456; background:url(x)'])assert.throws(()=>validateContentSettings({...input,palette:{...input.palette,utensil}}),/utensil colors/);
});
test('responsive and lazy photos deduplicate while ads, portraits and unrelated cards are excluded',()=>{
 const source=`<h1>Soup</h1><script type="application/ld+json">${JSON.stringify({'@type':'Recipe',name:'Soup',image:'https://food.example/soup-300x200.jpg'})}</script><article><img srcset="/soup-300x200.jpg 300w, /soup-1200x800.jpg 1200w"><img data-lazy-src="/step.jpg"><div class="related-recipes"><img src="/other.jpg"></div><aside><img src="/ad.jpg"></aside><div class="author-box"><img src="/person.jpg"></div><a href="/different-recipe/"><img src="/another.jpg"></a><img width="20" height="20" src="/tiny.png"><img src="http://127.0.0.1/private.jpg"></article>`;
 assert.deepEqual(discoverPhotos(source,'https://food.example/soup/').map(p=>p.url),['https://food.example/soup-1200x800.jpg','https://food.example/step.jpg']);
});
test('all usable photos auto-select, including a fourth; exact duplicate bytes do not count twice',async t=>{
 const f=await referenceFixture(t); const row=await f.upload(3);assert.equal(row.selection_confirmed,1); assert.equal(row.photos.filter(p=>p.selected).length,3);
 await f.imports.add(row.id,fs.readFileSync(path.join(directory,names[0]+'.jpg')),'same-photo.jpg'); assert.equal(f.imports.detail(row.id).photos.length,3);
 await f.imports.add(row.id,fs.readFileSync(path.join(directory,names[3]+'.jpg')),'fourth.jpg');const four=f.imports.detail(row.id);assert.equal(four.photos.filter(p=>p.selected).length,4);assert.equal(four.selection_confirmed,1);
 const b=f.batches.create([{importId:row.id}],f.settings); assert.equal(b.quote.lines.filter(l=>l.kind.startsWith('photo:')).length,4);assert.equal(b.quote.pending,0);assert.equal(f.providerCalls.length,0);
});
test('URL preparation is free, persistent and independent of historical publication verification',async t=>{
 const f=await referenceFixture(t);const row=f.imports.create('https://food.example/chili/');
 f.responses.set(row.url,html(recipeData({datePublished:undefined}),'<meta name="x" content="test">').replace('</body>','<article><img data-src="https://food.example/ingredients.jpg"><img src="https://food.example/duplicate.jpg"></article></body>'));
 const bytes=fs.readFileSync(path.join(directory,names[0]+'.jpg'));f.responses.set('https://food.example/ingredients.jpg',bytes);f.responses.set('https://food.example/duplicate.jpg',bytes);
 const job=f.imports.claim(f.owner);assert.equal(job.id,row.id);await f.imports.process(row.id,f.fetcher); const d=f.imports.detail(row.id);
 assert.equal(d.status,'ready');assert.ok(d.recipe.ingredients.length);assert.equal(d.photos.filter(p=>p.state==='ready').length,1);assert.equal(f.providerCalls.length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM recipe_records').get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM tracked_sites').get().n,0);
 const second=await IntelligenceStore.open(f.root);try{assert.equal(new ImportStore(second).detail(row.id).photos.length,2);}finally{second.close();}
});
test('selected references alone enter quotes, high-detail analysis and image edits; outputs include native, JPEG, gallery and ZIP',async t=>{
 const f=await referenceFixture(t);const row=await f.upload(7);const ids=[row.photos[1].id,row.photos[4].id,row.photos[6].id];f.imports.select(row.id,ids);
 const b=f.batches.create([{importId:row.id}],f.settings);assert.equal(b.quote.lines.filter(l=>l.kind.startsWith('photo:')).length,3);assert.equal(b.quote.lines.filter(l=>l.kind.startsWith('analysis:')).length,1);f.approve(b);await f.drainBatch();
 const done=f.batches.detail(b.id); assert.equal(done.status,'completed',JSON.stringify(done.items.map(i=>i.stages))); assert.equal(f.providerCalls.length,4);
 const vision=f.providerCalls[0].payload; assert.equal(vision.model,'gpt-5.5');assert.equal(vision.input[0].content.filter(c=>c.type==='input_image').length,3);assert.ok(vision.input[0].content.filter(c=>c.type==='input_image').every(c=>c.detail==='high'));
 for(const call of f.providerCalls.filter(c=>c.operation==='image')) {assert.equal(call.payload.references.length,1); assert.equal(call.payload.complexity,undefined);assert.match(call.payload.prompt,/#607D8B/); const original=Buffer.from(call.payload.references[0].split(',')[1],'base64');assert.ok(ids.some(id=>f.imports.read(id).bytes.equals(original)));}
 const files=done.items[0].files;assert.equal(files.filter(x=>/^photo-.*\.jpg$/.test(x.name)).length,3);assert.equal(files.filter(x=>/^photo-.*\.png$/.test(x.name)).length,3);assert.ok(files.some(x=>x.name==='gallery.html'));
 const manifest=JSON.parse(f.batches.artifacts.read(files.find(x=>x.name==='manifest.json').id).data);assert.equal(manifest.profiles.photoProfile,PHOTO_PROFILE_VERSION);
 const zip=f.batches.artifacts.zip(f.batches.item(done.items[0].id));assert.equal(zip.readUInt32LE(0),0x04034b50);assert.ok(zip.includes(Buffer.from('prompts.json')));assert.ok(zip.includes(Buffer.from('Original and edited photographs')));
});
test('palette, selection, prompt versions and analysis cache survive settings changes and restart',async t=>{
 const f=await referenceFixture(t);const row=await f.upload(1,7);const palette={...f.settings.palette,utensil:'#3a705e'};const b=f.batches.create([{importId:row.id}],{...f.settings,palette});f.approve(b);
 saveContentSettings(f.store,{...f.settings,palette:{cookware:'#ff0000',surface:'#000000',utensil:'#ffffff'}});
 await f.drainBatch();const item=f.batches.detail(b.id).items[0];const second=await IntelligenceStore.open(f.root);try{const saved=new BatchStore(second).detail(b.id);assert.deepEqual(saved.settings.palette,palette);assert.deepEqual(JSON.parse(saved.items[0].config_json).palette,palette);assert.equal(saved.items[0].photos[0].analysis.vessel,'Frying pan with metal handles');}finally{second.close();}
 const request=f.providerCalls.find(c=>c.operation==='image').payload;assert.ok(request.prompt.startsWith(PHOTO_PROFILE_VERSION+'\n'+PHOTO_INSTRUCTIONS));assert.match(request.prompt,/Selected spoon\/utensil color: #3a705e/);assert.doesNotMatch(request.prompt,/#ffffff/);
 const count=f.providerCalls.length;f.batches.retry(item.id,'photo:'+row.photos[0].id);await f.drainBatch();assert.equal(f.providerCalls.length,count);
});

for (const version of [2,3]) test(`frozen v${version} jobs keep their instructions and prompt shape after the v4 update`,async t=>{
 const f=await referenceFixture(t);const row=await f.upload(1,7);const b=f.batches.create([{importId:row.id}],f.settings);
 const item=f.batches.item(b.items[0].id),config=JSON.parse(item.config_json);
 const oldPalette={cookware:'#112233',surface:'#ccbbaa',...(version===3?{utensil:'#664422'}:{})};
 Object.assign(config,{palette:oldPalette,photoProfile:`recipe-photo-editor-v${version}`,photoInstructions:`Saved v${version} photo instructions: retain original wooden utensil finish.`,analysisProfile:'recipe-photo-understanding-v1',analysisInstructions:'Saved v1 understanding instructions.'});
 const oldSettings={...b.settings,palette:oldPalette};
 f.store.db.prepare('UPDATE content_items SET config_json=? WHERE id=?').run(JSON.stringify(config),item.id);
 f.store.db.prepare('UPDATE content_batches SET settings_json=? WHERE id=?').run(JSON.stringify(oldSettings),b.id);
 f.approve(b);saveContentSettings(f.store,{...f.settings,palette:{cookware:'#ff0000',surface:'#00ff00',utensil:'#0000ff'}});await f.drainBatch();
 const image=f.providerCalls.find(c=>c.operation==='image').payload;
 const analysis=f.batches.detail(b.id).items[0].photos[0].analysis;
 const expected=`recipe-photo-editor-v${version}\n${config.photoInstructions}\nSelected cookware/bowl color: #112233. Selected surrounding surface color: #ccbbaa.${version===3?' Selected spoon/utensil color: #664422.':''} Keep this palette consistent throughout this recipe.\nConfirmed photograph context: ${JSON.stringify(analysis)}\nOutput dimensions: 1536x864. Use this photograph's own original reference. Return one edited photograph.`;
 assert.equal(image.prompt,expected);assert.equal(f.providerCalls[0].payload.instructions,'recipe-photo-understanding-v1\n'+config.analysisInstructions);
 assert.deepEqual(f.batches.detail(b.id).settings.palette,oldPalette);assert.equal(f.batches.item(item.id).config_json,JSON.stringify(config));
 const calls=f.providerCalls.length;f.batches.retry(item.id,'photo:'+row.photos[0].id);await f.drainBatch();assert.equal(f.providerCalls.length,calls);
});
test('changed selections invalidate approval and a refreshed estimate snapshots only the new selection',async t=>{
 const f=await referenceFixture(t);const row=await f.upload(3);let b=f.batches.create([{importId:row.id}],f.settings);f.imports.select(row.id,[row.photos[0].id]);assert.throws(()=>f.approve(b),/changed/);
 b=prepareReferenceBatch(f.batches,b.id);assert.equal(b.items[0].photos.length,1);assert.equal(b.quote.lines.filter(l=>l.kind.startsWith('photo:')).length,1);f.approve(b);await f.drainBatch();assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,1);
});
test('uncertain context holds one photo, other images continue; explicit review resumes only that image',async t=>{
 const f=await referenceFixture(t,{reviewFirst:true});const row=await f.upload(2);const b=f.batches.create([{importId:row.id}],f.settings);f.approve(b);await f.drainBatch();let item=f.batches.detail(b.id).items[0];assert.equal(item.state,'review');assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,1);
 reviewPhoto(f.batches,item.id,row.photos[0].id,{...contexts[0],stepIndex:null});await f.drainBatch();assert.equal(f.providerCalls.filter(c=>c.operation==='text').length,1);assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,2);assert.equal(f.batches.detail(b.id).status,'completed');
});
test('a failed save reuses its receipt and a failed or uncertain image does not repeat automatically',async t=>{
 let imageCalls=0;const f=await referenceFixture(t,{provider:async(op)=>{if(op==='image'&&++imageCalls===1)throw new ProviderFailure('Connection interrupted.');}});const row=await f.upload(2);const b=f.batches.create([{importId:row.id}],f.settings);f.approve(b);await f.drainBatch();const item=f.batches.detail(b.id).items[0];assert.equal(item.state,'partial');assert.equal(imageCalls,2);assert.ok(f.batches.budget(b.id).held>0);assert.throws(()=>f.batches.retry(item.id,'photo:'+row.photos[0].id),/uncertain/);
 f.batches.recover();await f.drainBatch();assert.equal(imageCalls,2);
 const secondKind='photo:'+row.photos[1].id;const before=f.providerCalls.length; const real=f.batches.artifacts.referenceImage.bind(f.batches.artifacts);let fail=true;f.batches.artifacts.referenceImage=async(...args)=>{if(fail){fail=false;throw new Error('Disk full');}return real(...args);};
 f.batches.retry(item.id,secondKind);await f.drainBatch();assert.equal(f.providerCalls.length,before);f.batches.retry(item.id,secondKind);await f.drainBatch();assert.equal(f.providerCalls.length,before);assert.equal(f.batches.detail(b.id).items[0].stages.find(s=>s.kind===secondKind).state,'done');
});
test('article saves before images and image retries preserve it; no-date imports do not alter reports',async t=>{
 const f=await referenceFixture(t);const row=await f.upload(1,7); const source=f.seed();const recipe=JSON.parse(f.store.db.prepare('SELECT recipe_json FROM recipe_records WHERE id=?').get(source.id).recipe_json);
 f.store.db.prepare("UPDATE recipe_imports SET kind='url',url=?,recipe_json=? WHERE id=?").run(recipe.url,JSON.stringify(recipe),row.id);
 const b=f.batches.create([{importId:row.id}],{...f.settings,output:'article_images',articleFormat:'compact_v1'});f.approve(b);let stage;
 while((stage=f.batches.claim(f.owner))){if(stage.kind.startsWith('analysis:'))assert.ok(f.batches.detail(b.id).items[0].files.some(x=>x.name==='article.html'));await f.batchEngine.process(stage);}f.batches.refresh();
 const item=f.batches.detail(b.id).items[0];const original=item.article_json;const count=f.providerCalls.filter(c=>c.operation==='text').length;f.batches.retry(item.id,'photo:'+row.photos[0].id);await f.drainBatch();assert.equal(f.batches.item(item.id).article_json,original);assert.equal(f.providerCalls.filter(c=>c.operation==='text').length,count);
 assert.equal(f.store.db.prepare("SELECT count(*) n FROM recipe_records WHERE verification_status='verified'").get().n,1);
});
test('one recipe waiting for selection cannot block another; later selected work needs renewed approval',async t=>{
 const f=await referenceFixture(t);const first=await f.upload(1,7),second=await f.upload(4);f.imports.select(second.id,[]);let b=f.batches.create([{importId:first.id},{importId:second.id}],f.settings);f.approve(b);await f.drainBatch();assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,1);
 f.imports.select(second.id,second.photos.map(p=>p.id));b=prepareReferenceBatch(f.batches,b.id);await f.drainBatch();assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,1);assert.equal(b.items[1].state,'awaiting_item_approval');f.approve(b);await f.drainBatch();assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,5);
});
test('unsafe imports, oversized decoding and forged selections are rejected',async t=>{
 const f=await referenceFixture(t);assert.throws(()=>f.imports.create('http://127.0.0.1/admin'),/public|Blocked|localhost|network|local/i);const row=await f.upload(1);assert.throws(()=>f.imports.select(row.id,['other-photo']),/usable/);await assert.rejects(f.imports.add(row.id,Buffer.from('<svg/>'),'x.svg'));await assert.rejects(f.imports.add(row.id,Buffer.alloc(11*1024*1024),'x.jpg'),/10 MB/);
});

test('a missing original affects only its photo; remaining images and comparison gallery still save',async t=>{
 const f=await referenceFixture(t);const imported=await f.upload(2);const b=f.batches.create([{importId:imported.id}],f.settings);f.approve(b);
 await f.batchEngine.process(f.batches.claim(f.owner));await f.batchEngine.process(f.batches.claim(f.owner));
 const damaged=f.store.db.prepare('SELECT relative_path FROM reference_photos WHERE id=?').get(imported.photos[0].id);const filename=path.resolve(f.root,damaged.relative_path);assert.ok(filename.startsWith(path.resolve(f.root)+path.sep));fs.unlinkSync(filename);
 await f.drainBatch();const item=f.batches.detail(b.id).items[0];assert.equal(item.state,'partial');assert.equal(item.stages.find(s=>s.kind==='photo:'+imported.photos[1].id).state,'done');assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,1);assert.ok(item.files.some(f=>f.name==='gallery.html'));
});

test('restart after an interrupted paid image retains its reservation and continues other selected images',async t=>{
 const f=await referenceFixture(t);const imported=await f.upload(2);const b=f.batches.create([{importId:imported.id}],f.settings);f.approve(b);
 await f.batchEngine.process(f.batches.claim(f.owner));await f.batchEngine.process(f.batches.claim(f.owner));const interrupted=f.batches.claim(f.owner);assert.ok(interrupted.kind.startsWith('photo:'));
 f.store.db.prepare("INSERT INTO api_calls(id,batch_id,stage_id,model,operation,state,reserved_usd,request_hash,created_at,attempt) VALUES('interrupted',?,?,'gpt-image-2.6-sunburst','image','dispatched',.1,'interrupted-hash',?,0)").run(b.id,interrupted.id,new Date().toISOString());
 f.batches.recover();await f.drainBatch();assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,1);assert.equal(f.batches.detail(b.id).items[0].stages.find(s=>s.id===interrupted.id).state,'uncertain');assert.equal(f.batches.budget(b.id).held,.1);
});

test('eleven selected originals use two cached analysis groups and eleven independent image jobs',async t=>{
 const f=await referenceFixture(t);const imported=f.imports.create();
 for(let i=0;i<11;i++){const bytes=await sharp(path.join(directory,names[i%8]+'.jpg')).resize(400+i,600+i,{fit:'inside'}).jpeg({quality:86}).toBuffer();await f.imports.add(imported.id,bytes,'different-photo-'+i+'.jpg');}
 const photos=f.imports.detail(imported.id).photos;assert.equal(photos.length,11);f.imports.select(imported.id,photos.map(p=>p.id));const b=f.batches.create([{importId:imported.id}],f.settings);assert.equal(b.quote.lines.filter(l=>l.kind.startsWith('analysis:')).length,2);f.approve(b,20);await f.drainBatch();
 const analysis=f.providerCalls.filter(c=>c.operation==='text');assert.deepEqual(analysis.map(c=>c.payload.input[0].content.filter(v=>v.type==='input_image').length),[10,1]);assert.equal(f.providerCalls.filter(c=>c.operation==='image').length,11);assert.equal(f.batches.detail(b.id).status,'completed');
});

test('alternative source selection rediscovers photos and requires a fresh estimate and approval',async t=>{
 const f=await referenceFixture(t);const imported=await f.upload(1,7);const original=f.seed();const source=JSON.parse(f.store.db.prepare('SELECT recipe_json FROM recipe_records WHERE id=?').get(original.id).recipe_json);
 f.store.db.prepare("UPDATE recipe_imports SET kind='url',url=?,recipe_json=? WHERE id=?").run(source.url,JSON.stringify(source),imported.id);
 let b=f.batches.create([{importId:imported.id}],{...f.settings,output:'article_images',mode:'before_articles',articleFormat:'compact_v1'});f.approve(b);const itemId=b.items[0].id;
 const alternative={...source,url:'https://alternative.example/soup/'};f.store.db.prepare("UPDATE content_items SET source_json=?,selection_reason='Selected alternative source.' WHERE id=?").run(JSON.stringify(alternative),itemId);f.batches.stage(itemId,'select','done');
 assert.equal(f.batches.selectedSource(itemId,alternative,b.settings),true);assert.equal(f.batches.item(itemId).state,'preparing');assert.equal(f.store.db.prepare('SELECT count(*) n FROM content_photos WHERE item_id=?').get(itemId).n,0);
 const nextImport=f.batches.item(itemId).import_id;f.responses.set(alternative.url,html().replace('</body>','<article><img src="https://alternative.example/photo.jpg"></article></body>'));f.responses.set('https://alternative.example/photo.jpg',fs.readFileSync(path.join(directory,'06-creamy-chili.jpg')));await f.imports.process(nextImport,f.fetcher);
 b=prepareReferenceBatch(f.batches,b.id);assert.equal(b.items[0].state,'awaiting_item_approval');await f.drainBatch();assert.equal(f.providerCalls.length,0);f.approve(b);await f.drainBatch();assert.equal(f.batches.item(itemId).review_kind,'article');f.batches.approveItem(itemId);await f.drainBatch();assert.equal(f.batches.detail(b.id).status,'completed');
 assert.ok(f.providerCalls.filter(c=>c.operation==='image').every(c=>Buffer.from(c.payload.references[0].split(',')[1],'base64').equals(fs.readFileSync(path.join(directory,'06-creamy-chili.jpg')))));
});

test('article mapping uses supported ingredient and step positions while unmapped photographs remain a gallery',()=>{
 const {articleDocument}=require('../.intelligence-build/lib/recipe-intelligence/article-document.js');
 const recipe={title:'Chili',url:'https://food.example/chili',ingredients:['1 onion'],instructions:['Soften the onion.','Add broth.'],tips:[],storage:[]};
 const images=[['ingredients','ingredient.jpg',null],['step','step.jpg',2],['gallery','unknown.jpg',null]].map(([placement,fileName,stepIndex])=>({kind:'reference',placement,fileName,stepIndex,width:1536,height:864,dataUri:'data:image/jpeg;base64,'+fileName,caption:fileName}));
 const output=articleDocument({...article(),instructions:recipe.instructions},recipe,images).html;
 assert.ok(output.indexOf('ingredient.jpg')>output.indexOf('Ingredients')&&output.indexOf('ingredient.jpg')<output.indexOf('Instructions'));
 assert.ok(output.indexOf('step.jpg')>output.indexOf('Add broth.'));assert.ok(output.indexOf('unknown.jpg')>output.indexOf('Photo gallery'));assert.match(output,/<ol start="2">/);
});

test('migration 4 backs up a real version-3 batch and preserves its stages, receipts and legacy settings',async t=>{
 const Database=require('better-sqlite3');const {temporary}=require('./helpers/recipe-fixtures.cjs');const {prepareRoot}=require('../.intelligence-build/lib/recipe-intelligence/paths.js');const {MIGRATION_2,MIGRATION_3}=require('../.intelligence-build/lib/recipe-intelligence/migrations.js');
 const root=prepareRoot(temporary(t));const filename=path.join(root,'database/recipe-intelligence.sqlite');const old=new Database(filename);t.after(()=>{if(old.open)old.close();});const source=fs.readFileSync(path.join(__dirname,'../lib/recipe-intelligence/database.ts'),'utf8');const schema=source.match(/const SCHEMA = `([\s\S]*?)`;/)[1];old.exec(schema);old.exec(MIGRATION_2);old.exec(MIGRATION_3);
 old.prepare("INSERT INTO tracked_sites(id,name,url,site_key,status,created_at) VALUES('site','Old','https://food.example/','food.example','active','2026-01-01')").run();old.prepare("INSERT INTO recipe_records(id,site_id,canonical_url,first_seen_at,last_seen_at,origin) VALUES(1,'site','https://food.example/soup','2026-01-01','2026-01-01','baseline_existing')").run();
 old.prepare("INSERT INTO content_batches(id,created_at,status,settings_json,quote_json) VALUES('batch','2026-01-01','completed',?,?)").run(JSON.stringify({textModel:'gpt-5.4-mini',images:true}),JSON.stringify({createdAt:'2026-01-01',lines:[]}));old.prepare("INSERT INTO content_items(id,batch_id,recipe_id,basis,state) VALUES('item','batch',1,'original','completed')").run();
 old.prepare("INSERT INTO content_stages(item_id,kind,state,updated_at) VALUES('item','featured','done','2026-01-01')").run();old.prepare("INSERT INTO api_calls(id,batch_id,stage_id,model,operation,state,reserved_usd,actual_usd,created_at,response_path,request_hash) VALUES('call','batch',1,'gpt-image-2.6-sunburst','image','succeeded',.1,.05,'2026-01-01','research/api-receipts/old.json','saved-request-hash')").run();old.prepare("INSERT INTO artifacts(id,item_id,name,relative_path,sha256,size_bytes,media_type,created_at) VALUES('file','item','featured.jpg','articles/old.jpg','saved-checksum',100,'image/jpeg','2026-01-01')").run();old.close();
 const updated=await IntelligenceStore.open(root);try{assert.equal(updated.db.pragma('user_version',{simple:true}), 5);assert.deepEqual(updated.db.pragma('foreign_key_check'),[]);const batch=new BatchStore(updated).detail('batch');assert.equal(batch.settings.imageWorkflow,undefined);assert.equal(batch.items[0].stages[0].kind,'featured');assert.equal(batch.items[0].files[0].name,'featured.jpg');assert.equal(batch.budget.actual,.05);const backupName=fs.readdirSync(path.join(root,'backups')).find(n=>n.startsWith('before-migration-4'));assert.ok(backupName);const backup=new Database(path.join(root,'backups',backupName),{readonly:true});try{assert.equal(backup.pragma('user_version',{simple:true}),3);assert.equal(backup.prepare('SELECT count(*) n FROM api_calls').get().n,1);}finally{backup.close();}}finally{updated.close();}
});
