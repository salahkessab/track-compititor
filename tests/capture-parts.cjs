const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const directory=path.join(__dirname,'../extensions/recipe-intelligence-capture');
const script=name=>fs.readFileSync(path.join(directory,name),'utf8');
function page(html,url='https://decor.example/ideas'){
  const w=new JSDOM(html,{url,runScripts:'outside-only'}).window;
  for(const name of ['page-tools.js','shared.js'])w.eval(script(name));
  return w;
}
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
