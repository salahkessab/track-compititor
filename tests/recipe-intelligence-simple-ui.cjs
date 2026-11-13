const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');
const { DEFAULT_CONTENT_SETTINGS } = require('../.intelligence-build/lib/recipe-intelligence/settings.js');

async function screen(t, request) {
  const dom = new JSDOM('<div id="root"></div>', {url:'http://127.0.0.1:34567/?tab=recipe-intelligence&view=start'});
  const globals = {window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
  const before = Object.fromEntries(Object.keys(globals).map(k => [k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for (const [k,v] of Object.entries(globals)) Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});
  const mod = {exports:require('./helpers/load-component.cjs')('RecipeImports')};
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  const created = [];
  await React.act(async () => root.render(React.createElement(mod.exports.StartRecipe,{snapshot:{imports:[]},settings:DEFAULT_CONTENT_SETTINGS,change:()=>{},controls:React.createElement('span',null,'Optional controls'),request,created:b=>created.push(b)})));
  t.after(async()=>{await React.act(async()=>root.unmount());dom.window.close();for(const k of Object.keys(globals)){if(before[k])Object.defineProperty(globalThis,k,before[k]);else delete globalThis[k];}});
  const set = async(selector,value) => {const element=document.querySelector(selector);assert.ok(element);await React.act(async()=>{const proto=element.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}));element.dispatchEvent(new window.Event('change',{bubbles:true}));});};
  const click=async(text)=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);await React.act(async()=>button.click());};
  return {set,click,created};
}

test('paste URL prepares a batch for photo review without selecting photos or approving charges', async t => {
  const calls=[];
  const imported={id:'ready-recipe',status:'ready',title:'Soup',revision:1,photos:[{id:'p1',state:'ready',selected:1}]};
  const batch={id:'ready-batch',quote:{estimated:0,recommendedLimit:0,pending:1}};
  const ui=await screen(t,async(route,method='GET',data)=>{calls.push({route,method,data});if(route==='imports')return imported;if(route==='imports/ready-recipe')return imported;if(route==='imports/ready-recipe/estimate')return batch;throw new Error(route);});
  await ui.set('input[type=url]','https://food.example/soup/');
  await ui.click('Get estimate');
  assert.equal(ui.created[0]?.id,'ready-batch');
  assert.equal(ui.created[0]?.quote.pending,1);
  assert.equal(calls.find(c=>c.route==='imports').data.url,'https://food.example/soup/');
  assert.equal(calls.filter(c=>c.route.endsWith('/estimate')).length,1);
  assert.ok(calls.every(c=>!c.route.includes('/approve')&&!c.route.includes('/selection')));
});

test('blocked URL shows the actual failure and offers text fallback without creating a quote', async t => {
  const calls=[];
  const ui=await screen(t,async(route,method='GET',data)=>{calls.push({route,method,data});return {id:'blocked',status:'failed',error:'This website blocks automatic access. Paste the recipe text below or use another recipe URL.',title:'Blocked source',revision:0,photos:[]};});
  await ui.set('input[type=url]','https://food.example/blocked/');
  await ui.click('Get estimate');
  assert.match(document.body.textContent,/blocks automatic access/);
  assert.ok(document.querySelector('textarea[aria-label="Recipe text"]'));
  assert.equal(ui.created.length,0);
  assert.ok(calls.every(c=>!c.route.includes('/estimate')&&!c.route.includes('/approve')));
  assert.doesNotMatch(document.body.textContent,/\$0\.0000/);
});
