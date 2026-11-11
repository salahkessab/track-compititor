const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {contentFixture}=require('./helpers/content-fixtures.cjs');
const {ImportStore}=require('../.intelligence-build/lib/recipe-intelligence/imports.js');
const {deleteGeneration,previewGenerationDeletion}=require('../.intelligence-build/lib/recipe-intelligence/deleteGeneration.js');
const {atomicWrite}=require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const {prepareReferenceBatch}=require('../.intelligence-build/lib/recipe-intelligence/referenceWorkflow.js');

test('deleting a finished generation removes every version and paid payload while retaining costs and other recipes',async t=>{
  const f=await contentFixture(t),a=f.seed('first'),b=f.seed('second');
  const batch=f.batches.create([{recipeId:a.id},{recipeId:b.id}],{...f.defaults,correction:false});f.approve(batch);await f.drainBatch();
  const item=f.batches.item(batch.items[0].id),other=batch.items[1].id;
  f.batches.artifacts.forkVersion(item);
  const extra=`research/requests/${item.id}-older-attempt.json`;atomicWrite(f.root,extra,'large old request');
  const budget=f.batches.budget(batch.id),calls=f.store.db.prepare('SELECT * FROM api_calls WHERE stage_id IN (SELECT id FROM content_stages WHERE item_id=?)').all(item.id);
  const otherFiles=f.store.db.prepare('SELECT relative_path FROM artifacts WHERE item_id=?').all(other);
  const preview=previewGenerationDeletion(f.store,item.id);assert.ok(preview.bytes>0);assert.ok(preview.fileCount>10);
  assert.throws(()=>deleteGeneration(f.store,item.id,false),/Confirm/);assert.ok(fs.existsSync(path.join(f.root,'articles',item.id)));
  const result=deleteGeneration(f.store,item.id,true);assert.equal(result.bytesFreed,preview.bytes);assert.equal(result.batchEmpty,false);
  assert.ok(!fs.existsSync(path.join(f.root,'articles',item.id)));assert.ok(!fs.existsSync(path.join(f.root,extra)));
  for(const call of calls)assert.ok(!fs.existsSync(path.join(f.root,'research/api-receipts',call.id+'.json')));
  for(const file of otherFiles)assert.ok(fs.existsSync(path.join(f.root,file.relative_path)));
  assert.deepEqual(f.batches.budget(batch.id),budget);assert.equal(f.batches.detail(batch.id).items.length,1);assert.equal(f.batches.list()[0].count,1);
  const saved=f.store.db.prepare('SELECT * FROM content_items WHERE id=?').get(item.id);assert.equal(saved.state,'deleted');assert.equal(saved.article_json,null);assert.equal(saved.source_json,null);assert.equal(saved.config_json,null);
  assert.throws(()=>f.batches.retry(item.id,'article',true),/not found/);assert.deepEqual(f.store.db.pragma('foreign_key_check'),[]);
  assert.equal(deleteGeneration(f.store,item.id,true).bytesFreed,0);
});

test('shared originals stay until their last generation is deleted, then disappear from storage and the library',async t=>{
  const f=await contentFixture(t),imports=new ImportStore(f.store),source=imports.createFromText('https://food.example/soup','Soup\nIngredients\n1 carrot\nInstructions\nCook the carrot.');
  const image=await require('sharp')({create:{width:200,height:150,channels:3,background:'#d78522'}}).png().toBuffer();await imports.add(source.id,image,'Original');
  const browser=`research/browser/${source.id}.json`;atomicWrite(f.root,browser,'captured research');
  const create=()=>{const batch=f.batches.create([{importId:source.id}],{...f.defaults,output:'article_only',correction:false});f.store.db.prepare("UPDATE content_items SET state='completed' WHERE batch_id=?").run(batch.id);return batch;};
  const first=create(),second=create(),original=imports.detail(source.id).photos[0],originalPath=imports.read(original.id);
  assert.equal(previewGenerationDeletion(f.store,first.items[0].id).sharedSource,true);
  deleteGeneration(f.store,first.items[0].id,true);assert.equal(imports.detail(source.id).photos.length,1);assert.ok(imports.read(original.id).bytes.equals(originalPath.bytes));
  assert.doesNotThrow(()=>prepareReferenceBatch(f.batches,second.id));
  const last=previewGenerationDeletion(f.store,second.items[0].id);assert.equal(last.sharedSource,false);assert.ok(last.bytes>=image.length);
  deleteGeneration(f.store,second.items[0].id,true);
  assert.ok(!fs.existsSync(path.join(f.root,'research/references',source.id)));assert.ok(!fs.existsSync(path.join(f.root,browser)));
  assert.equal(imports.list().length,0);assert.equal(f.batches.list().length,0);
  assert.throws(()=>imports.get(source.id),/deleted/);assert.throws(()=>f.batches.create([{importId:source.id}],f.defaults),/deleted/);
  assert.deepEqual(f.store.db.pragma('foreign_key_check'),[]);
});

test('active work cannot be deleted and uncertain charges are never forgiven',async t=>{
  const f=await contentFixture(t),row=f.seed(),batch=f.batches.create([{recipeId:row.id}],f.defaults),id=batch.items[0].id;
  assert.throws(()=>previewGenerationDeletion(f.store,id),/Finish generation/);
  f.approve(batch);const stage=f.batches.claim(f.owner);assert.ok(stage);assert.throws(()=>deleteGeneration(f.store,id,true),/current request/);
  await f.batchEngine.process(stage);await f.drainBatch();
  f.store.db.prepare("UPDATE api_calls SET state='uncertain',actual_usd=NULL WHERE batch_id=?").run(batch.id);
  const before=f.store.db.prepare('SELECT id,state,reserved_usd,actual_usd FROM api_calls WHERE batch_id=?').all(batch.id);
  deleteGeneration(f.store,id,true);
  assert.deepEqual(f.store.db.prepare('SELECT id,state,reserved_usd,actual_usd FROM api_calls WHERE batch_id=?').all(batch.id),before);
  f.batches.recover();assert.equal(f.batches.claim(f.owner),null);assert.equal(f.batches.list().length,0);
});

test('an interrupted deletion stays retryable and cannot regenerate missing files',async t=>{
  const f=await contentFixture(t),row=f.seed(),batch=f.batches.create([{recipeId:row.id}],f.defaults),id=batch.items[0].id;
  f.approve(batch);await f.drainBatch();
  const original=fs.unlinkSync;let failed=false;
  fs.unlinkSync=function(file){if(!failed&&String(file).endsWith('article.txt')){failed=true;const error=new Error('File in use');error.code='EBUSY';throw error;}return original.apply(this,arguments);};
  let result;try{result=deleteGeneration(f.store,id,true);}finally{fs.unlinkSync=original;}
  assert.equal(result.deleted,false);assert.equal(f.store.db.prepare('SELECT state FROM content_items WHERE id=?').get(id).state,'delete_failed');
  assert.throws(()=>f.batches.retry(id,'article',true),/Deletion is pending/);assert.equal(f.batches.detail(batch.id).items[0].deletion.allowed,true);
  assert.equal(deleteGeneration(f.store,id,true).deleted,true);assert.ok(!fs.existsSync(path.join(f.root,'articles',id)));
});

test('deletion rejects traversal and junctions without touching another folder',async t=>{
  const f=await contentFixture(t),row=f.seed(),batch=f.batches.create([{recipeId:row.id}],f.defaults),id=batch.items[0].id;
  f.store.db.prepare("UPDATE content_items SET state='completed' WHERE id=?").run(id);
  const own=path.join(f.root,'articles',id),other=path.join(f.root,'images','unrelated');fs.mkdirSync(own,{recursive:true});fs.mkdirSync(other,{recursive:true});fs.writeFileSync(path.join(other,'keep.txt'),'Keep me');
  assert.throws(()=>deleteGeneration(f.store,'../../images',true),/Invalid recipe ID/);
  try{fs.symlinkSync(other,path.join(own,'linked'),process.platform==='win32'?'junction':'dir');}catch(e){if(e.code==='EPERM'){t.skip('Link creation requires privileges on this system');return;}throw e;}
  assert.throws(()=>deleteGeneration(f.store,id,true),/linked folder/);assert.equal(fs.readFileSync(path.join(other,'keep.txt'),'utf8'),'Keep me');assert.equal(f.store.db.prepare('SELECT state FROM content_items WHERE id=?').get(id).state,'completed');
});
