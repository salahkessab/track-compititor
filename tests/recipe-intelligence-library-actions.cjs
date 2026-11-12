const test=require('node:test'),assert=require('node:assert/strict');
const {contentFixture}=require('./helpers/content-fixtures.cjs');
const {articleLibrary,archiveLibraryItem}=require('../.intelligence-build/lib/recipe-intelligence/library.js');
const {deleteGeneration}=require('../.intelligence-build/lib/recipe-intelligence/deleteGeneration.js');

test('archive and restore preserve generation and costs; publication statuses reflect each confirmed destination',async t=>{
 const f=await contentFixture(t),source=f.seed(),batch=f.batches.create([{recipeId:source.id}],f.defaults),id=batch.items[0].id;
 const before=f.store.db.prepare('SELECT state,source_json FROM content_items WHERE id=?').get(id);
 assert.equal(articleLibrary(f.batches).total,1);assert.deepEqual(articleLibrary(f.batches).rows[0].publications,[]);
 assert.throws(()=>archiveLibraryItem(f.batches,id,'true'),/Archive or Restore/);
 archiveLibraryItem(f.batches,id,true);assert.equal(articleLibrary(f.batches).total,0);
 assert.equal(articleLibrary(f.batches,0,'',true).rows[0].archived,true);
 assert.deepEqual(f.store.db.prepare('SELECT state,source_json FROM content_items WHERE id=?').get(id),before);
 assert.equal(f.providerCalls.length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM api_calls').get().n,0);
 archiveLibraryItem(f.batches,id,false);assert.equal(articleLibrary(f.batches).total,1);
 for(const [site,state,status]of [['https://one.example','ready','publish'],['https://two.example','ready','draft'],['https://three.example','uncertain','publish']])f.store.db.prepare("INSERT INTO wordpress_exports(site_url,item_id,export_id,document_hash,profile_json,payload_json,state,result_json,updated_at) VALUES(?,?,?,'hash','{}','{}',?,?,?)").run(site,id,site,state,JSON.stringify({status}),new Date().toISOString());
 assert.deepEqual(articleLibrary(f.batches).rows[0].publications.map(p=>[p.site,p.status]),[['one.example','Published'],['three.example','Unconfirmed'],['two.example','Draft']]);
 archiveLibraryItem(f.batches,id,true);f.batches.action(batch.id,'cancel');deleteGeneration(f.store,id,true);
 assert.equal(articleLibrary(f.batches,0,'',true).total,0);assert.throws(()=>archiveLibraryItem(f.batches,id,false),/not found/);
});
