const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {NextRequest}=require('next/server');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../middleware.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function middleware(env){const module={exports:{}};new Function('module','exports','require','process',source)(module,module.exports,require,{env});return module.exports.middleware;}
test('production Vercel entry point redirects before its old password gate and preserves the requested view',()=>{
 const run=middleware({VERCEL:'1',APP_PASSWORD:'old-entry-password'});
 const response=run(new NextRequest('https://track-compititor.vercel.app/?tab=home-decor'));
 assert.equal(response.status,307);assert.equal(response.headers.get('location'),'https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech/?tab=home-decor');
 const crafted=run(new NextRequest('https://track-compititor.vercel.app//untrusted.example/path'));
 assert.equal(new URL(crafted.headers.get('location')).hostname,'3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech');
});
test('preview deployments and the personal server retain password authentication',()=>{
 const preview=middleware({VERCEL:'1',APP_PASSWORD:'owner'});assert.equal(preview(new NextRequest('https://preview.vercel.app/')).status,401);
 const server=middleware({RECIPE_INTELLIGENCE_MODE:'server',APP_PASSWORD:'owner'});assert.equal(server(new NextRequest('https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech/')).status,401);
 assert.equal(server(new NextRequest('https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech/api/server-health')).status,200);
 assert.equal(server(new NextRequest('https://track-compititor.vercel.app/')).status,401);
});
