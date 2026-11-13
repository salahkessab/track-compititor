const test=require('node:test');
const assert=require('node:assert/strict');
const {recipeDesignPng}=require('./helpers/load-client.cjs')('recipeDesignOutput');

test('design export accepts downloaded workspace image bytes without refetching',async t=>{
 const old={fetch:global.fetch,document:global.document,createImageBitmap:global.createImageBitmap};
 t.after(()=>{for(const [key,value] of Object.entries(old)){if(value===undefined)delete global[key];else global[key]=value;}});
 let closed=0,decoded;const canvas={width:0,height:0,getContext:()=>({save(){},restore(){},drawImage(){}}),toBlob:callback=>callback(new Blob(['export'],{type:'image/png'}))};
 global.document={createElement:()=>canvas};global.fetch=()=>{throw Error('Already downloaded; no second fetch');};
 global.createImageBitmap=async blob=>{decoded=blob;return {width:1152,height:1440,close(){closed++;}};};
 for(const type of ['image/png','image/jpeg','image/webp']){
  const blob=new Blob(['saved output'],{type});const output=await recipeDesignPng(blob);
  assert.equal(decoded,blob);assert.equal(output.type,'image/png');assert.equal(canvas.width,1200);assert.equal(canvas.height,1500);
 }
 assert.equal(closed,3);
 await assert.rejects(recipeDesignPng(new Blob(['error page'],{type:'text/html'})),/Unsupported design image format/);
 await assert.rejects(recipeDesignPng('https://untrusted.example/file'),/Unsupported design image source/);
});
