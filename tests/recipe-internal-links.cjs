const test = require('node:test');
const assert = require('node:assert/strict');
const { contentFixture, article } = require('./helpers/content-fixtures.cjs');
const { ArtifactStore } = require('../.intelligence-build/lib/recipe-intelligence/artifacts.js');
const { WordPressStore } = require('../.intelligence-build/lib/recipe-intelligence/wordpress.js');
const { WordPressPublisher } = require('../.intelligence-build/lib/recipe-intelligence/wordpress-publish.js');
const { InternalLinks } = require('../.intelligence-build/lib/recipe-intelligence/internalLinks.js');
const { setting, saveSetting, selectedLinks, renderLinks, eligibleParagraphs } = require('../.intelligence-build/lib/recipe-intelligence/internalLinkState.js');
const json = (v, status=200) => ({ status, body: Buffer.from(JSON.stringify(v)) });
async function fixture(t) {
  const f = await contentFixture(t), r = f.seed();
  const batch = f.batches.create([{recipeId:r.id}],f.defaults), item = f.batches.item(batch.items[0].id);
  const artifacts = new ArtifactStore(f.store);
  artifacts.article(item, article(), JSON.parse(f.store.db.prepare('SELECT recipe_json FROM recipe_records WHERE id=?').get(r.id).recipe_json));
  const calls=[], control={fail:false, posts:[{id:3,title:'Roasted carrot soup',url:'https://kitchen.example/roasted/',categories:['Soup'],summary:'Carrot soup for dinner.',modified:'2026-11-13 00:00:00'}]};
  const wp = new WordPressStore(f.store, async(url,init)=>{
    calls.push({url,...init});
    if(url.includes('/users/me'))return json({id:1,capabilities:{upload_files:true}});
    if(url.endsWith('/profile'))return json({protocol:1,version:'1.3.0',recipeCard:'builtin',recipeCardLabel:'Recipe card',revision:'a'.repeat(64),ready:true,canPublish:true});
    if(url.includes('/articles?')) {
      if(control.fail) return json({},control.fail);
      const page=Number(new URL(url).searchParams.get('page'));
      if(control.pages) return json(control.pages(page));
      return json({articles:control.posts.map(p=>({...p,url:p.url.replace('kitchen.example',new URL(url).host)})),page:1,pages:1,total:control.posts.length,revision:'r1'});
    }
    const payload=JSON.parse(init.body.toString());
    return json({postId:90,status:payload.status,editUrl:'https://kitchen.example/wp-admin/post.php?post=90',postUrl:'https://kitchen.example/carrot-soup/',recipeCard:'builtin',recipeId:null});
  },{protect:async v=>v,unprotect:async v=>v});
  const connect=async site=>(await wp.connect({siteUrl:site,username:'owner',applicationPassword:'abcdefghijklmnopqrstuvwx'})).connections.find(c=>c.siteUrl===site);
  const c=await connect('https://kitchen.example/');
  const links=new InternalLinks(wp);
  const apply=async(s,selected=s.suggestions.map(s=>s.id))=>links.apply(item.id,{connectionId:s.connectionId,contentVersion:s.contentVersion,selected});
  return {...f,item,artifacts,wp,c,links,apply,connect,control,calls};
}
test('sync → suggest → select → preview and all exports → WordPress draft without AI',async t=>{
  const f=await fixture(t);const s=await f.links.suggest(f.item.id,f.c.id);
  assert.equal(s.suggestions.length,1);assert.deepEqual(selectedLinks(f.store,f.item.id),[]);
  await f.apply(s,[3,3]);
  for(const name of ['article.html','article.md','article.txt']) {
    const row=f.store.db.prepare('SELECT id FROM artifacts WHERE item_id=? AND name=?').get(f.item.id,name);
    const output=await f.artifacts.download(row.id);assert.match(output.data.toString(),/https:\/\/kitchen.example\/roasted\//);
  }
  const zip=await f.artifacts.zip(f.item);assert.ok(zip.length>0);
  const pub=new WordPressPublisher(f.wp),p=await pub.prepare(f.item.id,f.c.id);
  assert.equal((p.payload.content.match(/href="https:\/\/kitchen.example\/roasted\/"/g)||[]).length,1);
  const result=await pub.send(f.item.id,{connectionId:f.c.id,reviewHash:p.reviewHash,status:'draft'});
  assert.equal(result.status,'draft');assert.equal(f.store.db.prepare('SELECT count(*) n FROM api_calls').get().n,0);
});
test('site isolation and switching destination clears old choices',async t=>{
  const f=await fixture(t),s=await f.links.suggest(f.item.id,f.c.id);await f.apply(s);
  const c2=await f.connect('https://other.example/');
  assert.deepEqual(selectedLinks(f.store,f.item.id,c2.id),[]);
  f.links.destination(f.item.id,c2.id);assert.deepEqual(selectedLinks(f.store,f.item.id),[]);
  await assert.rejects(f.apply(s),/destination|changed/);
  const s2=await f.links.suggest(f.item.id,c2.id);assert.match(s2.suggestions[0].url,/other.example/);
  await f.apply(s2);assert.match(f.wp.plan(f.item.id,c2.id).html,/other.example\/roasted/);
  assert.doesNotMatch(f.wp.plan(f.item.id,f.c.id).html,/other.example\/roasted/);
});
test('deleted destinations vanish after sync; edits invalidate approval',async t=>{
  const f=await fixture(t),s=await f.links.suggest(f.item.id,f.c.id);await f.apply(s);
  f.control.posts=[];await f.links.sync(f.c.id);assert.deepEqual(selectedLinks(f.store,f.item.id),[]);
  await assert.rejects(f.apply(s),/changed/);
  f.control.posts=[s.suggestions[0]];const next=await f.links.suggest(f.item.id,f.c.id);
  const row=f.store.db.prepare("SELECT id FROM artifacts WHERE item_id=? AND name='article.html'").get(f.item.id);
  f.artifacts.put(f.item,'article.html','<article><h1>Changed</h1></article>','text/html');
  await assert.rejects(f.apply(next),/changed/);assert.deepEqual(selectedLinks(f.store,f.item.id),[]);
});
test('atomic pagination, failed sync, expired refresh, and old-plugin upgrade message',async t=>{
  const f=await fixture(t);await f.links.sync(f.c.id);const old=setting(f.store,'internal_catalogue:'+f.c.id);
  f.control.pages=page=>page===1?{articles:[f.control.posts[0]],page:1,pages:2,total:2,revision:'a'}:{articles:[],page:2,pages:2,total:2,revision:'b'};
  await assert.rejects(f.links.sync(f.c.id),/changed/);assert.deepEqual(setting(f.store,'internal_catalogue:'+f.c.id),old);
  delete f.control.pages;f.control.fail=500;await assert.rejects(f.links.sync(f.c.id),/HTTP 500/);
  saveSetting(f.store,'internal_catalogue:'+f.c.id,{...old,syncedAt:'2000-01-01'});
  await assert.rejects(f.links.suggest(f.item.id,f.c.id),/HTTP 500/);
  f.control.fail=404;await assert.rejects(f.links.sync(f.c.id),/Update Recipe Intelligence Bridge to 1.3/);
});
test('reject invented URLs and choices; omit unrelated results',async t=>{
  const f=await fixture(t);f.control.posts[0].url='https://evil.example/x';await assert.rejects(f.links.sync(f.c.id),/outside/);
  f.control.posts[0].url='https://kitchen.example/x';const s=await f.links.suggest(f.item.id,f.c.id);await assert.rejects(f.apply(s,[999]),/suggestions/);
  f.control.posts=[{...f.control.posts[0],title:'Chocolate cake',categories:['Dessert'],summary:'Bake a cake'}];await f.links.sync(f.c.id);
  assert.equal((await f.links.suggest(f.item.id,f.c.id)).suggestions.length,0);
});
test('safe renderer excludes headings, ingredients, steps, card and duplicate links',()=>{
  const html='<article><h1>Carrot soup</h1><p>Serve with Roasted carrots tonight.</p><h2>Ingredients</h2><p>Roasted carrots</p><ol><li>Roasted carrots</li></ol><section data-ri-recipe-card="1"><p>Roasted carrots</p></section></article>';
  const p='Serve with Roasted carrots tonight.';
  assert.deepEqual(eligibleParagraphs(html),[p]);
  const link={id:1,title:'Roasted carrots',url:'https://kitchen.example/carrot?a=1&b=2',paragraph:p};
  const output=renderLinks(html,[link,link]);
  assert.equal((output.match(/<a /g)||[]).length,1);assert.match(output,/<h1>Carrot soup<\/h1>/);assert.match(output,/<li>Roasted carrots<\/li>/);
  const unsafe=renderLinks(html,[{...link,title:'<img src=x onerror=alert(1)>',paragraph:null}]);
  assert.match(unsafe,/&lt;img/);assert.doesNotMatch(unsafe,/<img|<script/);
});
