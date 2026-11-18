const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {runInNewContext}=require('node:vm');

// Exercise the actual route while replacing paid providers and disk image preparation.
function endpoint(){
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
  const copy={headline:'Noodles',title:'Tuna Noodle Casserole',description:'A creamy noodle bake.',hook:'Golden crumbs',alt:'A casserole with a crumb topping.'};
  const ctx={exports:{},require:id=>imports[id],Response,AbortSignal,process:{env:{OPENAI_API_KEY:'fixture'}},fetch:async(url,opt)=>{
    calls.push(JSON.parse(opt.body));return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(copy)}]}]});
  }};
  const code=ts.transpileModule(fs.readFileSync(require.resolve('../app/api/pinterest-design/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,ctx);
  return {calls,submit:data=>ctx.exports.POST(new Request('https://studio.example/api/pinterest-design',{method:'POST',body:JSON.stringify(data)}))};
}
test('Pin copy reviews the saved article and every selected photo',async()=>{
  const {submit,calls}=endpoint();
  const r=await submit({action:'copy',approved:true,articleTitle:'Casserole',article:'Bake until golden.',photos:['hero','step']});
  assert.equal(r.status,200);assert.equal((await r.json()).copy.hook,'Golden crumbs');
  assert.match(calls[0].input[0].content[0].text,/Bake until golden/);
  assert.deepEqual(Array.from(calls[0].input[0].content.slice(1),p=>p.image_url),['hero','step']);
});
test('reference uses article photos first and the style reference last, and returns the verified file',async()=>{
  const {submit,calls}=endpoint();
  const body={action:'reference',approved:true,model:'example',style:'retro',headline:'Casserole',hook:'Golden crumbs',photos:['hero','detail'],reference:'layout'};
  assert.equal((await submit({...body,approved:false})).status,400);assert.equal(calls.length,0);
  const r=await submit(body);assert.equal(r.status,200);
  assert.deepEqual(Array.from(calls[0].references),['hero','detail','layout']);assert.match(calls[0].prompt,/Golden crumbs/);
  assert.equal(calls[1],'verify');assert.equal((await r.json()).imageUrl,'/verified');
});
