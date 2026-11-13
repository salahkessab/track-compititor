const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {contentFixture}=require('./helpers/content-fixtures.cjs');
const {articleStorageSummary,previewArticleStorageDeletion,deleteAllArticles}=require('../.intelligence-build/lib/recipe-intelligence/articleStorage.js');
const {DecorStore}=require('../.intelligence-build/lib/recipe-intelligence/decor.js');
const {articleLibrary}=require('../.intelligence-build/lib/recipe-intelligence/library.js');
const {atomicWrite,digest}=require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
function put(f,name,value){return atomicWrite(f.root,name,typeof value==='object'&&!Buffer.isBuffer(value)?JSON.stringify(value):value);}
function asset(f,{input,output,owner,id=digest(input)}){
 put(f,`verified-images/private/${id}/input`,input);put(f,`verified-images/private/${id}/original`,input);
 put(f,`verified-images/private/${id}/job.json`,{state:'ready',output,owner});
 put(f,`verified-images/outputs/${output}`,'image');put(f,`verified-images/proofs/${output}.json`,{variants:{png:output}});return id;
}
test('clears all recipe/decor drafts and archives, old versions, sources and verified variants while preserving the app data and billing',async t=>{
 const f=await contentFixture(t),seed=f.seed(),batch=f.batches.create([{recipeId:seed.id}],f.defaults);f.approve(batch);await f.drainBatch();
 f.store.db.prepare('UPDATE content_items SET archived_at=? WHERE batch_id=?').run(new Date().toISOString(),batch.id);
 f.batches.create([{recipeId:seed.id}],f.defaults);const decor=new DecorStore(f.store);const id=require('crypto').randomUUID();
 f.store.db.prepare('INSERT INTO decor_jobs VALUES(?,?,?,?,?)').run(id,'completed','now','now',JSON.stringify({source:{title:'Room'},article:{title:'Room'},photos:[]}));
 f.store.db.prepare("INSERT INTO decor_calls(id,job_id,stage,state,reserved,actual) VALUES(?,?,'article','completed',1,.2)").run(require('crypto').randomUUID(),id);
 f.store.db.prepare("INSERT INTO settings(key,value) VALUES('test-private-key','encrypted-keep')").run();
 for(const file of ['reports/keep.json','backups/keep.zip','studio-storage/keep.json','images/independent.png'])put(f,file,'keep');
 put(f,'articles/previously-deleted/v1/article.html','old');put(f,`articles/home-decor/${id}/article.html`,'decor');
 const output=digest('article-final'),privateId=asset(f,{input:'article-input',output});put(f,'verified-images/sources/'+digest('article-input')+'.json',{id:output});
 const otherOutput=digest('other-final'),otherId=asset(f,{input:'other-input',output:otherOutput,owner:'other'});
 const sharedId=asset(f,{input:'shared-input',output,owner:'other'});
 const settings=f.store.db.prepare('SELECT * FROM settings ORDER BY key').all(),billing=f.store.db.prepare('SELECT id,state,reserved_usd,actual_usd FROM api_calls').all();
 const before=previewArticleStorageDeletion(f.store);assert.equal(before.total,3);assert.equal(before.archived,1);assert.ok(before.bytes>0);
 const done=deleteAllArticles(f.store,true,before.revision);assert.equal(done.deleted,true);assert.equal(done.total,0);assert.equal(done.deletedArticles,3);
 assert.equal(articleLibrary(f.batches).total,0);assert.equal(articleLibrary(f.batches,0,'',true).total,0);assert.deepEqual(decor.list(),[]);
 assert.equal(fs.existsSync(path.join(f.root,'articles')),false);assert.equal(fs.existsSync(path.join(f.root,'verified-images/private',privateId)),false);
 for(const file of ['reports/keep.json','backups/keep.zip','studio-storage/keep.json','images/independent.png',`verified-images/private/${otherId}/input`,`verified-images/private/${sharedId}/input`,`verified-images/outputs/${output}`,`verified-images/outputs/${otherOutput}`])assert.ok(fs.existsSync(path.join(f.root,file)),file);
 assert.deepEqual(f.store.db.prepare('SELECT * FROM settings ORDER BY key').all(),settings);assert.deepEqual(f.store.db.prepare('SELECT id,state,reserved_usd,actual_usd FROM api_calls').all(),billing);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM decor_calls').get().n,1);assert.equal(f.store.snapshot().sites.length,1);assert.deepEqual(f.store.db.pragma('foreign_key_check'),[]);
 assert.ok(!f.store.db.prepare("SELECT 1 FROM r2_deleted_paths WHERE relative_path IN ('articles','verified-images','research/references')").get());
 const empty=previewArticleStorageDeletion(f.store);assert.equal(deleteAllArticles(f.store,true,empty.revision).deleted,true);
 f.batches.create([{recipeId:seed.id}],f.defaults);assert.equal(articleStorageSummary(f.store).total,1);assert.equal(f.providerCalls.length,billing.length);
});
test('confirmation, a current preview and idle processing are required before any deletion',async t=>{
 const f=await contentFixture(t),seed=f.seed(),batch=f.batches.create([{recipeId:seed.id}],f.defaults);
 const preview=previewArticleStorageDeletion(f.store);
 assert.throws(()=>deleteAllArticles(f.store,false,preview.revision),/Confirm/);
 assert.throws(()=>deleteAllArticles(f.store,true,'old'),/changed/);
 f.batches.create([{recipeId:seed.id}],f.defaults);assert.throws(()=>deleteAllArticles(f.store,true,preview.revision),/changed/);
 f.approve(batch);const stage=f.batches.claim(f.owner);assert.ok(stage);assert.throws(()=>previewArticleStorageDeletion(f.store),/current generation/);
 assert.equal(articleStorageSummary(f.store).total,2);
});
test('an interrupted file removal is retryable even when a private job record has already been removed',async t=>{
 const f=await contentFixture(t),seed=f.seed();f.batches.create([{recipeId:seed.id}],f.defaults);
 const output=digest('retry-final'),id=asset(f,{input:'retry-input',output,owner:'articles'});const preview=previewArticleStorageDeletion(f.store);
 const unlink=fs.unlinkSync;let blocked=false;
 fs.unlinkSync=function(file){if(!blocked&&String(file).endsWith(path.join(id,'original'))){blocked=true;throw Object.assign(new Error('Busy'),{code:'EBUSY'});}return unlink.apply(this,arguments);};
 let result;try{result=deleteAllArticles(f.store,true,preview.revision);}finally{fs.unlinkSync=unlink;}
 assert.equal(result.deleted,false);assert.equal(f.batches.claim(f.owner),null);assert.equal(fs.existsSync(path.join(f.root,`verified-images/private/${id}/job.json`)),false);
 const again=previewArticleStorageDeletion(f.store);assert.equal(deleteAllArticles(f.store,true,again.revision).deleted,true);
 assert.equal(fs.existsSync(path.join(f.root,`verified-images/private/${id}`)),false);assert.equal(fs.existsSync(path.join(f.root,`verified-images/outputs/${output}`)),false);assert.equal(articleStorageSummary(f.store).total,0);
});
test('linked content paths are rejected before changing data',async t=>{
 const f=await contentFixture(t),seed=f.seed();f.batches.create([{recipeId:seed.id}],f.defaults);put(f,'images/keep.txt','keep');
 try{fs.symlinkSync(path.join(f.root,'images'),path.join(f.root,'articles','linked'),process.platform==='win32'?'junction':'dir');}catch(e){if(e.code==='EPERM'){t.skip('Symlink permission');return;}throw e;}
 assert.throws(()=>previewArticleStorageDeletion(f.store),/linked/);assert.equal(fs.readFileSync(path.join(f.root,'images/keep.txt'),'utf8'),'keep');assert.equal(articleStorageSummary(f.store).total,1);
});
