const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { generateOpenAIImage } = require('../.test-build/openaiImages.js');
const { validateImageSettings, DEFAULT_IMAGE_SETTINGS, OPENAI_IMAGE_MODEL_IDS } = require('../.test-build/openaiImageSettings.js');
const { DEFAULT_IMAGE_MODEL, imageModelsFor, qualitySuffixFor, negativePromptFor, buildModelPrompt } = require('../.test-build/config.js');
const { readGenerationResponse } = require('../.test-build/generationResponse.js');
const { pairDirection, visualDirection, buildOpenAIImagePrompt } = require('../.test-build/openaiPrompt.js');
const { HORSE_SCENE_GUIDANCE, horseSceneGuidance, randomFramingsForHorseScene } = require('../.test-build/horseSceneGuidance.js');
const { sceneSeed } = require('../.test-build/sceneSeed.js');
const { SYSTEM, userPrompt } = require('../.test-build/prompts.js');
const originalFetch = global.fetch;
const originalKey = process.env.OPENAI_API_KEY;
afterEach(() => { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
const args = (settings = {}) => ({ model: 'gpt-image-2.5-sunburst', prompt: 'A horse', settings: { ...DEFAULT_IMAGE_SETTINGS, ...settings } });
const chunks = (text) => new ReadableStream({ start(c) { for (const byte of new TextEncoder().encode(text)) c.enqueue(Uint8Array.of(byte)); c.close(); } });

test('social sizes reach Sunburst 2.6 generation and edit requests unchanged', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, body: init.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(init.body) });
    return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
  };
  for (const size of ['1152x1440', '1024x1536', '1536x864']) {
    for (const references of [[], ['data:image/png;base64,aW1hZ2U=']]) {
      await generateOpenAIImage({ model: 'gpt-image-2.6-sunburst', prompt: 'Food photo',
        settings: { ...DEFAULT_IMAGE_SETTINGS, size }, references });
      assert.equal(requests.at(-1).body.size, size);
      assert.ok(requests.at(-1).url.endsWith(references.length ? '/edits' : '/generations'));
    }
  }
  assert.throws(() => validateImageSettings('gpt-image-1.5', { size: '1152x1440' }), /Unsupported image size/);
  for (const size of ['1080x1350', '1000x1500']) {
    assert.throws(() => validateImageSettings('gpt-image-2.6-sunburst', { size }), /Unsupported image size/);
  }
});

test('all screenshot models are available in every workspace; Sunburst defaults', () => {
  assert.equal(DEFAULT_IMAGE_MODEL, 'gpt-image-2.5-sunburst');
  assert.ok(OPENAI_IMAGE_MODEL_IDS.includes('gpt-image-2.6-sunburst'));
  for (const kind of ['horses', 'recipes', 'fashion']) for (const designed of [false, true]) {
    const ids = imageModelsFor(kind, designed).map((x) => x.value);
    for (const id of OPENAI_IMAGE_MODEL_IDS) assert.ok(ids.includes(id));
    assert.equal(new Set(ids).size, ids.length);
  }
});
test('high quality defaults for every OpenAI model and explicit choices remain available', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const requests = [];
  global.fetch = async (_, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({data:[{b64_json:'aW1hZ2U='}]});
  };
  for (const model of OPENAI_IMAGE_MODEL_IDS) {
    assert.equal(validateImageSettings(model, undefined).quality, 'high');
    assert.equal(validateImageSettings(model, {quality:'auto'}).quality, 'auto');
    await generateOpenAIImage({model, prompt:'A horse'});
    assert.equal(requests.at(-1).quality, 'high');
  }
});

test('2.6 complexity is optional and sent only when explicitly selected', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const sent = [];
  global.fetch = async (_, init) => {
    sent.push(init.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(init.body));
    return Response.json({data:[{b64_json:'aW1hZ2U='}]});
  };
  for (const complexity of [undefined, 'default', 'low', 'medium', 'high']) {
    const settings = {...DEFAULT_IMAGE_SETTINGS, ...(complexity ? {complexity} : {})};
    await generateOpenAIImage({model:'gpt-image-2.6-sunburst', prompt:'Same food, different plate', settings, references:['data:image/png;base64,YQ==']});
    assert.equal(sent.at(-1).complexity, !complexity || complexity === 'default' ? undefined : complexity);
  }
  assert.throws(() => validateImageSettings('gpt-image-2.6-sunburst', {complexity:'extreme'}), /complexity/);
  assert.throws(() => validateImageSettings('gpt-image-2.5-sunburst', {complexity:'high'}), /complexity/);
});

test('recipe image-to-image sends the reference and fixed prompt directly to edits with the requested defaults', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const {route, calls} = loadRoute();
    const requests = [];
    global.fetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/images/edits');
      const form = init.body;
      assert.ok(form instanceof FormData);
      assert.equal(form.getAll('image[]').length, 1);
      assert.equal(await form.get('image[]').text(), 'original-food');
      requests.push(form);
      return Response.json({data:[{b64_json:'aW1hZ2U='}], usage:{input_tokens:100,output_tokens:1372,input_tokens_details:{text_tokens:60,image_tokens:40}}});
    };
    for (const extraInstructions of [undefined, '  Use a blue ceramic bowl and a silver spoon.  ']) {
      const response = await route.POST(new Request('http://localhost/api/generate', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({contentType:'recipes', recipeWorkflow:'imageToImage', references:['data:image/png;base64,b3JpZ2luYWwtZm9vZA=='], extraInstructions,
          designPin:true, trendResearch:true, sceneMode:'soup', customSubject:'a different dish'}),
      }));
      const result = await response.json();
      assert.equal(response.status, 200, result.error);
      assert.equal(result.usedReference, true);
      assert.equal(result.imageModel, 'gpt-image-2.6-sunburst');
      assert.equal(result.imageUrl, 'data:image/png;base64,aW1hZ2U=');
      assert.equal(result.textCost, 0);
      assert.equal(result.searchCost, 0);
      assert.equal(result.imageCost, .04178);
      assert.equal(result.costIncomplete, false);
      assert.equal('renderedPrompt' in result, false);
      assert.equal('prompt' in result, false);
    }
    const form = requests[0];
    for (const [key,value] of Object.entries({model:'gpt-image-2.6-sunburst', n:'1',size:'1024x1536', quality:'high',output_format:'png',background:'opaque',moderation:'auto'})) assert.equal(form.get(key), value);
    assert.equal(form.has('complexity'), false);
    assert.equal(form.has('stream'), false);
    assert.equal(form.has('partial_images'), false);
    const prompt = form.get('prompt');
    for (const requirement of ['same ingredient proportions', 'natural imperfections', 'iPhone 17 Pro Max', 'always change the plate', 'always change the table', 'change its color or finish', 'no fake steam', 'no studio-advertising look', 'no text or watermark']) assert.ok(prompt.includes(requirement), requirement);
    assert.equal(requests[1].get('prompt'), prompt + '\nAdditional user instructions: Use a blue ceramic bowl and a silver spoon.');
    assert.equal(calls(), 0, 'The recipe planner must never rewrite a reference transformation.');
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});

test('2 in one image sends both food photos to one image edit with the chosen settings', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const {route, calls} = loadRoute();
    let imageCalls = 0, form;
    global.fetch = async (url, init) => {
      imageCalls++; assert.equal(url, 'https://api.openai.com/v1/images/edits'); form = init.body;
      return Response.json({data:[{b64_json:'aW1hZ2U='}],usage:{input_tokens:100,output_tokens:1372,input_tokens_details:{text_tokens:60,image_tokens:40}}});
    };
    const refs=['data:image/png;base64,Zmlyc3QtZm9vZA==','data:image/jpeg;base64,c2Vjb25kLWZvb2Q='];
    const response = await route.POST(new Request('http://localhost/api/generate', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      contentType:'recipes',recipeWorkflow:'twoInOne',references:refs,extraInstructions:'Keep the herbs visible.',
      imageModel:'gpt-image-2.6-sunburst',imageSettings:{size:'1536x1024',quality:'medium',output_format:'png',background:'opaque',moderation:'auto',partial_images:0,complexity:'default'},
    })}));
    const result=await response.json();assert.equal(response.status,200,result.error);
    assert.equal(result.recipeWorkflow,'twoInOne');assert.equal(result.imageUrl,'data:image/png;base64,aW1hZ2U=');
    assert.equal(imageCalls,1);assert.equal(calls(),0);
    assert.equal(form.get('n'),'1');assert.equal(form.get('size'),'1536x1024');assert.equal(form.get('quality'),'medium');
    const images=form.getAll('image[]');assert.equal(images.length,2);
    assert.equal(await images[0].text(),'first-food');assert.equal(await images[1].text(),'second-food');
    const prompt=form.get('prompt');
    for(const text of ['BOTH uploaded food photos','every clearly visible ingredient','one coherent','not two images side by side','fresh composition','Additional user instructions: Keep the herbs visible.']) assert.ok(prompt.includes(text),text);
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});

test('2 in one image rejects invalid photos and settings before any provider call', async () => {
  const {route,calls}=loadRoute();let imageCalls=0;
  global.fetch=async()=>{imageCalls++;throw new Error('must not call provider');};
  const refs=['data:image/png;base64,YQ==','data:image/jpeg;base64,Yg=='];
  const valid={contentType:'recipes',recipeWorkflow:'twoInOne',references:refs};
  for(const change of [
    {references:undefined},{references:[]},{references:[refs[0]]},{references:[...refs,refs[0]]},
    {references:[refs[0],'https://example.com/photo.jpg']},{references:[refs[0],'data:image/png;base64,']},
    {references:[refs[0],'data:image/png;base64,'+'A'.repeat(1_800_000)]},
    {contentType:'fashion'},{captionOnly:true},{imageModel:'fal-ai/flux-2-pro'},
    {extraInstructions:{}},{extraInstructions:'a'.repeat(4001)},{imageSettings:{quality:'invalid'}},
  ]){
    const response=await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...valid,...change})}));
    assert.equal(response.status,400);assert.ok((await response.json()).error);
  }
  assert.equal(imageCalls,0);assert.equal(calls(),0);
});

test('recipe image-to-image rejects missing, malformed and oversized input before calling any provider', async () => {
  const {route, calls} = loadRoute();
  let imageCalls = 0;
  global.fetch = async () => { imageCalls++; throw new Error('must not call provider'); };
  const valid = {contentType:'recipes',recipeWorkflow:'imageToImage',references:['data:image/png;base64,YQ==']};
  for (const change of [
    {references:undefined}, {references:[]}, {references:['data:image/png;base64,YQ==','data:image/png;base64,Yg==']},
    {references:['https://example.com/photo.png']}, {references:['data:image/png;base64,']},
    {references:['data:image/png;base64,'+'YQ=='.repeat(800000)]},
    {contentType:'horses'}, {captionOnly:true}, {imageModel:'fal-ai/flux-2-pro'},
    {extraInstructions:{}}, {extraInstructions:'a'.repeat(4001)},
    {imageSettings:{quality:'invalid'}}, {recipeWorkflow:'unknown'},
  ]) {
    const response = await route.POST(new Request('http://localhost/api/generate', {
      method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify({...valid,...change}),
    }));
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
  }
  assert.equal(calls(), 0);
  assert.equal(imageCalls, 0);
});

test('recipe image-to-image preserves manual settings, streams previews and surfaces failures without retries', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  const oldError = console.error;
  try {
    const {route, calls} = loadRoute();
    const payload = {contentType:'recipes',recipeWorkflow:'imageToImage',references:['data:image/webp;base64,YQ=='],
      imageModel:'gpt-image-2.6-sunburst',imageSettings:{size:'1536x1024',quality:'medium',complexity:'low',output_format:'webp',background:'opaque',moderation:'low',partial_images:1}};
    const request = () => new Request('http://localhost/api/generate', {method:'POST',headers:{'content-type':'application/json',accept:'application/x-ndjson'},body:JSON.stringify(payload)});
    let imageCalls = 0;
    global.fetch = async (_, init) => {
      imageCalls++;
      const form = init.body;
      for (const [key,value] of Object.entries(payload.imageSettings)) assert.equal(form.get(key), String(value));
      assert.equal(form.get('stream'), 'true');
      return new Response(chunks('data: {"type":"image_edit.partial_image","b64_json":"cA=="}\n\ndata: {"type":"image_edit.completed","b64_json":"Zg==","output_format":"webp"}\n\n'));
    };
    const previews = [];
    const result = await readGenerationResponse(await route.POST(request()), (url) => previews.push(url));
    assert.deepEqual(previews, ['data:image/webp;base64,cA==']);
    assert.equal(result.imageUrl, 'data:image/webp;base64,Zg==');
    assert.equal(result.imageSettings.complexity, 'low');
    assert.equal(imageCalls, 1);
    assert.equal(calls(), 0);
    console.error = () => {};
    global.fetch = async () => { imageCalls++; return Response.json({error:{message:'Model access required'}},{status:403}); };
    await assert.rejects(readGenerationResponse(await route.POST(request()), () => {}), /Model access required/);
    assert.equal(imageCalls, 2);
  } finally {
    console.error = oldError;
    if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal;
  }
});
test('rejects incompatible quality, transparency and preview values before any request', async () => {
  global.fetch = () => { throw new Error('must not call provider'); };
  for (const quality of ['max', 'xhigh']) assert.throws(() => validateImageSettings('gpt-image-1.5', { quality }), /quality/);
  assert.throws(() => validateImageSettings(DEFAULT_IMAGE_MODEL, { output_format: 'jpeg', background: 'transparent' }), /PNG/);
  for (const partial_images of [-1, 4, 1.5, '2']) assert.throws(() => validateImageSettings(DEFAULT_IMAGE_MODEL, { partial_images }), /Partial/);
  assert.throws(() => validateImageSettings('unknown', {}), /Unsupported/);
  await assert.rejects(generateOpenAIImage(args({ size: 'evil' })), /size/);
});
test('generation passes all settings, uses only OpenAI and preserves WebP bytes', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  let calls = 0;
  global.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    const body = JSON.parse(init.body);
    assert.deepEqual(body, { model: DEFAULT_IMAGE_MODEL, prompt: 'A horse', n: 1,
      size: '1536x1024', quality: 'max', output_format: 'webp', background: 'transparent', moderation: 'low' });
    return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }], output_format: 'webp' });
  };
  const result = await generateOpenAIImage(args({ size: '1536x1024', quality: 'max', output_format: 'webp', background: 'transparent', moderation: 'low' }));
  assert.equal(result.dataUrl, 'data:image/webp;base64,aW1hZ2U=');
  assert.equal(result.usage, undefined);
  assert.equal(calls, 1);
});
test('references use multipart edits and retain selected model and settings', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.equal(init.headers['Content-Type'], undefined);
    assert.equal(init.body.get('model'), DEFAULT_IMAGE_MODEL);
    assert.equal(init.body.get('quality'), 'xhigh');
    assert.equal(init.body.getAll('image[]').length, 2);
    assert.equal(init.body.getAll('image[]')[0].type, 'image/png');
    return Response.json({ data: [{ b64_json: 'ZmluYWw=' }] });
  };
  const result = await generateOpenAIImage({ ...args({ quality: 'xhigh' }), references: ['data:image/png;base64,YQ==', 'data:image/webp;base64,Yg=='] });
  assert.equal(result.dataUrl, 'data:image/png;base64,ZmluYWw=');
});
test('streaming handles split CRLF frames and distinguishes previews from final image', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const previews = [];
  global.fetch = async (_, init) => {
    assert.equal(JSON.parse(init.body).partial_images, 3);
    assert.equal(JSON.parse(init.body).stream, true);
    return new Response(chunks('event: image_generation.partial_image\r\ndata: {"type":"image_generation.partial_image","b64_json":"cA=="}\r\n\r\ndata: {"type":"image_generation.completed","b64_json":"Zg==","usage":{"input_tokens":10,"output_tokens":500,"input_tokens_details":{"text_tokens":10,"image_tokens":0}}}\r\n\r\n'));
  };
  const result = await generateOpenAIImage({ ...args({ partial_images: 3 }), onPartial: (url) => previews.push(url) });
  assert.deepEqual(previews, ['data:image/png;base64,cA==']);
  assert.equal(result.dataUrl, 'data:image/png;base64,Zg==');
  assert.equal(result.partialImages, 1);
  assert.equal(result.usage.output_tokens, 500);
});
test('stream ending with only a preview fails instead of treating preview as finished', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  global.fetch = async () => new Response(chunks('data: {"type":"image_edit.partial_image","b64_json":"cA=="}\n\n'));
  await assert.rejects(generateOpenAIImage(args({ partial_images: 1 })), /final image/);
});
test('provider failure is surfaced once without retrying or substituting models', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ error: { message: 'Model access required' } }, { status: 403 }); };
  await assert.rejects(generateOpenAIImage(args()), /Model access required/);
  assert.equal(calls, 1);
});
test('client consumes fragmented previews and final result; reports stream errors', async () => {
  const previews = [];
  const response = (body) => new Response(chunks(body), { headers: { 'content-type': 'application/x-ndjson' } });
  const result = await readGenerationResponse(response('{"type":"partial","imageUrl":"preview"}\n{"type":"result","data":{"imageUrl":"final","description":"🐴"}}\n'), (url) => previews.push(url));
  assert.deepEqual(previews, ['preview']);
  assert.equal(result.imageUrl, 'final');
  assert.equal(result.description, '🐴');
  await assert.rejects(readGenerationResponse(response('{"type":"error","error":"No access"}\n'), () => {}), /No access/);
  await assert.rejects(readGenerationResponse(response('{"type":"partial","imageUrl":"preview"}\n'), () => {}), /interrupted/);
});

// Exercise the actual route with fake text/storage providers; no network or API spend.
function loadRoute(planOverrides = {}) {
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const cache = new Map();
  let textCalls = 0;
  const textRequests = [];
  class TextClient {
    responses = { create: async () => ({
      output_text: JSON.stringify({ trendAngle: 'warm soup', trendSummary: 'A comforting dish' }),
      usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } },
      output: [{ type: 'web_search_call', action: { type: 'search' } }],
    }) };
    chat = { completions: { create: async (request) => {
      textCalls++;
      textRequests.push(request);
      return { choices: [{ message: { content: JSON.stringify({ idea: 'A horse', prompt: 'Realistic subject', description: 'Warm afternoon light.', title: 'Homemade Soup', ingredients: ['carrots'], instructions: ['Cook gently.'], referenceStrategy: 'Reference 1 leads; Reference 2 supplies light.', viralScore: 'medium', viralReason: 'Natural light', ...planOverrides }) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } };
    } } };
  }
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const localRequire = (id) => {
      if (id === 'openai' || id === '@anthropic-ai/sdk') return TextClient;
      if (id === '@fal-ai/client') return { fal: { config() {}, storage: { upload() { throw new Error('unexpected fal upload'); } }, subscribe() { throw new Error('unexpected fal render'); } } };
      if (id.startsWith('@/')) return load(path.resolve(__dirname, '..', id.slice(2) + '.ts'));
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'));
      return require(id);
    };
    new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
    return module.exports;
  }
  return { route: load(path.resolve(__dirname, '../app/api/generate/route.ts')), calls: () => textCalls, requests: textRequests };
}
test('actual route renders all content types using selected OpenAI settings without fal credentials', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const { route } = loadRoute();
    for (const contentType of ['horses', 'recipes', 'fashion']) {
      let imageCalls = 0;
      global.fetch = async (url, init) => {
        imageCalls++;
        assert.equal(url, 'https://api.openai.com/v1/images/generations');
        const sent = JSON.parse(init.body);
        assert.equal(sent.model, DEFAULT_IMAGE_MODEL);
        assert.equal(sent.quality, 'max');
        assert.equal(sent.output_format, 'webp');
        return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
      };
      const response = await route.POST(new Request('http://localhost/api/generate', { method: 'POST', headers: { accept: 'application/x-ndjson', 'content-type': 'application/json' }, body: JSON.stringify({ contentType, designPin: contentType === 'recipes', imageSettings: { quality: 'max', output_format: 'webp' } }) }));
      const result = await readGenerationResponse(response, () => {});
      assert.equal(result.imageUrl, 'data:image/webp;base64,aW1hZ2U=');
      assert.equal(result.falModel, DEFAULT_IMAGE_MODEL);
      assert.equal(result.imageCostIncluded, false);
      assert.equal(result.costIncomplete, true);
      assert.equal(result.imageSettings.quality, 'max');
      assert.equal(imageCalls, 1);
    }
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});
test('route includes actual image, planning, vision, and recipe search usage', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const { route } = loadRoute();
    global.fetch = async () => Response.json({ data: [{ b64_json: 'aW1hZ2U=' }], usage: {
      input_tokens: 100, output_tokens: 5488, input_tokens_details: { text_tokens: 60, image_tokens: 40 },
    } });
    for (const contentType of ['horses', 'fashion', 'recipes']) {
      const response = await route.POST(new Request('http://localhost/api/generate', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
        contentType, trendResearch: contentType === 'recipes', imageSettings:{quality:'max'},
      })}));
      const result = await response.json();
      assert.equal(response.status, 200, result.error);
      assert.equal(result.imageCostIncluded, true);
      assert.equal(result.costIncomplete, false);
      assert.ok(Math.abs(result.imageCost - 0.16526) < 1e-10);
      const textCost = contentType === 'recipes' ? 0.0002355 : 0.000195;
      assert.ok(Math.abs(result.textCost - textCost) < 1e-10, `${contentType} ${result.textCost}`);
      assert.equal(result.searchCost, contentType === 'recipes' ? 0.01 : 0);
      assert.ok(Math.abs(result.cost - result.imageCost - result.textCost - result.searchCost) < 1e-10);
    }
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});
test('all 36 UI scene options have a specific direction and a valid scene seed', () => {
  const fs = require('node:fs');
  const page = fs.readFileSync(require('node:path').resolve(__dirname, '../app/page.tsx'), 'utf8');
  const block = page.slice(page.indexOf('const SCENE_MODES:'), page.indexOf('type ContentType'));
  const modes = [...block.matchAll(/value:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(modes.length, 36);
  assert.deepEqual([...modes].sort(), Object.keys(HORSE_SCENE_GUIDANCE).sort());
  for (const mode of modes) {
    for (let i = 0; i < 20; i++) {
      const seed = sceneSeed({}, mode);
      for (const name of ['sceneType', 'setting', 'breed', 'action', 'light']) assert.ok(seed[name], `${mode} missing ${name}`);
      if (mode === 'black') assert.match(seed.breed, /friesian/i);
      if (mode === 'foal') assert.match(seed.breed, /foal/i);
    }
  }
});
test('automatic framing supports the scene, while the caller can use explicit framing', () => {
  const pool = ['eye','closeup','portrait','half','full','wide'];
  for (const [mode, expected] of Object.entries({eye:['eye'],big_nose:['closeup'],running:['full','wide'],dusty_run:['full','wide'],mural:['full','wide'],buttes:['full','wide'],barn_peek:['portrait','half','full','wide'],horse_human_bond:['half','full','wide'],river_crossing:['full','wide'],appaloosa_wildflowers:['half','full','wide'],black_horse_rain:['portrait','half','full','wide'],horse_wall_painting:['full','wide'],beach_running:['full','wide']})) {
    assert.deepEqual(randomFramingsForHorseScene(mode,pool),expected);
  }
  assert.deepEqual(randomFramingsForHorseScene('appaloosa',pool),pool);
});
test('mural prompt describes a giant painted wall without contradictory size instructions', () => {
  const seed = sceneSeed({}, 'mural');
  const prompt = userPrompt(seed);
  assert.match(SYSTEM, /giant horse mural/);
  assert.match(prompt, /monumental painted horse mural/);
  assert.doesNotMatch(SYSTEM, /not giant|human-scale/);
  const final = buildOpenAIImagePrompt({prompt:'a mural',kind:'horses',scene:seed.sceneType,designed:false,hasReferences:false,sceneGuidance:HORSE_SCENE_GUIDANCE.mural});
  assert.match(final,/giant horse mural/); assert.match(final,/flat painting/);
  assert.doesNotMatch(final,/photorealistic equine photograph/);
});
test('all 36 scene instructions reach the planner and image request on every OpenAI model', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const { route, requests } = loadRoute();
    let sent;
    global.fetch = async (_, init) => { sent = JSON.parse(init.body); return Response.json({data:[{b64_json:'aW1hZ2U='}]}); };
    for (const [mode, guidance] of Object.entries(HORSE_SCENE_GUIDANCE)) for (const model of OPENAI_IMAGE_MODEL_IDS) {
      const start = requests.length;
      const res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentType:'horses',sceneMode:mode,imageModel:model,batchIndex:0,batchOffset:0})}));
      const result = await res.json();
      assert.equal(res.status,200,`${mode} ${model}: ${result.error}`);
      assert.equal(sent.model,model);
      assert.ok(sent.prompt.includes(guidance),`${mode} missing final scene guidance`);
      assert.ok(JSON.stringify(requests[start].messages).includes(guidance),`${mode} missing planner guidance`);
      assert.match(requests[start].messages[0].content, /GPT IMAGE PROMPT DIRECTION/);
      assert.equal(result.renderedPrompt,sent.prompt);
    }
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});
test('an uploaded reference and a custom subject keep precedence over the scene chip', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const {route} = loadRoute();
    const bodies = [];
    global.fetch = async (_, init) => { bodies.push(init.body); return Response.json({data:[{b64_json:'aW1hZ2U='}]}); };
    for (const mode of ['snow', 'horse_human_bond', 'river_crossing', 'appaloosa_wildflowers', 'black_horse_rain', 'horse_wall_painting', 'beach_running']) {
      for (const override of [{references:['data:image/png;base64,YQ==']},{customSubject:'a horse on the beach'}]) {
        const res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentType:'horses',sceneMode:mode,batchIndex:0,batchOffset:0,...override})}));
        const result = await res.json(); assert.equal(res.status,200);
        assert.ok(!result.renderedPrompt.includes(HORSE_SCENE_GUIDANCE[mode]));
      }
    }
    assert.ok(bodies[0] instanceof FormData);
    assert.equal(bodies[0].getAll('image[]').length,1);
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});
test('new scene batches vary their action and setting despite added framing instructions', () => {
  for (const mode of ['horse_human_bond', 'river_crossing', 'appaloosa_wildflowers', 'black_horse_rain', 'horse_wall_painting', 'beach_running']) {
    const used = {actions: [], settings: [], breeds: []};
    const actions = new Set();
    const settings = new Set();
    for (let i = 0; i < 8; i++) {
      const seed = sceneSeed(used, mode);
      actions.add(seed.action); settings.add(seed.setting);
      used.actions.push(`${seed.action}. CAMERA FRAMING (most important rule): FULL BODY\nSCENE FOCUS: test`);
      used.settings.push(seed.setting); used.breeds.push(seed.breed);
      if (mode === 'horse_human_bond') assert.match(seed.breed, /one adult person/);
      if (mode === 'river_crossing') assert.match(seed.setting, /creek|stream|river|ford/i);
      if (mode === 'appaloosa_wildflowers') assert.match(seed.breed, /Appaloosa/i);
      if (mode === 'black_horse_rain') assert.match(seed.breed, /black/i);
      if (mode === 'horse_wall_painting') assert.match(seed.breed, /painted depiction/i);
      if (mode === 'beach_running') assert.match(seed.setting, /beach|shore/i);
    }
    assert.equal(actions.size, 8, `${mode} repeated an action`);
    assert.equal(settings.size, 8, `${mode} repeated a setting`);
  }
});
test('finished wall art remains a painting in planner and image prompts', () => {
  const seed = sceneSeed({}, 'horse_wall_painting');
  assert.match(userPrompt(seed), /finished horse painting on a textured wall/i);
  const args = {prompt:'a painted horse',kind:'horses',scene:seed.sceneType,designed:false,hasReferences:false,framing:'wide',sceneGuidance:HORSE_SCENE_GUIDANCE.horse_wall_painting};
  const final = buildOpenAIImagePrompt(args);
  assert.match(final, /finished horse painting on a textured wall/i);
  assert.match(final, /flat painted artwork/i);
  assert.doesNotMatch(final, /photorealistic equine photograph|giant horse mural/i);
  const transparent = buildOpenAIImagePrompt({...args,transparent:true});
  assert.match(transparent, /isolated fragment of textured wall/i);
  assert.match(transparent, /fully transparent/i);
  const suffix = qualitySuffixFor(seed.sceneType);
  assert.match(suffix, /flat painted artwork/i);
  assert.doesNotMatch(negativePromptFor(seed.sceneType), /illustration, painting, painterly/);
  assert.doesNotMatch(buildModelPrompt('painted horse',suffix,'fal-ai/flux-2-pro','horses',false,seed.sceneType), /authentic outdoor horse photography/i);
});
test('wall painting respects camera framing, transparency, and an explicit subject', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const {route} = loadRoute();
    let sent;
    global.fetch = async (_, init) => { sent = JSON.parse(init.body); return Response.json({data:[{b64_json:'aW1hZ2U='}]}); };
    async function generate(extra) {
      const res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentType:'horses',sceneMode:'horse_wall_painting',batchIndex:0,batchOffset:0,...extra})}));
      assert.equal(res.status,200);
      return res.json();
    }
    const eye = await generate({framing:'eye'});
    assert.match(eye.seed.action, /Macro of the painted horse eye/);
    assert.match(sent.prompt, /flat painted artwork/);
    const full = await generate({framing:'full',imageSettings:{background:'transparent'}});
    assert.match(full.seed.action, /entire horse painting/);
    assert.match(sent.prompt, /isolated fragment of textured wall/);
    assert.match(sent.prompt, /fully transparent/);
    const custom = await generate({customSubject:'a horse on the beach'});
    assert.equal(custom.seed.sceneType, 'majestic single horse portrait');
    assert.match(sent.prompt, /Requested subject: a horse on the beach/);
    assert.doesNotMatch(sent.prompt, /finished horse painting|flat painted artwork/);
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});
test('pair directions vary consecutive images and preserve explicit subject or reference', () => {
  const directions = Array.from({length: 8}, (_, index) => pairDirection('couple', index, 2, false, ''));
  assert.equal(new Set(directions.map((d) => d.action)).size, 8);
  assert.equal(new Set(directions.map((d) => d.setting)).size, 8);
  assert.equal(pairDirection('couple', 0, 0, true, ''), null);
  assert.equal(pairDirection('couple', 0, 0, false, 'two horses on a beach'), null);
  assert.equal(pairDirection('snow', 0, 0, false, ''), null);
  assert.equal(pairDirection('couple', 0, 0, false, '', 'eye'), null);
  assert.notEqual(visualDirection(0, 0, false), visualDirection(1, 0, false));
  assert.equal(visualDirection(0, 0, true), undefined);
});
test('OpenAI prompts preserve framing, art and reference constraints without forcing photographic styling', () => {
  const portrait = buildOpenAIImagePrompt({prompt:'two horses',kind:'horses',scene:'horse couple affection scene',designed:false,hasReferences:false,framing:'portrait',direction:pairDirection('couple',0,0,false,'')});
  assert.match(portrait, /photorealistic/); assert.ok(portrait.includes(pairDirection('couple',0,0,false,'').action)); assert.match(portrait, /portrait/);
  const art = buildOpenAIImagePrompt({prompt:'painted flowers',kind:'horses',scene:'dreamy greeting horse art scene',designed:false,hasReferences:true,framing:'eye'});
  assert.match(art, /decorative horse artwork/); assert.doesNotMatch(art, /photorealistic/); assert.match(art, /Reference images/);
  assert.doesNotMatch(art, /explicitly requested camera framing/);
  const recipe = buildOpenAIImagePrompt({prompt:'Recipe title: Soup',kind:'recipes',scene:'soup recipe',designed:true,hasReferences:false});
  assert.match(recipe, /Recipe title: Soup/); assert.match(recipe, /requested text/);
  const transparent = buildOpenAIImagePrompt({prompt:'a pair',kind:'horses',scene:'horse couple affection scene',designed:false,hasReferences:false,transparent:true,direction:pairDirection('couple',0,0,false,'')});
  assert.match(transparent, /fully transparent/); assert.doesNotMatch(transparent, /open meadow/);
});
test('successive pair requests send distinct composition directions for every OpenAI image model', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const { route } = loadRoute();
    for (const model of OPENAI_IMAGE_MODEL_IDS) {
      const prompts = [];
      global.fetch = async (_, init) => { prompts.push(JSON.parse(init.body).prompt); return Response.json({data:[{b64_json:'aW1hZ2U='}]}); };
      for (const batchIndex of [0, 1]) {
        const response = await route.POST(new Request('http://localhost/api/generate', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({contentType:'horses',sceneMode:'couple',framing:'portrait',imageModel:model,batchIndex,batchOffset:0})}));
        const result = await response.json();
        assert.equal(response.status, 200); assert.equal(result.renderedPrompt, prompts[batchIndex]);
        assert.match(prompts[batchIndex], /portrait/);
      }
      assert.ok(prompts[0].includes(pairDirection('couple',0,0,false,'','portrait').action));
      assert.ok(prompts[1].includes(pairDirection('couple',1,0,false,'','portrait').action));
      assert.notEqual(prompts[0], prompts[1]);
    }
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});
test('pair categories have distinct actions and 50 non-repeating coherent combinations', () => {
  for (const mode of ['couple', 'friendship', 'blackwhite']) for (const offset of [0, 3, 7, 8, 71]) {
    const scenes = Array.from({length:50}, (_, i) => pairDirection(mode, i, offset, false, '', 'portrait'));
    assert.equal(new Set(scenes.map(({action, setting}) => `${action}|${setting}`)).size, 50, `${mode} ${offset}`);
    for (let i = 1; i < scenes.length; i++) {
      assert.notEqual(scenes[i].action, scenes[i-1].action);
      assert.notEqual(scenes[i].setting, scenes[i-1].setting);
    }
    if (mode === 'blackwhite') for (const scene of scenes) {
      assert.match(scene.subject, /black/i); assert.match(scene.subject, /white/i);
    }
  }
  const singles = Array.from({length:72}, (_, offset) => pairDirection('couple', 0, offset, false, '', 'portrait'));
  assert.equal(new Set(singles.map(({action, setting}) => `${action}|${setting}`)).size, 72);
  assert.notEqual(pairDirection('couple',0,0,false,'').action, pairDirection('friendship',0,0,false,'').action);
});

test('framing wins over incompatible eye, pair, and mural instructions', () => {
  assert.match(horseSceneGuidance('couple', 'eye'), /other subjects are outside the crop/);
  for (const mode of ['horse_human_bond', 'river_crossing']) {
    assert.match(horseSceneGuidance(mode, 'eye'), /show only one horse eye and surrounding coat/);
  }
  assert.doesNotMatch(horseSceneGuidance('eye', 'wide'), /extreme close-up/);
  assert.doesNotMatch(horseSceneGuidance('big_nose', 'full'), /prominent in a playful close-up/);
  const mural = buildOpenAIImagePrompt({prompt:'painted horse eye',kind:'horses',scene:'artist painting a horse mural',designed:false,hasReferences:false,framing:'eye',sceneGuidance:horseSceneGuidance('mural','eye')});
  assert.match(mural, /artist may be outside this close crop/);
  assert.doesNotMatch(mural, /with an artist for scale\./);
});

test('reference modes and explicit subjects reach both the planner and image edit request', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const {route, requests} = loadRoute();
    let sent;
    global.fetch = async (_, init) => { sent = init.body; return Response.json({data:[{b64_json:'aW1hZ2U='}]}); };
    for (const contentType of ['horses','fashion']) for (const [imgStrength, expected] of [[.5,/Stay close to the reference/],[.7,/balanced changes/],[.9,/creative inspiration/]]) {
      const before = requests.length;
      const res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentType,imgStrength,references:['data:image/png;base64,YQ==','data:image/png;base64,Yg==']})}));
      assert.equal(res.status, 200);
      assert.ok(sent instanceof FormData);
      assert.match(sent.get('prompt'),expected);
      assert.match(sent.get('prompt'),/Reference 1 leads; Reference 2 supplies light/);
      assert.match(requests[before].messages[0].content,/GPT IMAGE PROMPT DIRECTION/);
    }
    for (const contentType of ['horses','fashion']) {
      const before = requests.length;
      const res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentType,customSubject:'a bright red jacket',references:['data:image/png;base64,YQ==']})}));
      assert.equal(res.status,200);
      assert.match(sent.get('prompt'),/explicitly requested subject takes priority/);
      assert.match(sent.get('prompt'),/Requested subject: a bright red jacket/);
      assert.match(JSON.stringify(requests[before].messages),/a bright red jacket/);
    }
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});

test('all recipe design styles use the selected canvas without a conflicting fixed aspect ratio', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const {route, requests} = loadRoute();
    let sent;
    global.fetch = async (_, init) => { sent = JSON.parse(init.body); return Response.json({data:[{b64_json:'aW1hZ2U='}]}); };
    const styles = ['vintage_notebook','bold_hero','clean_editorial','rustic_farmhouse','step_by_step_mini','ingredient_spotlight','scoop_serve','hero_recipe_card_combo','story_card_facebook_post'];
    for (const style of styles) for (const imageModel of OPENAI_IMAGE_MODEL_IDS) {
      const before = requests.length;
      const res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentType:'recipes',designPin:true,recipePinStyle:style,imageModel,imageSettings:{size:'1536x1024'}})}));
      assert.equal(res.status,200,`${style} ${imageModel}`);
      assert.equal(sent.model,imageModel);
      assert.match(sent.prompt,/Output canvas: compose for 1536x1024/);
      assert.doesNotMatch(sent.prompt,/Vertical 4:5 format/i);
      assert.match(sent.prompt,/Homemade Soup/);
      assert.match(requests[before].messages[0].content,/GPT IMAGE PROMPT DIRECTION/);
    }
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});

test('mural close crops and transparent pairs reach the planner without forcing an incompatible setting', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const {route, requests} = loadRoute();
    let sent;
    global.fetch = async (_, init) => { sent = JSON.parse(init.body); return Response.json({data:[{b64_json:'aW1hZ2U='}]}); };
    let res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentType:'horses',sceneMode:'mural',framing:'eye'})}));
    let result = await res.json();
    assert.equal(res.status,200);
    assert.match(result.seed.action,/artist may be outside the crop/);
    assert.match(sent.prompt,/artist may be outside this close crop/);
    res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentType:'horses',sceneMode:'couple',batchIndex:0,batchOffset:0,imageSettings:{background:'transparent'}})}));
    result = await res.json();
    assert.equal(res.status,200);
    assert.match(result.seed.setting,/fully transparent background without scenery/);
    assert.match(sent.prompt,/Background: fully transparent/);
    assert.doesNotMatch(sent.prompt,/in a spring meadow/);
    assert.match(requests[requests.length-2].messages[0].content,/do not describe a surrounding scene/);
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});

test('artwork references keep their medium and an explicitly selected crop', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const {route, requests} = loadRoute({visualMedium:'artwork', prompt:'Watercolor horse with flowers'});
    let sent;
    global.fetch = async (_, init) => { sent = init.body; return Response.json({data:[{b64_json:'aW1hZ2U='}]}); };
    const res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      contentType:'horses', framing:'wide', imgStrength:.5, references:['data:image/png;base64,YQ=='],
    })}));
    assert.equal(res.status,200);
    assert.match(sent.get('prompt'), /Create horse artwork/);
    assert.match(sent.get('prompt'), /Camera framing: follow the requested wide crop/);
    assert.doesNotMatch(sent.get('prompt'), /photorealistic equine photograph/);
    assert.match(JSON.stringify(requests[0].messages), /Honor that crop even if the reference uses a different crop/);
    assert.match(JSON.stringify(requests[0].messages), /do not turn an artistic reference into documentary photography/);
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});

test('balanced references vary across a batch while stay-close references keep their composition guidance', async () => {
  process.env.OPENAI_API_KEY = 'unit-test-placeholder';
  const oldFal = process.env.FAL_KEY; delete process.env.FAL_KEY;
  try {
    const {route} = loadRoute({visualMedium:'photograph'});
    const prompts = [];
    global.fetch = async (_, init) => { prompts.push(init.body.get('prompt')); return Response.json({data:[{b64_json:'aW1hZ2U='}]}); };
    for (const strength of [.7, .5]) for (const batchIndex of [0,1]) {
      const res = await route.POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        contentType:'horses', imgStrength:strength, batchIndex, batchOffset:0, framing:'random', references:['data:image/png;base64,YQ=='],
      })}));
      assert.equal(res.status,200);
    }
    assert.notEqual(prompts[0],prompts[1]);
    assert.equal(prompts[2],prompts[3]);
  } finally { if (oldFal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldFal; }
});
