const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { assertProtectedPixels, recipeDesignLayout } = require('../.test-build/recipeDesignRenderer.js');
const { referenceTemplate, resolveTemplateColors, TEMPLATE_COLORS } = require('../.test-build/recipeDesignScene.js');
const { DEFAULT_DESIGN_SETTINGS, DESIGN_SCHEMA, RECIPE_STYLE_SPECS, validateTitle, validateDesignPlan, validateTemplateEdits, chooseDistinctFamily, chooseRecipeFamily, chooseLocalRecipeFamily, recipeDesignAspect, recipeDesignSignature, avoidRecentRecipeLayout, normalizeModelDesignPlan, normalizeModelPalette } = require('../.test-build/recipeDesigns.js');
const {RECIPE_STYLE_PRESETS,renderRecipeStylePrompt,validateRecipePromptCopy}=require('../.test-build/recipeDesignStylePresets.js');
let visualFetchMock = async () => [];

function load(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file,mod);
  const source = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const localRequire = id => {
    if(id === '@/lib/recipeVisualFetch') return { fetchVisualCandidates: (...args) => visualFetchMock(...args) };
    if(id.startsWith('@/')) return load(path.resolve(__dirname,'..',id.slice(2)+'.ts'),cache);
    if(id.startsWith('.')) return load(path.resolve(path.dirname(file),id+'.ts'),cache);
    return require(id);
  };
  new Function('require','module','exports',source)(localRequire,mod,mod.exports);
  return mod.exports;
}
const planRoute = load(path.resolve(__dirname,'../app/api/recipe-designs/plan/route.ts'));
const artRoute = load(path.resolve(__dirname,'../app/api/recipe-designs/artwork/route.ts'));
const directRoute = load(path.resolve(__dirname,'../app/api/recipe-designs/generate/route.ts'));
const {recipeDirectPrompt} = load(path.resolve(__dirname,'../lib/recipeDesignDirect.ts'));
const {INGREDIENT_CARD_STYLE_ID,validateRecipeIngredients} = load(path.resolve(__dirname,'../lib/recipeDesignIngredients.ts'));
const {parseVisualResults,separatePlatformGuidance} = load(path.resolve(__dirname,'../lib/recipeVisualResearch.ts'));
const {fetchVisualCandidates} = load(path.resolve(__dirname,'../lib/recipeVisualFetch.ts'));
const plan = {family:'notebook',palette:['#211E1A','#F5E6C9'],typography:'serif',layout:'food first',decoration:'paper texture',referenceSummary:'warm labels',photoSummary:'golden tones',researchSummary:'Designs use restrained framing.'};
const image = 'data:image/jpeg;base64,YWJj';
let generatedPng;
const originalRoot=process.env.IMAGE_ASSET_ROOT;
const imageRoot=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ri-design-route-'));
process.env.IMAGE_ASSET_ROOT=imageRoot;
test.before(async()=>{generatedPng=(await require('sharp')({create:{width:3,height:2,channels:4,background:'#45332288'}}).png().toBuffer()).toString('base64');});
test.after(()=>{if(originalRoot===undefined)delete process.env.IMAGE_ASSET_ROOT;else process.env.IMAGE_ASSET_ROOT=originalRoot;fs.rmSync(imageRoot,{recursive:true,force:true});});
const request = (data) => new Request('http://localhost/api/recipe-designs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
// Preserve the historical research-on fixture in older research tests; new
// preset defaults are independently asserted below.
const settings = (overrides={}) => ({...DEFAULT_DESIGN_SETTINGS,researchEnabled:true,artworkSize:'selected',image:{...DEFAULT_DESIGN_SETTINGS.image},...overrides});
const body = (overrides={}) => ({approved:true,settings:settings(),title:'Crème brûlée — 家庭!',noText:false,notes:'',references:[],photo:image,...overrides});
const response = (search) => ({status:'completed',usage:{input_tokens:100,output_tokens:30,input_tokens_details:{cached_tokens:0}},output:[...(search?[{type:'web_search_call',action:{type:'search',sources:[{url:'https://example.com/recipe-design',title:'Example design source'}]}}]:[]),{type:'message',content:[{type:'output_text',text:JSON.stringify(plan),annotations:[]}]}]});
const previousKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY='unit-test-placeholder';
test.after(()=>{if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;});

test('all eight complete prompts match their skills and substitute the exact title',()=>{
  assert.equal(RECIPE_STYLE_PRESETS.length,8);
  assert.equal(new Set(RECIPE_STYLE_PRESETS.map(p=>p.id)).size,8);
  assert.equal(new Set(RECIPE_STYLE_PRESETS.map(p=>p.family)).size,7);
  assert.equal(DEFAULT_DESIGN_SETTINGS.researchEnabled,false);
  assert.equal(DEFAULT_DESIGN_SETTINGS.artworkSize,'1280x1600');
  for(const preset of RECIPE_STYLE_PRESETS){
    const skill=fs.readFileSync(path.resolve(__dirname,'..','.agents','skills',preset.id.replaceAll('_','-'),'references','full-prompt.md'),'utf8').replace(/\r\n/g,'\n');
    const section=skill.match(/```text\n([\s\S]*?)\n```/);
    assert.ok(section,preset.id);assert.equal(preset.template,section[1]);
    assert.equal(preset.version,1);assert.equal(preset.photoPolicy,'strict_protected_composite');
    assert.deepEqual(preset.output,{width:1200,height:1500,format:'png'});
    const title='Loaded Baked Potato Soup — 家庭';const rendered=renderRecipeStylePrompt(preset.id,title);
    assert.ok(rendered.includes(title));assert.ok(!rendered.includes('{{TITLE}}'));
    assert.ok(rendered.includes('GLOBAL RECIPE DESIGN RULES'));
    assert.ok(renderRecipeStylePrompt(preset.id,title,true).includes('Render no letters or words'));
  }
});

test('all eight skills describe the direct edit and each new style has a distinct finish check',()=>{
  const markers={
    black_label_vintage:'engraved black recipe sign',
    notebook_comfort_food:'tactile family recipe notebook',
    retro_diner_poster:'energetic mid-century diner poster',
    old_cookbook_panel:'richly printed heirloom cookbook page',
    modern_editorial_food:'contemporary food-editorial cover',
    mediterranean_market_print:'sunlit Mediterranean market print',
    vintage_ingredients_card:'compact vintage cream label',
  };
  for(const preset of RECIPE_STYLE_PRESETS){
    const folder=preset.id.replaceAll('_','-');
    const skill=fs.readFileSync(path.resolve(__dirname,'..','.agents','skills',folder,'SKILL.md'),'utf8');
    const reference=fs.readFileSync(path.resolve(__dirname,'..','.agents','skills',folder,'references','full-prompt.md'),'utf8');
    assert.match(skill,/first image to OpenAI image edits/);
    assert.doesNotMatch(skill,/Never send the original photo to the image generator/);
    assert.match(reference,/DIRECT IMAGE EDIT RULES/);
    assert.doesNotMatch(reference,/AI creates only the decorative stage/);
    const ingredients='Potatoes (2 cups)\nBacon (4 slices)';
    const direct=recipeDirectPrompt(preset.id,'Loaded Baked Potato Soup','Use a slightly darker title.',undefined,ingredients);
    assert.ok(direct.includes(preset.template.replaceAll('{{TITLE}}','Loaded Baked Potato Soup').replaceAll('{{INGREDIENTS}}',ingredients)));
    assert.ok(direct.endsWith('Additional owner instructions: Use a slightly darker title.'));
    if(markers[preset.id])assert.ok(direct.includes(markers[preset.id]));
    else assert.doesNotMatch(direct,/STYLE-SPECIFIC FINAL CHECK/); // preserve the successful Farmhouse prompt
  }
});

test('Recipe Designs sends each full style prompt and original photo to one direct image edit',async()=>{
  const original=global.fetch;const calls=[];
  global.fetch=async(url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/images/edits');
    assert.ok(init.body instanceof FormData);
    const form=init.body;calls.push(form);
    assert.equal(form.get('model'),'gpt-image-2.6-sunburst');
    assert.equal(form.get('size'),'1024x1536');
    assert.equal(form.get('quality'),'medium');
    assert.equal(form.get('output_format'),'png');
    assert.equal(form.getAll('image[]').length,2);
    assert.equal(Buffer.from(await form.getAll('image[]')[0].arrayBuffer()).toString(),'abc');
    return Response.json({data:[{b64_json:generatedPng}],usage:{input_tokens:10,output_tokens:100,input_tokens_details:{text_tokens:5,image_tokens:5}}});
  };
  try{
    for(const preset of RECIPE_STYLE_PRESETS){
      const ingredients='Potatoes (2 cups)\nBacon (4 slices)';
      const res=await directRoute.POST(request({approved:true,settings:settings({styleId:preset.id,model:'gpt-image-2.6-sunburst',artworkSize:'selected',researchEnabled:false}),title:'Loaded Baked Potato Soup',ingredients,notes:'Make the title bold.',photo:image,references:[image]}));
      assert.equal(res.status,200);
      const result=await res.json();assert.equal(result.styleId,preset.id);assert.match(result.image,/^\/api\/image-assets\/[a-f0-9]{64}$/);assert.equal(result.metadata.state,'verified');
      const prompt=calls.at(-1).get('prompt');
      assert.ok(prompt.includes(preset.template.replaceAll('{{TITLE}}','Loaded Baked Potato Soup').replaceAll('{{INGREDIENTS}}',ingredients)));
      assert.match(prompt,/COMPLETE finished recipe graphic/);
      assert.match(prompt,/Additional owner instructions: Make the title bold/);
      assert.doesNotMatch(prompt,/DECORATIVE ARTWORK ADAPTATION/);
    }
    assert.equal(calls.length,RECIPE_STYLE_PRESETS.length);
    assert.ok(recipeDirectPrompt(RECIPE_STYLE_PRESETS[0].id,'Loaded Baked Potato Soup','').includes('first attached image'));
  }finally{global.fetch=original;}
});

test('ingredient cards send the original photo and the complete supplied list, rejecting missing or oversized lists before dispatch',async()=>{
  const original=global.fetch;const calls=[];
  global.fetch=async(url,init)=>{calls.push({url,form:init.body});return Response.json({data:[{b64_json:generatedPng}],usage:{input_tokens:10,output_tokens:100,input_tokens_details:{text_tokens:5,image_tokens:5}}});};
  const ingredients='Chicken breast (1 lb)\nBroccoli (2 cups)\nSpinach (1½ cups)\nGarlic (3 cloves)';
  const s=settings({styleId:INGREDIENT_CARD_STYLE_ID,model:'gpt-image-2.6-sunburst',artworkSize:'selected',researchEnabled:false});
  const make=(changes={})=>request({approved:true,settings:s,title:'Garlic Chicken',ingredients,notes:'',photo:image,references:[],...changes});
  try{
    for(const invalid of ['', '   \n ', Array(21).fill('item').join('\n'), 'a'.repeat(2001)]) {
      const res=await directRoute.POST(make({ingredients:invalid}));
      assert.equal(res.status,400);assert.equal((await res.json()).outcome,'not_dispatched');
    }
    assert.equal(calls.length,0);
    const res=await directRoute.POST(make());assert.equal(res.status,200);
    assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/images/edits');
    assert.equal(Buffer.from(await calls[0].form.getAll('image[]')[0].arrayBuffer()).toString(),'abc');
    const prompt=calls[0].form.get('prompt');
    assert.ok(prompt.includes(ingredients));assert.ok(!prompt.includes('{{INGREDIENTS}}'));
    assert.match(prompt,/Do not abbreviate, rewrite, guess, omit, duplicate or add ingredients or measurements/);
    assert.equal(validateRecipeIngredients('  Apples (2)  \r\n\r\n Sugar (1 cup) '),'Apples (2)\nSugar (1 cup)');
    const literal=recipeDirectPrompt(INGREDIENT_CARD_STYLE_ID,'Recipe {{INGREDIENTS}}','',undefined,'Item {{TITLE}} (1 cup)');
    assert.ok(literal.includes('Recipe {{INGREDIENTS}}'));assert.ok(literal.includes('Item {{TITLE}} (1 cup)'));
    const base=RECIPE_STYLE_PRESETS.find(p=>p.id===INGREDIENT_CARD_STYLE_ID);
    assert.throws(()=>validateRecipePromptCopy({baseStyleId:base.id,version:2,template:base.template.replace('{{INGREDIENTS}}','')},base.id),/ingredients placeholders/);
  }finally{global.fetch=original;}
});

test('direct image edit rejects missing approval or photo before provider dispatch',async()=>{
  const original=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;throw Error('unexpected paid call');};
  try{
    const s=settings({styleId:'vintage_farmhouse_recipe',researchEnabled:false});
    for(const data of [
      {approved:false,settings:s,title:'Potato Soup',photo:image,references:[]},
      {approved:true,settings:s,title:'Potato Soup',photo:'',references:[]},
      {approved:true,settings:s,title:'',photo:image,references:[]},
    ])assert.equal((await directRoute.POST(request(data))).status,400);
    assert.equal(calls,0);
  }finally{global.fetch=original;}
});

test('saved 4:5 Sunburst setting uses image edits and a versioned prompt copy',async()=>{
  const preset=RECIPE_STYLE_PRESETS[0];
  const copy={baseStyleId:preset.id,version:2,template:preset.template+'\nUse a restrained olive accent.'};
  const original=global.fetch;let seen;
  global.fetch=async(url,init)=>{seen={url,form:init.body};return Response.json({data:[{b64_json:generatedPng}],usage:{input_tokens:10,output_tokens:100,input_tokens_details:{text_tokens:5,image_tokens:5}}});};
  try{
    const res=await directRoute.POST(request({approved:true,settings:settings({styleId:preset.id,artworkSize:'1280x1600',researchEnabled:false}),title:'Loaded Baked Potato Soup',notes:'',promptCopy:copy,photo:image,references:[]}));
    assert.equal(res.status,200);
    assert.equal(seen.url,'https://api.openai.com/v1/images/edits');
    assert.equal(seen.form.get('size'),'1280x1600');
    assert.equal(seen.form.getAll('image[]').length,1);
    assert.match(seen.form.get('prompt'),/Use a restrained olive accent/);
  }finally{global.fetch=original;}
});

test('each selected full prompt and text model reach planning without a real provider call',async()=>{
  const original=global.fetch;const seen=[];
  global.fetch=async(_url,init)=>{const sent=JSON.parse(init.body);seen.push(sent);return Response.json(response(false));};
  try {
    for(const preset of RECIPE_STYLE_PRESETS){
      const res=await planRoute.POST(request(body({settings:settings({styleId:preset.id,textModel:'gpt-5.4',researchEnabled:false})})));
      assert.equal(res.status,200);const data=await res.json();
      assert.equal(data.plan.styleId,preset.id);assert.equal(data.plan.stylePromptVersion,1);assert.equal(data.plan.family,preset.family);
      const sent=seen.at(-1);assert.equal(sent.model,'gpt-5.4');
      assert.ok(sent.instructions.includes(preset.template.replaceAll('{{TITLE}}','Crème brûlée — 家庭!')));
      assert.equal(sent.tools,undefined);
    }
    assert.equal(seen.length,RECIPE_STYLE_PRESETS.length);
  }finally{global.fetch=original;}
});

test('each full preset reaches decorative artwork with selected model, size and photo exclusion',async()=>{
  const original=global.fetch;const seen=[];
  global.fetch=async(_url,init)=>{seen.push(JSON.parse(init.body));return Response.json({data:[{b64_json:generatedPng}],usage:{input_tokens:10,output_tokens:100,input_tokens_details:{text_tokens:10,image_tokens:0}}});};
  try {
    for(const preset of RECIPE_STYLE_PRESETS){
      const styledPlan={...plan,family:preset.family,styleId:preset.id,stylePromptVersion:1};
      const res=await artRoute.POST(request({approved:true,settings:settings({styleId:preset.id,artworkSize:'1280x1600'}),plan:styledPlan,title:'Loaded Baked Potato Soup',noText:false,notes:'warm ink',photo:image}));
      assert.equal(res.status,200);const sent=seen.at(-1);
      assert.equal(sent.model,'gpt-image-2.5-sunburst');assert.equal(sent.size,'1280x1600');assert.equal(sent.quality,'medium');
      assert.ok(sent.prompt.includes(preset.template.replaceAll('{{TITLE}}','Loaded Baked Potato Soup')));
      assert.match(sent.prompt,/DECORATIVE ARTWORK ADAPTATION/);assert.match(sent.prompt,/Do not render any food/);
      assert.ok(!JSON.stringify(sent).includes(image));
    }
    assert.equal(seen.length,RECIPE_STYLE_PRESETS.length);
  }finally{global.fetch=original;}
});
test('a local prompt copy is versioned, used by both stages, and cannot bypass immutable rules',async()=>{
  const base=RECIPE_STYLE_PRESETS[0];
  const copy=validateRecipePromptCopy({baseStyleId:base.id,version:2,template:base.template+'\nA locally added paper-and-floral instruction.'},base.id);
  assert.throws(()=>validateRecipePromptCopy({...copy,template:'short'},base.id));
  assert.throws(()=>validateRecipePromptCopy({...copy,baseStyleId:'black_label_vintage'},base.id));
  const original=global.fetch;const seen=[];
  global.fetch=async(url,init)=>{const sent=JSON.parse(init.body);seen.push(sent);return Response.json(url.includes('/responses')?response(false):{data:[{b64_json:generatedPng}],usage:{input_tokens:10,output_tokens:100,input_tokens_details:{text_tokens:10,image_tokens:0}}});};
  try{
    const s=settings({styleId:base.id,researchEnabled:false,artworkSize:'selected'});
    const planning=await planRoute.POST(request(body({settings:s,promptCopy:copy})));
    assert.equal(planning.status,200);const planned=(await planning.json()).plan;
    assert.equal(planned.stylePromptVersion,2);
    const artwork=await artRoute.POST(request({approved:true,settings:s,plan:planned,title:'Crème brûlée — 家庭!',noText:false,notes:'',promptCopy:copy}));
    assert.equal(artwork.status,200);
    assert.ok(seen[0].instructions.includes('A locally added paper-and-floral instruction.'));
    assert.ok(seen[1].prompt.includes('A locally added paper-and-floral instruction.'));
    assert.ok(seen[1].prompt.includes('GLOBAL RECIPE DESIGN RULES'));
    assert.match(seen[1].prompt,/Do not render any food/);
    const missing=await artRoute.POST(request({approved:true,settings:s,plan:planned,title:'Crème brûlée — 家庭!',noText:false,notes:''}));
    assert.equal(missing.status,400);assert.equal(seen.length,2);
  }finally{global.fetch=original;}
});
test('Recipe Designs honors a manually selected alternate OpenAI image model and settings',async()=>{
  const preset=RECIPE_STYLE_PRESETS[1];const original=global.fetch;let sent;
  global.fetch=async(_url,init)=>{sent=JSON.parse(init.body);return Response.json({data:[{b64_json:generatedPng}],usage:{input_tokens:10,output_tokens:100,input_tokens_details:{text_tokens:10,image_tokens:0}}});};
  try{
    const s=settings({styleId:preset.id,model:'gpt-image-2.6-sunburst',artworkSize:'selected',image:{...DEFAULT_DESIGN_SETTINGS.image,size:'1024x1536',quality:'high',complexity:'default'}});
    const res=await artRoute.POST(request({approved:true,settings:s,plan:{...plan,family:preset.family,styleId:preset.id,stylePromptVersion:1},title:'Loaded Baked Potato Soup',noText:false,notes:''}));
    assert.equal(res.status,200);assert.equal(sent.model,'gpt-image-2.6-sunburst');assert.equal(sent.size,'1024x1536');assert.equal(sent.quality,'high');assert.equal(sent.complexity,undefined);
  }finally{global.fetch=original;}
});

test('protected pixel quality gate rejects a single changed channel',()=>{
  const expected=new Uint8ClampedArray([1,2,3,255,4,5,6,255]);
  assert.doesNotThrow(()=>assertProtectedPixels(expected,new Uint8ClampedArray(expected)));
  const changed=new Uint8ClampedArray(expected);changed[4]++;
  assert.throws(()=>assertProtectedPixels(expected,changed),/Export blocked/);
  assert.throws(()=>assertProtectedPixels(expected,new Uint8ClampedArray(4)),/dimensions/);
});
test('exact title accepts Unicode and NO TEXT, but rejects absent titles',()=>{
  const exact='  Crème brûlée — 家庭!  ';
  assert.equal(validateTitle(exact,false).title,exact);
  assert.deepEqual(validateTitle('',true),{title:'',noText:true});
  assert.throws(()=>validateTitle(' ',false),/title/);
});
test('automatic direction avoids the recent five families when possible',()=>{
  assert.equal(chooseDistinctFamily('notebook',['notebook','black_label']),'farmhouse');
  assert.equal(chooseDistinctFamily('minimal',['notebook','black_label']),'minimal');
  assert.equal(chooseDistinctFamily('notebook',['notebook','black_label','farmhouse','retro_diner','minimal']),'heritage');
  assert.equal(chooseRecipeFamily('notebook',['notebook','black_label'],true),'notebook');
});
test('curated local layouts rotate, honor recipe context, and reserve a separate title area',()=>{
  assert.equal(chooseLocalRecipeFamily('pork soup',639,639,[]),'notebook');
  assert.equal(chooseLocalRecipeFamily('pork soup',639,639,['notebook']),'black_label');
  assert.equal(chooseLocalRecipeFamily('portrait dish',500,1000,[]),'heritage');
  for(const family of ['black_label','notebook','retro_diner','heritage']) for(const placement of ['top','bottom']) {
    const {area,title}=recipeDesignLayout(family,placement);
    assert.ok(area.x>=0 && area.y>=0 && area.x+area.width<=1200 && area.y+area.height<=1500);
    assert.ok(title.x>=0 && title.y>=0 && title.x+title.width<=1200 && title.y+title.height<=1500);
    assert.ok(area.y+area.height<=title.y || title.y+title.height<=area.y,`${family} ${placement} overlaps`);
    assert.ok(area.width*area.height/(1200*1500)>.65,`${family} ${placement} does not give the photo enough space`);
    assert.ok(title.height>=250,`${family} ${placement} headline is too shallow`);
  }
  assert.deepEqual(Object.keys(RECIPE_STYLE_SPECS).sort(),['black_label','heritage','notebook','retro_diner']);
});
test('automatic reference layouts avoid exact recent signatures while retaining the family if possible',()=>{
  const aspect=recipeDesignAspect(639,639);
  const top=recipeDesignSignature('black_label','top',aspect);
  const bottom=recipeDesignSignature('black_label','bottom',aspect);
  assert.deepEqual(avoidRecentRecipeLayout('black_label','top',aspect,[]),{family:'black_label',placement:'top'});
  assert.deepEqual(avoidRecentRecipeLayout('black_label','top',aspect,[top]),{family:'black_label',placement:'bottom'});
  const alternate=avoidRecentRecipeLayout('black_label','top',aspect,[top,bottom]);
  assert.notEqual(alternate.family,'black_label');
  assert.ok(![top,bottom].includes(recipeDesignSignature(alternate.family,alternate.placement,aspect)));
  assert.equal(recipeDesignAspect(500,1000),'portrait');assert.equal(recipeDesignAspect(1000,500),'landscape');
});
test('editable template and reference style data are bounded and preserve priority',()=>{
  const edits={font:'diner_slab',alignment:'left',titleScale:1.2,accent:'#aabbcc',background:'#123456',panel:'#f5e8cd',ink:'#ffffff'};
  assert.deepEqual(validateTemplateEdits(edits),edits);
  for(const bad of [{accent:'red'},{panel:'cream'},{font:'unknown'},{titleScale:1.31},{titleScale:NaN},{alignment:'justify'}])assert.throws(()=>validateTemplateEdits(bad));
  const dna={photoLayout:'Top photo',titleHierarchy:'Large headline',palette:'Cream and dark red',labelAndFrame:'Ticket',ornaments:'Fine lines',mood:'Warm'};
  const validated=validateDesignPlan({...plan,template:edits,styleDNA:dna});assert.deepEqual(validated.template,edits);assert.deepEqual(validated.styleDNA,dna);
  const reference={...plan,family:'notebook',evidenceMode:'uploaded_reference',palette:['#ffffff','#001122']};
  assert.equal(referenceTemplate(reference,'low'),undefined);
  assert.equal(referenceTemplate({...reference,evidenceMode:'inference'},'high'),undefined);
  assert.deepEqual(referenceTemplate(reference,'high'),{panel:'#ffffff',ink:'#001122',accent:undefined,font:undefined});
  assert.deepEqual(resolveTemplateColors('black_label',validateTemplateEdits({font:'diner_slab'})),TEMPLATE_COLORS.black_label);
  assert.deepEqual(resolveTemplateColors('black_label',{accent:'#abcdef'}),{...TEMPLATE_COLORS.black_label,accent:'#abcdef'});
  assert.ok(DESIGN_SCHEMA.required.includes('styleDNA'));
});
test('long model descriptions are bounded safely and optional reference-only research is ignored',()=>{
  const long='x'.repeat(498)+'😀'+' more words'.repeat(80);
  const normalized=normalizeModelDesignPlan({...plan,layout:long,researchSummary:null},false);
  assert.equal(normalized.researchSummary,'');
  assert.ok(normalized.layout.length<=500);
  assert.ok(!/[\uD800-\uDBFF]$/.test(normalized.layout));
  assert.match(normalized.layout,/…$/);
});
test('model palettes are normalized or completed without weakening input validation',()=>{
  assert.deepEqual(normalizeModelPalette(['#123456','#ABCDEF'],'notebook'),{palette:['#123456','#ABCDEF'],paletteSource:'model'});
  assert.deepEqual(normalizeModelPalette([' cream ','#abc','ink (#112233)'],'notebook'),{palette:['#FFFDD0','#aabbcc','#112233'],paletteSource:'normalized'});
  assert.deepEqual(normalizeModelPalette(['#abcdef','unknown color'],'black_label'),{palette:['#abcdef','#1C1917'],paletteSource:'fallback'});
  assert.deepEqual(normalizeModelPalette(['constructor','__proto__'],'black_label'),{palette:['#1C1917','#F5E8CD'],paletteSource:'fallback'});
  assert.deepEqual(normalizeModelPalette(null,'notebook'),{palette:['#F5EAD6','#702C31'],paletteSource:'fallback'});
  assert.throws(()=>validateDesignPlan({...plan,palette:['cream','black']}),/palette was invalid/);
  assert.equal(DESIGN_SCHEMA.properties.palette.minItems,2);
  assert.equal(DESIGN_SCHEMA.properties.palette.maxItems,5);
  assert.equal(DESIGN_SCHEMA.properties.palette.items.pattern,'^#[0-9a-fA-F]{6}$');
});
test('malformed model colors do not discard the paid analysis or trigger a retry',async()=>{
  const original=global.fetch;const seen=[];
  global.fetch=async(url,init)=>{const sent=JSON.parse(init.body);seen.push(sent);const raw=response(!!sent.tools);raw.output.at(-1).content[0].text=JSON.stringify({...plan,palette:['#fff','cream','deep timber'],researchSummary:'Research notes.'});return Response.json(raw);};
  try {
    for(const [mode,researchEnabled,refs] of [['auto',true,[]],['reference',false,[image]],['hybrid',true,[image]]]) {
      const res=await planRoute.POST(request(body({settings:settings({mode,researchEnabled}),references:refs})));
      const data=await res.json();assert.equal(res.status,200);assert.deepEqual(data.plan.palette,['#ffffff','#FFFDD0']);assert.equal(data.plan.paletteSource,'normalized');assert.ok(data.cost>0);
      assert.match(seen.at(-1).instructions,/six-digit hex colors/);assert.equal(seen.at(-1).text.format.schema.properties.palette.minItems,2);
    }
    assert.equal(seen.length,3);
  } finally {global.fetch=original;}
});
test('missing model colors use the selected family palette and preserve its provenance',async()=>{
  const original=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;const raw=response(false);raw.output.at(-1).content[0].text=JSON.stringify({...plan,palette:['not-a-color']});return Response.json(raw);};
  try {const res=await planRoute.POST(request(body({settings:settings({mode:'reference',researchEnabled:false,styleId:'black_label_vintage'}),references:[image]})));const data=await res.json();assert.equal(res.status,200);assert.equal(data.plan.family,'black_label');assert.equal(data.plan.paletteSource,'fallback');assert.deepEqual(data.plan.palette,['#1C1917','#F5E8CD']);assert.equal(calls,1);}
  finally {global.fetch=original;}
});
test('image results retain real URLs, exclude Pinterest guidance and never infer performance',()=>{
  const output=[{type:'web_search_call',results:[
    {type:'image_result',image_url:'https://cdn.example/soup.jpg',thumbnail_url:'https://cdn.example/soup-small.jpg',source_website_url:'https://www.pinterest.com/pin/123/',caption:'Soup card'},
    {type:'image_result',image_url:'https://cdn.example/guide.jpg',source_website_url:'https://help.pinterest.com/article/tips'},
    {type:'image_result',image_url:'https://cdn.example/guide.jpg',source_website_url:'https://example.com/how-to/recipe-pins'},
    {type:'image_result',image_url:'https://cdn.example/soup.jpg',source_website_url:'https://www.pinterest.com/pin/123/'},
    {type:'image_result',image_url:'http://cdn.example/unsafe.jpg',source_website_url:'https://example.com/post'},
    {type:'text_result',url:'https://example.com/other'}
  ]}];
  const found=parseVisualResults(output,'2026-11-05T10:00:00.000Z');
  assert.equal(found.length,1);assert.equal(found[0].thumbnailUrl,'https://cdn.example/soup-small.jpg');assert.equal(found[0].sourceUrl,'https://www.pinterest.com/pin/123/');assert.equal(found[0].publishedAt,null);assert.equal(found[0].evidence,undefined);
  const separated=separatePlatformGuidance([{url:'https://guide.pinterest.com/tips',title:'Guide'},{url:'https://example.com/post',title:'Post'}]);
  assert.equal(separated.platformSources.length,1);assert.equal(separated.sources.length,1);
});
test('thumbnail fetch rejects loopback and private-network addresses without connecting',async()=>{
  const base={id:'a',caption:'',observedAt:new Date().toISOString(),publishedAt:null};
  const result=await fetchVisualCandidates([{...base,sourceUrl:'https://127.0.0.1/post',imageUrl:'https://127.0.0.1/image.jpg',thumbnailUrl:'https://127.0.0.1/image.jpg'},{...base,id:'b',sourceUrl:'https://10.0.0.1/post',imageUrl:'https://10.0.0.1/image.jpg',thumbnailUrl:'https://10.0.0.1/image.jpg'}]);
  assert.deepEqual(result,[]);
});
test('mocked visually inspected, accessible examples drive the brief and keep evidence limited',async()=>{
  const original=global.fetch;let calls=0;
  visualFetchMock=async candidates=>candidates.map(v=>({...v,thumbnail:image,sourceStatus:'accessible'}));
  global.fetch=async(url,init)=>{
    calls++;const sent=JSON.parse(init.body);
    if(calls===1){const raw=response(true);raw.output[0].results=[{type:'image_result',image_url:'https://cdn.example/soup.jpg',thumbnail_url:'https://cdn.example/soup-small.jpg',source_website_url:'https://www.pinterest.com/pin/123/',caption:'Soup card'}];return Response.json(raw);}
    const id=JSON.parse(sent.input[0].content[0].text).images[0].id;
    assert.equal(sent.input[0].content.filter(x=>x.type==='input_image').length,1);
    return Response.json({status:'completed',usage:{input_tokens:50,output_tokens:25},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({examples:[{id,relevant:true,observation:'Soup photo above a compact black sign',photoPlacement:'Upper photo',typography:'Bold serif',palette:'Cream and black',label:'Framed bottom label'}],family:'black_label',layout:'Photo above a compact framed sign',typography:'Bold serif hierarchy',decoration:'Thin antique border',whyFits:'The square soup photo can sit above the sign.',palette:['#1b1917','#f5e6c9'],inspirationIds:[id]})}]}]});
  };
  try {const res=await planRoute.POST(request(body({settings:settings({styleId:'black_label_vintage'})})));const data=await res.json();assert.equal(res.status,200);assert.equal(calls,2);assert.equal(data.plan.family,'black_label');assert.equal(data.plan.evidenceMode,'visual_research');assert.equal(data.plan.inspirationIds.length,1);assert.deepEqual(data.plan.palette,['#1b1917','#f5e6c9']);assert.match(data.plan.layout,/framed sign/);assert.equal(data.research.examples[0].evidence,'visual_inspiration_only');assert.equal(data.research.examples[0].inspection,'vision');assert.match(data.researchStatus,/visual examples/);}
  finally {global.fetch=original;visualFetchMock=async()=>[];}
});
test('hybrid prioritizes the supplied reference over a competing web-image family',async()=>{
  const original=global.fetch;let calls=0;
  visualFetchMock=async candidates=>candidates.map(v=>({...v,thumbnail:image,sourceStatus:'accessible'}));
  global.fetch=async(url,init)=>{calls++;const sent=JSON.parse(init.body);if(calls===1){assert.equal(sent.input[0].content.filter(x=>x.type==='input_image').length,2);const raw=response(true);raw.output[0].results=[{type:'image_result',image_url:'https://cdn.example/a.jpg',source_website_url:'https://example.com/post'}];return Response.json(raw);}const id=JSON.parse(sent.input[0].content[0].text).images[0].id;return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:10},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({examples:[{id,relevant:true,observation:'A black label',photoPlacement:'Top',typography:'Serif',palette:'Black',label:'Border'}],family:'black_label',layout:'black label',typography:'serif',decoration:'border',whyFits:'fit',palette:['#111111','#eeeeee'],inspirationIds:[id]})}]}]});};
  try {const data=await (await planRoute.POST(request(body({settings:settings({mode:'hybrid',researchEnabled:true,styleId:'notebook_comfort_food'}),references:[image],lastFamilies:['notebook']})))).json();assert.equal(data.plan.family,'notebook');assert.equal(data.plan.evidenceMode,'uploaded_reference');assert.equal(calls,2);}
  finally {global.fetch=original;visualFetchMock=async()=>[];}
});
test('an interrupted second analysis retains known usage and never retries',async()=>{
  const original=global.fetch;let calls=0;
  visualFetchMock=async candidates=>candidates.map(v=>({...v,thumbnail:image,sourceStatus:'accessible'}));
  global.fetch=async()=>{calls++;if(calls===2)throw Error('network interrupted');const raw=response(true);raw.output[0].results=[{type:'image_result',image_url:'https://cdn.example/a.jpg',source_website_url:'https://example.com/post'}];return Response.json(raw);};
  try {const res=await planRoute.POST(request(body()));const data=await res.json();assert.equal(res.status,502);assert.equal(calls,2);assert.equal(data.outcome,'unknown');assert.ok(data.usage.cost>0);assert.match(data.costStatus,/unknown/);}
  finally {global.fetch=original;visualFetchMock=async()=>[];}
});
test('an inaccessible source cannot support a verified visual brief',async()=>{
  const original=global.fetch;let calls=0;
  visualFetchMock=async candidates=>candidates.map(v=>({...v,thumbnail:image,sourceStatus:'unverified'}));
  global.fetch=async(url,init)=>{calls++;const sent=JSON.parse(init.body);if(calls===1){const raw=response(true);raw.output[0].results=[{type:'image_result',image_url:'https://cdn.example/a.jpg',source_website_url:'https://example.com/post'}];return Response.json(raw);}const id=JSON.parse(sent.input[0].content[0].text).images[0].id;return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:10},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({examples:[{id,relevant:true,observation:'A card',photoPlacement:'Top',typography:'Serif',palette:'Cream',label:'Border'}],family:'black_label',layout:'layout',typography:'serif',decoration:'border',whyFits:'fit',inspirationIds:[id]})}]}]});};
  try {const data=await (await planRoute.POST(request(body()))).json();assert.equal(data.plan.evidenceMode,'inference');assert.equal(data.research.examples[0].sourceStatus,'unverified');assert.match(data.research.summary,/No public visual examples could be verified/);}
  finally {global.fetch=original;visualFetchMock=async()=>[];}
});
test('approval and input validation reject requests before any provider call',async()=>{
  let count=0; const original=global.fetch;global.fetch=async()=>{count++;throw Error('unexpected network');};
  try {
    for(const bad of [body({approved:false}),body({settings:settings({mode:'reference',researchEnabled:false})}),body({settings:settings({mode:'hybrid',researchEnabled:false}),references:[image]}),body({title:'',noText:false}),body({settings:settings({image:{...DEFAULT_DESIGN_SETTINGS.image,quality:'bogus'}})})]) {
      assert.equal((await planRoute.POST(request(bad))).status,400);
    }
    assert.equal((await artRoute.POST(request({approved:false,settings:settings(),plan}))).status,400);
    assert.equal((await artRoute.POST(request({approved:true,settings:settings(),plan,title:'Loaded Baked Potato Soup',noText:false}))).status,400);
    assert.equal(count,0);
  } finally {global.fetch=original;}
});
test('auto and hybrid issue bounded real-search requests, reference mode skips search',async()=>{
  const original=global.fetch;const seen=[];
  global.fetch=async(url,init)=>{const sent=JSON.parse(init.body);seen.push({url,sent});return Response.json(response(!!sent.tools));};
  try {
    for(const [mode,researchEnabled,refs] of [['auto',true,[]],['reference',false,[image]],['hybrid',true,[image,image]]]) {
      const res=await planRoute.POST(request(body({settings:settings({mode,researchEnabled}),references:refs})));
      assert.equal(res.status,200);const result=await res.json();
      assert.equal(result.researchStatus,researchEnabled?'Research · no verified visuals':'Research Off');
      if(researchEnabled) assert.deepEqual(result.research.sources,[{url:'https://example.com/recipe-design',title:'Example design source'}]);
      const call=seen.at(-1).sent;assert.equal(call.model,'gpt-5.4-mini');assert.equal(!!call.tools,researchEnabled);
      if(researchEnabled){assert.equal(call.tools[0].type,'web_search');assert.deepEqual(call.tools[0].search_content_types,['image','text']);assert.deepEqual(call.tools[0].image_settings,{max_results:8,caption:true});assert.ok(call.include.includes('web_search_call.results'));assert.equal(call.tool_choice,'required');assert.equal(call.max_tool_calls,3);}
      assert.equal(call.input[0].content.filter(x=>x.type==='input_image').length,refs.length+1);
    }
  }finally{global.fetch=original;}
});
test('valid cached research skips live web, privacy opt-out omits food thumbnail',async()=>{
  const original=global.fetch;let sent;global.fetch=async(url,init)=>{sent=JSON.parse(init.body);return Response.json(response(false));};
  try {
    const cached={version:2,date:new Date().toISOString(),summary:'Observed restrained borders.',sources:[{url:'https://example.com/design',title:'Design'}],examples:[]};
    const res=await planRoute.POST(request(body({settings:settings({photoAnalysis:false}),photo:undefined,cachedResearch:cached})));
    const result=await res.json();assert.equal(res.status,200);assert.equal(result.researchStatus,'Research Cached · no verified visuals');
    assert.equal(sent.tools,undefined);assert.equal(sent.input[0].content.filter(x=>x.type==='input_image').length,0);
  }finally{global.fetch=original;}
});
test('Auto may reuse dated visual research without enabling a new paid web search',async()=>{
  const original=global.fetch;const seen=[];
  global.fetch=async(_url,init)=>{seen.push(JSON.parse(init.body));return Response.json(response(false));};
  try{
    const cached={version:2,date:new Date().toISOString(),summary:'Observed printed recipe labels.',sources:[{url:'https://example.com/post',title:'Recipe post'}],examples:[]};
    const auto=await planRoute.POST(request(body({settings:settings({styleId:'auto',researchEnabled:false}),cachedResearch:cached})));
    assert.equal(auto.status,200);assert.match((await auto.json()).researchStatus,/Research Cached/);assert.equal(seen.at(-1).tools,undefined);
    const manual=await planRoute.POST(request(body({settings:settings({styleId:'black_label_vintage',researchEnabled:false}),cachedResearch:cached})));
    assert.equal(manual.status,200);assert.equal((await manual.json()).researchStatus,'Research Off');assert.equal(seen.at(-1).tools,undefined);
  }finally{global.fetch=original;}
});
test('reference-only mode accepts a long or missing research summary without calling web search',async()=>{
  const original=global.fetch;const seen=[];
  try {
    for(const researchSummary of ['Detailed context. '.repeat(100),null]) {
      global.fetch=async(url,init)=>{const sent=JSON.parse(init.body);seen.push(sent);const raw=response(false);raw.output.at(-1).content[0].text=JSON.stringify({...plan,researchSummary,referenceSummary:'Style direction. '.repeat(60)});return Response.json(raw);};
      const res=await planRoute.POST(request(body({settings:settings({mode:'reference',researchEnabled:false}),references:[image]})));
      const result=await res.json();assert.equal(res.status,200);assert.equal(result.researchStatus,'Research Off');assert.equal(result.plan.researchSummary,'');assert.ok(result.plan.referenceSummary.length<=500);
    }
    assert.ok(seen.every(sent=>!sent.tools));
  }finally{global.fetch=original;}
});
test('reference-only analysis retains style DNA without sending a search request',async()=>{
  const original=global.fetch;let calls=0;
  const dna={photoLayout:'Photo dominates the center',titleHierarchy:'Large condensed title',palette:'Warm ivory and dark red',labelAndFrame:'Vintage ticket',ornaments:'Fine rules',mood:'Home cooking'};
  global.fetch=async(url,init)=>{calls++;const sent=JSON.parse(init.body);assert.equal(sent.tools,undefined);assert.equal(sent.input[0].content.filter(x=>x.type==='input_image').length,2);const raw=response(false);raw.output.at(-1).content[0].text=JSON.stringify({...plan,styleDNA:dna});return Response.json(raw);};
  try {const res=await planRoute.POST(request(body({settings:settings({mode:'reference',researchEnabled:false}),references:[image]})));const result=await res.json();assert.equal(res.status,200);assert.equal(result.plan.evidenceMode,'uploaded_reference');assert.deepEqual(result.plan.styleDNA,dna);assert.equal(calls,1);}
  finally {global.fetch=original;}
});
test('fresh research keeps sources when its summary exceeds the display bound',async()=>{
  const original=global.fetch;global.fetch=async()=>{const raw=response(true);raw.output.at(-1).content[0].text=JSON.stringify({...plan,researchSummary:'Observed layout. '.repeat(100)});return Response.json(raw);};
  try {const res=await planRoute.POST(request(body()));const data=await res.json();assert.equal(res.status,200);assert.equal(data.research.sources.length,1);assert.ok(data.research.summary.length<=500);}finally{global.fetch=original;}
});
test('a completed provider response that fails local validation retains reported analysis usage',async()=>{
  const original=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;const raw=response(false);raw.output.at(-1).content[0].text=JSON.stringify({...plan,family:'invalid'});return Response.json(raw);};
  try {const res=await planRoute.POST(request(body({settings:settings({mode:'reference',researchEnabled:false}),references:[image]})));const data=await res.json();assert.equal(res.status,502);assert.equal(data.outcome,'reported');assert.equal(data.usage.costIncomplete,false);assert.ok(data.usage.cost>0);assert.match(data.costStatus,/No artwork request was sent/);assert.equal(calls,1);}finally{global.fetch=original;}
});
test('missing analysis usage stays unknown after validation failure',async()=>{
  const original=global.fetch;global.fetch=async()=>{const raw=response(false);delete raw.usage;raw.output.at(-1).content[0].text=JSON.stringify({...plan,family:'invalid'});return Response.json(raw);};
  try {const res=await planRoute.POST(request(body({settings:settings({mode:'reference',researchEnabled:false}),references:[image]})));const data=await res.json();assert.equal(data.outcome,'unknown');assert.equal(data.usage.costIncomplete,true);assert.match(data.costStatus,/unknown/);}finally{global.fetch=original;}
});
test('fresh research without real images reports a knowledge-based fallback',async()=>{
  const original=global.fetch;global.fetch=async()=>Response.json(response(false));
  try {const res=await planRoute.POST(request(body()));const data=await res.json();assert.equal(res.status,200);assert.match(data.research.summary,/No public visual examples could be verified/);assert.equal(data.plan.evidenceMode,'inference');assert.deepEqual(data.research.examples,[]);}finally{global.fetch=original;}
});
test('artwork uses text-to-image only, honors settings, and never receives food or reference pixels',async()=>{
  const original=global.fetch;let calls=0;
  global.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/images/generations');const sent=JSON.parse(init.body);assert.equal(sent.model,'gpt-image-2.5-sunburst');assert.equal(sent.quality,'medium');assert.equal(sent.size,'1024x1536');assert.equal(sent.image,undefined);assert.ok(!JSON.stringify(sent).includes(image));assert.match(sent.prompt,/Do not render any food/);return Response.json({data:[{b64_json:generatedPng}],usage:{input_tokens:10,output_tokens:100,input_tokens_details:{text_tokens:10,image_tokens:0}}});};
  try {const res=await artRoute.POST(request({approved:true,settings:settings(),plan:{...plan,styleId:'notebook_comfort_food',stylePromptVersion:1},title:'Loaded Baked Potato Soup',noText:false,photo:image,references:[image]}));assert.equal(res.status,200);const data=await res.json();assert.match(data.artwork,/^\/api\/image-assets\/[a-f0-9]{64}$/);assert.equal(data.metadata.state,'verified');assert.equal(calls,1);}finally{global.fetch=original;}
});
test('provider failure is surfaced as uncertain and is not retried',async()=>{
  const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('network lost');};
  try {const res=await artRoute.POST(request({approved:true,settings:settings(),plan:{...plan,styleId:'notebook_comfort_food',stylePromptVersion:1},title:'Loaded Baked Potato Soup',noText:false}));const data=await res.json();assert.equal(res.status,502);assert.equal(data.dispatched,true);assert.match(data.costStatus,/unknown/);assert.equal(calls,1);}finally{global.fetch=original;}
});

test('photo presets preserve all style specifications and stay scoped to the photo', () => {
  const {quickInstructions,appendQuickInstruction} = load(path.resolve(__dirname,'../lib/photoQuickInstructions.ts'));
  const instructions = quickInstructions.reduce((text,p)=>appendQuickInstruction(text,p.text),'');
  assert.ok(instructions.length <= 4000);
  for (const style of RECIPE_STYLE_PRESETS) {
    const base=recipeDirectPrompt(style.id,'Exact title','Owner style notes',undefined,'Butter (1 cup)','1024x1536');
    const edited=recipeDirectPrompt(style.id,'Exact title','Owner style notes',undefined,'Butter (1 cup)','1024x1536',instructions);
    assert.ok(edited.startsWith(base));
    assert.ok(edited.includes('DESIGN PRESERVATION:'));
    assert.ok(edited.includes('not the design background'));
    assert.ok(edited.includes('Move EVERY ingredient'));
  }
  assert.throws(()=>recipeDirectPrompt(RECIPE_STYLE_PRESETS[0].id,'Title','',undefined,undefined,undefined,{}),/Photo instructions/);
  assert.throws(()=>recipeDirectPrompt(RECIPE_STYLE_PRESETS[0].id,'Title','',undefined,undefined,undefined,'x'.repeat(4001)),/Photo instructions/);
});

test('five active new-photo styles preserve exact ingredients and avoid legacy photo locks',()=>{
 const {ACTIVE_RECIPE_STYLE_PRESETS,validateRecipePromptCopy}=load(path.resolve(__dirname,'../lib/recipeDesignStylePresets.ts'));
 const {requiresRecipeIngredients}=load(path.resolve(__dirname,'../lib/recipeDesignIngredients.ts'));
 assert.equal(ACTIVE_RECIPE_STYLE_PRESETS.length,5);
 for(const style of ACTIVE_RECIPE_STYLE_PRESETS){
  assert.ok(requiresRecipeIngredients(style.id));
  const prompt=recipeDirectPrompt(style.id,'The Best Lasagna Soup','',undefined,'1 onion, diced\n2 cloves garlic, minced','1152x1440','Make the bowl red.');
  assert.ok(prompt.includes('1 onion, diced\n2 cloves garlic, minced'));
  assert.ok(prompt.includes('new photograph'));
  assert.ok(prompt.includes('1152 × 1440'));
  assert.ok(prompt.includes('Make the bowl red.'));
  assert.ok(!prompt.includes("Preserve the food's appearance as faithfully"));
  assert.ok(!prompt.includes('{{INGREDIENTS}}'));
  assert.throws(()=>validateRecipePromptCopy({baseStyleId:style.id,version:2,template:style.template.replace('{{INGREDIENTS}}','')},style.id),/ingredients/);
 }
});
