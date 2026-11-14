const test = require('node:test');
const { imageAssetFetch, assetUrl } = require('./helpers/image-asset-fetch.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');

function loadComponent(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const moduleRecord = { exports: {} }; cache.set(file, moduleRecord);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = id => {
    if (id === './OpenAIImageControls') return { OpenAIImageControls: () => null };
    if (id === './ImageFilterStudio') return { ImageFilterStudio: ({ source, fileName, onClose }) => React.createElement('div', { 'data-filter-source': source, 'data-filter-name': fileName }, React.createElement('button', { onClick: onClose }, 'Close filter')) };
    if (id.startsWith('@/')) return loadComponent(path.resolve(__dirname, '..', id.slice(2) + '.ts'), cache);
    if (id.startsWith('.')) {
      const base = path.resolve(path.dirname(file), id);
      return loadComponent(fs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts', cache);
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', source)(localRequire, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

test('Image to Image accepts and replaces a dropped photo, validates files, and keeps browse available', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Image', 'FileReader', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, FileReader: dom.window.FileReader, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  globalThis.Image = class {
    constructor() { this.width = 640; this.height = 480; }
    set src(_value) { queueMicrotask(() => this.onload()); }
  };
  dom.window.HTMLDialogElement.prototype.close = function () {};
  const { createRoot } = require('react-dom/client');
  const { RecipeImageToImage } = loadComponent(path.resolve(__dirname, '../app/components/RecipeImageToImage.tsx'));
  const root = createRoot(document.getElementById('root'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 25));
  async function waitForPreparation() {
    const deadline = Date.now() + 5000;
    while (document.body.textContent.includes('Preparing photo') && Date.now() < deadline) {
      await React.act(async () => { await settle(); });
    }
    assert.doesNotMatch(document.body.textContent, /Preparing photo/, 'photo preparation completes');
  }
  const dragEvent = (type, files = []) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files, dropEffect: 'none' } });
    return event;
  };
  const setInstructions = value => {
    const area = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(area, value);
    area.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  try {
    await React.act(async () => root.render(React.createElement(RecipeImageToImage)));
    await React.act(async () => setInstructions('Instructions for the first photo'));
    const zone = document.querySelector('[aria-label="Drop a food photo here, or click to browse"]');
    assert.ok(zone);
    const enter = dragEvent('dragenter');
    const over = dragEvent('dragover');
    await React.act(async () => { zone.dispatchEvent(enter); zone.dispatchEvent(over); });
    assert.equal(over.defaultPrevented, true);
    assert.equal(over.dataTransfer.dropEffect, 'copy');
    assert.match(zone.className, /ring-2/);

    const first = new dom.window.File(['image data'], 'soup.png', { type: 'image/png' });
    const drop = dragEvent('drop', [first]);
    await React.act(async () => { zone.dispatchEvent(drop); await settle(); });
    await waitForPreparation();
    assert.equal(drop.defaultPrevented, true);
    assert.ok(document.querySelector('img[alt="Original uploaded food"]'));
    assert.match(document.body.textContent, /soup\.png/);
    assert.equal(document.querySelector('textarea').value, 'Instructions for the first photo');
    assert.equal([...document.querySelectorAll('button')].find(button => button.textContent === 'Generate').disabled, false);

    const second = new dom.window.File(['another image'], 'salad.jpg', { type: 'image/jpeg' });
    await React.act(async () => { zone.dispatchEvent(dragEvent('drop', [second])); await settle(); });
    await waitForPreparation();
    assert.match(document.body.textContent, /salad\.jpg/);
    assert.doesNotMatch(document.body.textContent, /soup\.png/);
    assert.equal(document.querySelector('textarea').value, '');

    const wrongFile = new dom.window.File(['not an image'], 'notes.txt', { type: 'text/plain' });
    await React.act(async () => setInstructions('Keep this if the upload fails'));
    await React.act(async () => { zone.dispatchEvent(dragEvent('drop', [wrongFile])); await settle(); });
    assert.match(document.querySelector('[role="alert"]').textContent, /Choose a JPG, PNG, or WebP/);
    assert.match(document.body.textContent, /salad\.jpg/);
    assert.equal(document.querySelector('textarea').value, 'Keep this if the upload fails');
    await React.act(async () => zone.dispatchEvent(dragEvent('drop', [first, second])));
    assert.match(document.querySelector('[role="alert"]').textContent, /one JPG, PNG, or WebP/);

    const picker = document.querySelector('input[type="file"]');
    let pickerClicks = 0;
    picker.addEventListener('click', event => { event.preventDefault(); pickerClicks++; });
    await React.act(async () => {
      zone.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      zone.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert.equal(pickerClicks, 2);
    Object.defineProperty(picker, 'files', { configurable: true, value: [first] });
    await React.act(async () => { picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await settle(); });
    await waitForPreparation();
    assert.equal(document.querySelector('textarea').value, '', 'Browse Files also resets instructions after a successful replacement');
    await React.act(async () => setInstructions('Remove the photo'));
    await React.act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Remove photo').click());
    assert.equal(document.querySelector('textarea').value, '');
    await React.act(async () => setInstructions('Instructions before uploading again'));
    await React.act(async () => { zone.dispatchEvent(dragEvent('drop', [first])); await settle(); });
    await waitForPreparation();
    assert.equal(document.querySelector('textarea').value, 'Instructions before uploading again');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const name of globals) {
      if (originals[name]) Object.defineProperty(globalThis, name, originals[name]);
      else delete globalThis[name];
    }
  }
});

test('Image to Image previews each completed variation and targets its download and filter', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Image', 'File', 'FileReader', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, File: require('node:buffer').File, FileReader: dom.window.FileReader, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  globalThis.Image = class { constructor() { this.width = 640; this.height = 480; } set src(_value) { queueMicrotask(() => this.onload()); } };
  dom.window.HTMLDialogElement.prototype.close = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () {};
  dom.window.matchMedia = () => ({ matches: true });
  const downloads = [];
  dom.window.navigator.canShare = () => true;
  dom.window.navigator.share = async ({ files }) => { downloads.push(files[0]); };
  const urls = ['data:image/png;base64,Zmlyc3Q=', 'data:image/png;base64,c2Vjb25k'];
  const requests = [];
  let finishSecond;
  const makeResult = imageUrl => ({ imageUrl, imageModel: 'gpt-image-2.6-sunburst', imageSettings: { output_format: 'png' }, cost: 0.05, imageCost: 0.05, costIncomplete: false });
  globalThis.fetch = imageAssetFetch(async (url, init) => {
    if (url !== '/api/generate') return new Response('selected image', { headers: { 'content-type': 'image/png' } });
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) return Response.json(makeResult(urls[0]));
    return new Response(new ReadableStream({ start(controller) {
      const encode = event => new TextEncoder().encode(JSON.stringify(event) + '\n');
      controller.enqueue(encode({ type: 'partial', imageUrl: 'data:image/png;base64,cHJldmlldw==' }));
      finishSecond = () => { controller.enqueue(encode({ type: 'result', data: makeResult(urls[1]) })); controller.close(); };
    } }), { headers: { 'content-type': 'application/x-ndjson' } });
  });
  const { createRoot } = require('react-dom/client');
  const { RecipeImageToImage } = loadComponent(path.resolve(__dirname, '../app/components/RecipeImageToImage.tsx'));
  const root = createRoot(document.getElementById('root'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 50));
  try {
    await React.act(async () => root.render(React.createElement(RecipeImageToImage)));
    const panel = document.querySelector('[aria-label="Food photo variations"]');
    assert.match(panel.textContent, /Your generated image will appear here/);
    const zone = document.querySelector('[aria-label="Drop a food photo here, or click to browse"]');
    const drop = new dom.window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new dom.window.File(['food'], 'food.png', { type: 'image/png' })], dropEffect: 'none' } });
    await React.act(async () => { zone.dispatchEvent(drop); await settle(); });
    const count = document.querySelector('input[type="number"]');
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(count, '2');
      count.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await React.act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === 'Generate').click(); await settle(); });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].references[0], requests[1].references[0]);
    await React.act(async()=>{await settle();});
    assert.ok(panel.querySelector('img[alt="Realistic variation 1 of the uploaded dish"]'),panel.textContent);
    assert.equal(panel.querySelector('img[alt="Food variation in progress"]'), null, 'unverified partial images stay hidden');
    assert.match(panel.textContent, /1 of 2 variations ready/);
    await React.act(async () => { finishSecond(); await settle(); });
    assert.equal(panel.querySelectorAll('button[aria-label^="Select variation"]').length, 2);
    await React.act(async () => panel.querySelector('[aria-label="Select variation 2"]').click());
    assert.equal(panel.querySelector('img[alt="Realistic variation 2 of the uploaded dish"]').getAttribute('src'), assetUrl(Buffer.from('second')));
    assert.equal(panel.querySelector('[aria-label="Select variation 2"]').getAttribute('aria-pressed'), 'true');
    await React.act(async () => panel.querySelector('[aria-label="Open variation 2"]').click());
    assert.equal(document.querySelector('img[alt="Enlarged food photo variation"]').getAttribute('src'), assetUrl(Buffer.from('second')));
    await React.act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Close image preview').click());
    await React.act(async () => [...panel.querySelectorAll('button')].find(button => button.textContent === 'Add Filter').click());
    assert.equal(document.querySelector('[data-filter-source]').getAttribute('data-filter-source'), urls[1]);
    assert.equal(document.querySelector('[data-filter-name]').getAttribute('data-filter-name'), 'recipe-variation-2');
    await React.act(async () => document.querySelector('[data-filter-source] button').click());
    await React.act(async () => { [...panel.querySelectorAll('button')].find(button => button.textContent.startsWith('Download Original')).click(); await settle(); });
    assert.equal(downloads[0].name, 'recipe-variation-2.png');
    await React.act(async () => { zone.dispatchEvent(drop); await settle(); });
    assert.match(panel.textContent, /Your generated image will appear here/);
  } finally {
    await React.act(async () => root.unmount()); dom.window.close();
    for (const name of globals) {
      if (originals[name]) Object.defineProperty(globalThis, name, originals[name]);
      else delete globalThis[name];
    }
  }
});

test('2 in one image accepts two files together and sends both in one request', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Image', 'FileReader', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, FileReader: dom.window.FileReader, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  globalThis.Image = class { constructor() { this.width = 640; this.height = 480; } set src(_value) { queueMicrotask(() => this.onload()); } };
  const requests=[];
  globalThis.fetch=imageAssetFetch(async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return Response.json({imageUrl:'data:image/png;base64,aW1hZ2U=',imageModel:'gpt-image-2.6-sunburst',imageSettings:{output_format:'png'},cost:0.05,imageCost:0.05,costIncomplete:false});});
  const {createRoot}=require('react-dom/client');
  const {RecipeTwoInOne}=loadComponent(path.resolve(__dirname,'../app/components/RecipeTwoInOne.tsx'));
  const root=createRoot(document.getElementById('root'));
  const settle=()=>new Promise(resolve=>setTimeout(resolve,50));
  const drop=(files)=>{const event=new dom.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files,dropEffect:'none'}});return event;};
  const setInstructions=value=>{const area=document.querySelector('textarea');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(area,value);area.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  try {
    await React.act(async()=>root.render(React.createElement(RecipeTwoInOne)));
    const generate=()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Generate one image');
    assert.equal(generate().disabled,true);
    const zone=document.querySelector('[aria-label="Drop food photo 1 here or click to browse"]');
    await React.act(async()=>zone.dispatchEvent(drop([])));
    assert.match(document.querySelector('[role="alert"]').textContent,/Drop one or two JPG/);
    const first=new dom.window.File(['first-food'],'first.png',{type:'image/png'});
    const second=new dom.window.File(['second-food'],'second.jpg',{type:'image/jpeg'});
    await React.act(async()=>setInstructions('Instructions for the first pair'));
    await React.act(async()=>{zone.dispatchEvent(drop([first,second]));await settle();});
    assert.ok(document.querySelector('img[alt="Original food photo 1"]'));
    assert.ok(document.querySelector('img[alt="Original food photo 2"]'));
    assert.match(document.body.textContent,/first\.png/);assert.match(document.body.textContent,/second\.jpg/);
    assert.equal(document.querySelector('textarea').value,'Instructions for the first pair');
    assert.equal(generate().disabled,false);
    await React.act(async()=>{generate().click();await settle();});
    assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/generate');
    assert.equal(requests[0].body.recipeWorkflow,'twoInOne');assert.equal(requests[0].body.references.length,2);
    assert.equal(requests[0].body.references[0],'data:image/png;base64,Zmlyc3QtZm9vZA==');
    assert.equal(requests[0].body.references[1],'data:image/jpeg;base64,c2Vjb25kLWZvb2Q=');
    assert.equal(requests[0].body.extraInstructions,'Instructions for the first pair');
    assert.ok(document.querySelector('img[alt="Food photo combining both references"]'));
    const bad=new dom.window.File(['invalid'],'notes.txt',{type:'text/plain'});
    await React.act(async()=>{zone.dispatchEvent(drop([bad]));await settle();});
    assert.match(document.querySelector('[role="alert"]').textContent,/Choose a JPG, PNG, or WebP/);
    assert.equal(document.querySelector('textarea').value,'Instructions for the first pair');
    assert.ok(document.querySelector('img[alt="Food photo combining both references"]'));
    const third=new dom.window.File(['third-food'],'third.png',{type:'image/png'});
    const picker=document.querySelector('input[aria-label="Upload food photo 1"]');
    Object.defineProperty(picker,'files',{configurable:true,value:[third]});
    await React.act(async()=>{picker.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await settle();});
    assert.equal(document.querySelector('textarea').value,'');
    assert.equal(document.querySelector('img[alt="Food photo combining both references"]'),null);
    assert.match(document.body.textContent,/third\.png/);assert.match(document.body.textContent,/second\.jpg/);
    assert.equal(generate().disabled,false,'replacing photo 1 keeps photo 2');
    await React.act(async()=>setInstructions('Old instruction before removing photo 2'));
    const zone2=document.querySelector('[aria-label="Drop food photo 2 here or click to browse"]');
    await React.act(async()=>{zone2.parentElement.querySelector('button').click();});
    assert.equal(document.querySelector('textarea').value,'');
    assert.equal(generate().disabled,true);
    await React.act(async()=>setInstructions('Instructions for the new pair'));
    await React.act(async()=>{zone2.dispatchEvent(drop([second]));await settle();});
    assert.equal(document.querySelector('textarea').value,'Instructions for the new pair','adding the missing second photo keeps new instructions');
    assert.equal(generate().disabled,false);
    await React.act(async()=>{zone.dispatchEvent(drop([first,second]));await settle();});
    assert.equal(document.querySelector('textarea').value,'','replacing both photos clears the previous instructions');
    assert.equal(requests.length,1,'changing photos never sends an additional request');
  } finally {
    await React.act(async()=>root.unmount());dom.window.close();
    for(const name of globals){if(originals[name])Object.defineProperty(globalThis,name,originals[name]);else delete globalThis[name];}
  }
});

test('two-photo preparation shrinks a large image to the request budget without cropping', async () => {
  const dom=new JSDOM('<!doctype html>',{url:'http://localhost/'});
  const globals=['window','document','Image','FileReader'];
  const originals=Object.fromEntries(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.FileReader=dom.window.FileReader;
  globalThis.Image=class {constructor(){this.width=4000;this.height=3000;}set src(_value){queueMicrotask(()=>this.onload());}};
  let lastSize;
  dom.window.HTMLCanvasElement.prototype.getContext=function(){return {fillRect(){},drawImage(){}};};
  dom.window.HTMLCanvasElement.prototype.toDataURL=function(){lastSize=[this.width,this.height];return 'data:image/jpeg;base64,'+'A'.repeat(this.width*this.height);};
  try {
    const {prepareFoodPhoto}=loadComponent(path.resolve(__dirname,'../lib/recipeFoodPhoto.ts'));
    const photo=await prepareFoodPhoto(new dom.window.File(['photo'],'large.jpg',{type:'image/jpeg'}),1_800_000);
    assert.ok(photo.dataUrl.length<=1_800_000);assert.ok(lastSize[0]<2048);
    assert.ok(Math.abs(lastSize[0]/lastSize[1]-4/3)<0.01);
  } finally {dom.window.close();for(const name of globals){if(originals[name])Object.defineProperty(globalThis,name,originals[name]);else delete globalThis[name];}}
});
