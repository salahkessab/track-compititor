const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const directory=path.join(__dirname,'../extensions/recipe-intelligence-capture');
const script=name=>fs.readFileSync(path.join(directory,name),'utf8');
function page(html,url='https://decor.example/ideas'){
  const w=new JSDOM(html,{url,runScripts:'outside-only'}).window;
  for(const name of ['page-tools.js','shared.js'])w.eval(script(name));
  return w;
}
test('bulk article photos keep distinct repeated headings and manual prose across rescans',t=>{
  const w=page('<article><h1>Ideas</h1><p>Source paragraph</p><h2>Office</h2><img src="/a.jpg"><h2>Office</h2><img src="/b.jpg"></article>');t.after(()=>w.close());
  const source=w.eval(script('content.js'));
  const base={...source,html:'<article><h1>Ideas</h1><p>My own introduction.</p></article>',images:[]};
  const {addArticlePhotos,sectionsOf}=w.CaptureHelpers;
  const result=addArticlePhotos(base,source,'Ideas');
  const sections=sectionsOf(result).sections;
  assert.match(sections[1].blocks[0].src,/a\.jpg$/);
  assert.match(sections[2].blocks[0].src,/b\.jpg$/);
  assert.equal(addArticlePhotos(result,source,'Ideas').html,result.html);
  assert.match(result.text,/My own introduction/);assert.doesNotMatch(result.text,/Source paragraph/);
});
test('context menus stage only explicit top-level text and image selections for their article',async()=>{
  let clicked,installed,reviewed=0;
  const items=[],menus=[],tab={id:11,windowId:1,url:'https://decor.example/ideas#rooms'};
  const chrome={action:{onClicked:{addListener(){}}},runtime:{onInstalled:{addListener(fn){installed=fn;}}},
    contextMenus:{removeAll(fn){fn();},create(menu){menus.push(menu);},onClicked:{addListener(fn){clicked=fn;}}},
    storage:{session:{async set(record){items.push(...Object.values(record));}}}};
  const {articleAddress}=require('../extensions/recipe-intelligence-capture/shared.js');
  require('node:vm').runInNewContext(script('background.js'),{chrome,importScripts(){},crypto:require('node:crypto'),
    CaptureHelpers:{articleAddress,async openManualReview(){reviewed++;}}});
  installed();assert.equal(menus.length,2);
  const info={menuItemId:'capture-article-text',selectionText:'Living room',pageUrl:tab.url,frameId:0};
  await clicked({...info,editable:true},tab);await clicked({...info,frameId:2},tab);
  await clicked({...info,pageUrl:'https://decor.example/other'},tab);assert.equal(items.length,0);
  await clicked(info,tab);await clicked({...info,menuItemId:'capture-article-image',srcUrl:'https://cdn.example/room.jpg'},tab);
  assert.deepEqual(items.map(i=>[i.page,i.kind,i.value]),[
    ['https://decor.example/ideas','text','Living room'],['https://decor.example/ideas','image','https://cdn.example/room.jpg']]);
  assert.equal(reviewed,2);
});
test('manual photo reassignment preserves both sections and plain text is escaped',t=>{
  const w=page('<article><h1>Ideas</h1><h2>Room</h2><p>Original paragraph</p><img src="/rug.jpg"><h2>Room</h2><p>Second paragraph</p></article>');t.after(()=>w.close());
  const capture=w.eval(script('content.js')),edit=w.CaptureHelpers.addManualItem;
  const photo={title:capture.title,kind:'image',section:2,value:'https://decor.example/rug.jpg'};
  const result=edit(capture,photo);
  assert.equal(result.images.length,1);
  const {sections}=w.CaptureHelpers.sectionsOf(result);
  assert.ok(sections[1].blocks.some(b=>b.textContent==='Original paragraph'));
  assert.equal(sections[1].blocks.some(b=>b.nodeName==='IMG'),false);
  assert.equal(sections[2].blocks.at(-1).nodeName,'IMG');
  assert.match(edit(result,{title:capture.title,kind:'text',section:1,value:'<img onerror=oops>'}).html,/&lt;img onerror=oops&gt;/);
  assert.throws(()=>edit(result,{...photo,value:'http://127.0.0.1/photos/a.jpg'}),/public|Private/);
  assert.throws(()=>edit(result,{...photo,section:99}),/section/);
});
test('multipart capture preserves image headings, lists, and rescan ordering',t=>{
  const first=page('<article><h1>Ideas</h1><h2>A</h2><p>First</p><h2>C</h2><p>Third</p></article>');t.after(()=>first.close());
  const initial=first.eval(script('content.js'));
  first.document.querySelectorAll('h2')[1].insertAdjacentHTML('beforebegin','<h2>B</h2><ul><li>Second</li></ul><img src="/b.jpg">');
  const {mergePart}=first.CaptureHelpers;
  const updated=mergePart(initial,first.eval(script('content.js'))).capture;
  const next=page('<article><h1>Ideas page two</h1><h2>C</h2><p>Third</p><h2>D</h2><p>Fourth</p><img src="/d.jpg"></article>','https://decor.example/ideas/2');t.after(()=>next.close());
  const more=next.eval(script('content.js'));
  const merged=mergePart(updated,more).capture;
  assert.match(merged.html,/<h2>A.*<h2>B.*<ul><li>Second.*b.jpg.*<h2>C.*<h2>D.*d.jpg/s);
  assert.deepEqual(Array.from(merged.images,p=>p.sourceHeading),['B','D']);
  assert.equal(mergePart(merged,more).added,0);
  assert.throws(()=>mergePart(merged,{...more,url:'https://other.example/page'}),/same website/);
});
test('manual recipe text with labelled lists is accepted by the real recipe reader',t=>{
  const w=page('<article><h1>Carrot soup</h1><p>Lunch.</p></article>');t.after(()=>w.close());
  const base=w.eval(script('content.js'));
  const next=w.CaptureHelpers.addManualItem(base,{title:'Carrot soup',kind:'text',section:0,recipe:true,value:'Ingredients:\n500 g carrots\n750 ml water\nInstructions:\nSimmer for 20 minutes.'});
  const {extractHtmlRecipe}=require('../.intelligence-build/lib/recipe-intelligence/html-recipe.js');
  const {recipe}=extractHtmlRecipe(require('cheerio').load(next.html),base.url);
  assert.deepEqual(recipe.ingredients,['500 g carrots','750 ml water']);
  assert.deepEqual(recipe.instructions,['Simmer for 20 minutes.']);
});
test('highlighted boundaries capture the requested paragraphs and images and can be reused on a similar layout',t=>{
  const layout='<article><h1>Ideas</h1><p>Outside first</p><h2>Bedroom</h2><p>Place a rug next to the bed.</p><img src="/rug.jpg"><p>End here.</p><h2>Other</h2><img src="/other.jpg"></article>';
  const w=page(layout);t.after(()=>w.close());
  const range=w.document.createRange();range.setStart(w.document.querySelector('h2').firstChild,0);range.setEnd(w.document.querySelectorAll('p')[2].firstChild,4);w.getSelection().addRange(range);
  const rule=w.RecipeCapturePage.selectionRule();
  for(const target of [w,page(layout.replace('Bedroom','Living room'),'https://decor.example/second')]){
    if(target!==w)t.after(()=>target.close());
    target.recipeCaptureBounds={url:target.location.href,rule};
    const capture=target.eval(script('content.js'));
    assert.doesNotMatch(capture.text,/Outside first|Other/);assert.match(capture.text,/End here/);
    assert.deepEqual(Array.from(capture.images,p=>p.url),['https://decor.example/rug.jpg']);
    target.document.querySelectorAll('p')[2].remove();
    assert.equal(target.RecipeCapturePage.resolveRule(rule),null);
  }
});
