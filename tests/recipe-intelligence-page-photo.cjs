const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

function fixture(t, response) {
  const dom = new JSDOM('<img src="/photo.jpg"><img data-src="/lazy.jpg">', {url:'https://food.example/recipe/', runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  w.AbortController = AbortController;
  w.fetch = async (url, options) => { calls.push({url,options}); return response(); };
  w.eval(fs.readFileSync(path.join(__dirname,'../extensions/recipe-intelligence-capture/shared.js'),'utf8'));
  return {read:w.CaptureHelpers.pagePhoto,calls};
}
test('page fallback reads same-origin listed photos with normal page credentials and preserves bytes', async t => {
  const f = fixture(t, () => new Response(new Uint8Array([1,2,3]), {headers:{'content-type':'image/jpeg'}}));
  const result = await f.read('https://food.example/lazy.jpg','https://food.example/recipe/');
  assert.equal(result.base64,'AQID'); assert.equal(result.mime,'image/jpeg');
  assert.equal(f.calls[0].options.credentials,'same-origin');
  assert.equal(f.calls[0].options.redirect,'error');
  assert.equal(f.calls[0].options.mode,'same-origin');
});
test('page fallback rejects navigation, unlisted URLs and foreign origins before requesting', async t => {
  const f = fixture(t, () => {throw new Error('Must not request');});
  for (const [url,page] of [
    ['https://food.example/photo.jpg','https://food.example/other/'],
    ['https://food.example/private','https://food.example/recipe/'],
    ['https://other.example/photo.jpg','https://food.example/recipe/'],
    ['http://127.0.0.1/photo.jpg','https://food.example/recipe/'],
  ]) assert.equal(await f.read(url,page),null);
  assert.equal(f.calls.length,0);
});
test('page fallback leaves denied, HTML, empty and oversized responses unavailable', async t => {
  for (const response of [
    () => new Response('',{status:403}),
    () => new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}}),
    () => new Response('',{headers:{'content-type':'image/jpeg'}}),
    () => new Response('x',{headers:{'content-type':'image/jpeg','content-length':'10485761'}}),
    () => new Response(new Uint8Array(10485761),{headers:{'content-type':'image/jpeg'}}),
  ]) {
    const f = fixture(t,response);
    assert.equal(await f.read('https://food.example/photo.jpg','https://food.example/recipe/'),null);
  }
});
