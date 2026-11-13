const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {NextRequest}=require('next/server');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../middleware.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function middleware(env){const module={exports:{}};new Function('module','exports','require','process',source)(module,module.exports,require,{env});return module.exports.middleware;}
test('production entry point proxies the requested view without a browser redirect',()=>{
 const run=middleware({VERCEL:'1',APP_PASSWORD:'old-entry-password'});
 const response=run(new NextRequest('https://track-compititor.vercel.app/?tab=home-decor'));
 assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);assert.equal(response.headers.get('x-middleware-rewrite'),'https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech/?tab=home-decor');
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vercel-cdn-cache-control'),'no-store');
 const crafted=run(new NextRequest('https://track-compititor.vercel.app//untrusted.example/path'));
 assert.equal(new URL(crafted.headers.get('x-middleware-rewrite')).hostname,'3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech');
});
test('proxy checks the client origin before translating headers and preserves authentication and body',async()=>{
 const run=middleware({VERCEL:'1',APP_PASSWORD:'unrelated-legacy-password'}),origin='https://track-compititor.vercel.app';
 const request=(headers={})=>new NextRequest(origin+'/api/recipe-intelligence/session',{method:'POST',headers:{origin,authorization:'Basic owner-credential','x-recipe-intelligence':'1','content-type':'application/json',...headers},body:'{"unchanged":true}'});
 const input=request(),response=run(input);
 assert.equal(response.status,200);assert.equal(input.bodyUsed,false);assert.equal(await input.text(),'{"unchanged":true}');
 assert.equal(response.headers.get('x-middleware-request-origin'),'https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech');
 assert.equal(response.headers.get('x-middleware-request-authorization'),'Basic owner-credential');
 assert.equal(response.headers.get('x-middleware-request-x-recipe-intelligence'),'1');
 for(const origin of ['https://untrusted.example','null',''])assert.equal(run(request({origin})).status,403);
 assert.equal(run(new NextRequest(origin+'/api/recipe-intelligence/snapshot',{headers:{origin:'https://untrusted.example'}})).status,403);
});
test('proxy routes static assets and disables middleware body inspection and private caching',()=>{
 const run=middleware({VERCEL:'1'});
 for(const asset of ['/_next/static/chunks/main-app-server-build.js','/_next/static/chunks/app/page-server-build.js','/_next/static/chunks/webpack-server-build.js','/_next/static/css/server.css']) {
   const response=run(new NextRequest('https://track-compititor.vercel.app'+asset));
   assert.equal(response.headers.get('x-middleware-rewrite'),'https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech'+asset);
 }
 const module={exports:{}};new Function('module','exports','require','process',source)(module,module.exports,require,{env:{}});
 assert.deepEqual(module.exports.config.matcher,['/:path*']);
 assert.equal(middleware({APP_PASSWORD:'owner'})(new NextRequest('https://preview.example/_next/static/chunks/app.js')).status,200);
 const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../vercel.json'),'utf8'));
 assert.equal(config.skipMiddlewareRequestBody,true);assert.equal(config.redirects,undefined);
 assert.equal(config.rewrites[0].has[0].value,'track-compititor.vercel.app');
 assert.equal(config.rewrites[0].destination,'https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech/:path*');
 assert.equal(config.headers[0].headers.find(h=>h.key==='x-vercel-enable-rewrite-caching').value,'0');
 const gateway=fs.readFileSync(path.join(__dirname,'../deploy/instabox/Caddyfile'),'utf8');
 assert.match(gateway,/header_down Cache-Control "private, no-store"/);assert.match(gateway,/header_down Vercel-CDN-Cache-Control "no-store"/);
});
test('preview deployments and the personal server retain password authentication',()=>{
 const preview=middleware({VERCEL:'1',APP_PASSWORD:'owner'});assert.equal(preview(new NextRequest('https://preview.vercel.app/')).status,401);
 const server=middleware({RECIPE_INTELLIGENCE_MODE:'server',APP_PASSWORD:'owner'});assert.equal(server(new NextRequest('https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech/')).status,401);
 assert.equal(server(new NextRequest('https://3000-agq44rg6nmhmxmq3i7xitgmpza.instabox.tech/api/server-health')).status,200);
 assert.equal(server(new NextRequest('https://track-compititor.vercel.app/')).status,401);
});
