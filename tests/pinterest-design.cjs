const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {runInNewContext}=require('node:vm');

// Exercise the actual route while replacing paid providers and disk image preparation.
function endpoint(overrides={}){
  const calls=[];
  const imports={
    'next/server':{NextResponse:Response},
    '@/lib/imageFinalization':{imageRequestAllowed:()=>true,finalizeGeneration:async()=>{calls.push('verify');return {imageUrl:'/verified',metadata:{state:'verified'}};},preparationFailure:()=>null},
    '@/lib/imageMetadata':{checkImageProcessing:async()=>{}},
    '@/lib/generationStream':{streamGeneration:(req,fn)=>fn(()=>{})},
    '@/lib/costLedger':{withCostLedger:fn=>fn(),recordTextUsage(){},recordOpenAIImage(){},costSummary:()=>({})},
    '@/lib/openaiImageSettings':{validateImageSettings:()=>({size:'1024x1536'})},
    '@/lib/openaiImages':{generateOpenAIImage:async data=>{calls.push(data);return {dataUrl:'private'};}},
    '@/lib/recipeDesigns':{validateAnalysisImage:s=>s,RECIPE_DESIGN_TEXT_MODEL:'writer'},
    '@/lib/pinterestDesign':{pinTemplates:[{id:'retro',layout:'hero and two details'}]},
  };
  const copy={headline:'Noodles',title:'Tuna Noodle Casserole',description:'A creamy noodle bake.',hook:'Golden crumbs',alt:'A casserole with a crumb topping.',
    searchPhrase:'tuna noodle casserole',evidence:'Bake until golden.',alternateHooks:['Creamy noodles','A crumb-topped bake'],...overrides};
  const ctx={exports:{},require:id=>imports[id],Response,AbortSignal,process:{env:{OPENAI_API_KEY:'fixture'}},fetch:async(url,opt)=>{
    calls.push(JSON.parse(opt.body));return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(copy)}]}]});
  }};
  const code=ts.transpileModule(fs.readFileSync(require.resolve('../app/api/pinterest-design/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,ctx);
  return {calls,submit:data=>ctx.exports.POST(new Request('https://studio.example/api/pinterest-design',{method:'POST',body:JSON.stringify(data)}))};
}
test('Pin copy reviews the saved article and every selected photo',async()=>{
  const {submit,calls}=endpoint();
  const r=await submit({action:'copy',approved:true,articleTitle:'Tuna Noodle Casserole',article:'Top the creamy noodles with crumbs. Bake until golden.',photos:['hero','step']});
  assert.equal(r.status,200);const data=await r.json();assert.equal(data.copy.hook,'Golden crumbs');
  assert.equal(data.searchBrief.searchPhrase,'tuna noodle casserole');assert.equal(data.searchBrief.hooks.length,3);
  assert.equal(data.searchBrief.evidenceKind,'article');
  assert.deepEqual(Object.keys(data.copy).sort(),['alt','description','headline','hook','title']);
  assert.match(calls[0].input[0].content[0].text,/Bake until golden/);
  assert.deepEqual(Array.from(calls[0].input[0].content.slice(1),p=>p.image_url),['hero','step']);
});
test('Cold chocolate uses the title and both pictures when article text is absent or blank',async()=>{
  for(const article of [undefined,'  ']){
    const {submit,calls}=endpoint({title:'Cold Chocolate in Two Cups',headline:'Cold Chocolate',searchPhrase:'cold chocolate',
      hook:'A closer look',alternateHooks:['Two cups side by side','A dusting of cocoa color'],
      evidence:'Two cups with dark brown drinks.',alt:'Two cups filled with brown drinks.',description:'Two cups show the dark color of cold chocolate.'});
    const r=await submit({action:'copy',approved:true,articleTitle:'cold chocolate',article,photos:['cup-one','cup-two']});
    assert.equal(r.status,200);assert.equal((await r.json()).searchBrief.evidenceKind,'photo');
    assert.match(calls[0].instructions,/Only a title and photographs/);
    assert.deepEqual(Array.from(calls[0].input[0].content.slice(1),p=>p.image_url),['cup-one','cup-two']);
  }
});
test('Missing title, missing photos and invalid optional article are rejected before a provider call',async()=>{
  for(const input of [{articleTitle:' '},{photos:[]},{article:42},{article:'x'.repeat(40001)}]){
    const {submit,calls}=endpoint();
    assert.equal((await submit({action:'copy',approved:true,articleTitle:'Chocolate',photos:['cup'],...input})).status,400);
    assert.equal(calls.length,0);
  }
});
test('Search writer rejects unsupported excerpts, missing search phrases and title-only hooks',async()=>{
  for(const override of [{evidence:'Ready in ten minutes'},{title:'Everyone loves this dinner'},{hook:'Noodles',alternateHooks:['Noodles','Tuna Noodle Casserole']}]){
    const {submit,calls}=endpoint(override);
    const r=await submit({action:'copy',approved:true,articleTitle:'Tuna Noodle Casserole',article:'Bake until golden.',photos:['hero']});
    assert.equal(r.status,502);assert.equal((await r.json()).copy,undefined);assert.equal(calls.length,1);
  }
});
test('Usable copy survives missing, duplicate or extra alternative hooks without a second provider call',async()=>{
  for(const [alternatives,expected] of [
    [null,['Golden crumbs']],
    [[],['Golden crumbs']],
    [[' gOlden crumbs ','Noodles','x'.repeat(77)],['Golden crumbs']],
    [['Creamy noodles'],['Golden crumbs','Creamy noodles']],
    [['Golden crumbs','Creamy noodles','Baked until golden','Extra'],['Golden crumbs','Creamy noodles','Baked until golden']]
  ]){
    const {submit,calls}=endpoint({alternateHooks:alternatives});
    const r=await submit({action:'copy',approved:true,articleTitle:'Tuna Noodle Casserole',article:'Bake until golden.',photos:['hero']});
    assert.equal(r.status,200);const data=await r.json();assert.deepEqual(data.searchBrief.hooks,expected);
    assert.equal(data.copy.title,'Tuna Noodle Casserole');assert.equal(data.copy.description,'A creamy noodle bake.');assert.equal(calls.length,1);
    const schema=calls[0].text.format.schema.properties.alternateHooks;
    assert.equal(schema.minItems,2);assert.equal(schema.maxItems,2);
  }
});
test('A French decor Pin uses the article language and its room-specific evidence',async()=>{
  const {submit}=endpoint({title:'Étagères pour une petite entrée',searchPhrase:'petite entrée',headline:'Une entrée dégagée',
    hook:'Libérez le sol',alternateHooks:['Des paniers à portée de main','Une étagère au-dessus du banc'],
    evidence:'deux paniers sur une étagère',description:'Placez deux paniers sur une étagère au-dessus du banc pour libérer le sol.',
    alt:'Deux paniers tressés sur une étagère au-dessus du banc.'});
  const response=await submit({action:'copy',approved:true,articleTitle:'Petite entrée',
    article:'Placez deux paniers sur une étagère au-dessus du banc pour libérer le sol.',photos:['entryway']});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.searchBrief.hooks[0],'Libérez le sol');
});
test('reference uses article photos first and the style reference last, and returns the verified file',async()=>{
  const {submit,calls}=endpoint();
  const body={action:'reference',approved:true,model:'example',style:'retro',headline:'Casserole',hook:'Golden crumbs',photos:['hero','detail'],reference:'layout'};
  assert.equal((await submit({...body,approved:false})).status,400);assert.equal(calls.length,0);
  const r=await submit(body);assert.equal(r.status,200);
  assert.deepEqual(Array.from(calls[0].references),['hero','detail','layout']);assert.match(calls[0].prompt,/Golden crumbs/);
  assert.equal(calls[1],'verify');assert.equal((await r.json()).imageUrl,'/verified');
});
