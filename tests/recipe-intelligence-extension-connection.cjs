const test=require('node:test'),assert=require('node:assert/strict');
const {appOrigin,createConnection}=require('../extensions/recipe-intelligence-capture/connection.js');
const {appBridge}=require('../extensions/recipe-intelligence-capture/shared.js');
const first='http://127.0.0.1:55543',second='http://127.0.0.1:55544';
function fixture({tabs=[{id:1,url:first}],saved,sessions={[first]:{ready:true,root:'E:\\Recipes'}}}={}) {
  const storage=saved?{recipeIntelligenceConnection:saved}:{},calls=[],created=[],updates=[],windows=[];
  const browser={
    storage:{local:{get:async()=>structuredClone(storage),set:async value=>Object.assign(storage,structuredClone(value))}},
    tabs:{query:async()=>tabs,get:async id=>{const tab=tabs.find(t=>t.id===id);if(!tab)throw Error('Closed tab');return tab;},
      create:async details=>{const tab={...details,id:100+created.length,windowId:7};tabs.push(tab);created.push(details);return tab;},
      update:async(id,details)=>{updates.push({id,...details});return {id,windowId:7};}},
    windows:{get:async()=>({state:'minimized'}),update:async(id,details)=>windows.push({id,...details})},
    scripting:{executeScript:async options=>{
      calls.push(options);assert.equal(options.world,'ISOLATED');assert.equal(options.func,appBridge);
      const tab=tabs.find(t=>t.id===options.target.tabId);if(!tab)throw Error('Closed tab');
      assert.equal(appOrigin(tab.url),options.args[0].origin);
      return [{result:sessions[options.args[0].origin]||{error:'Offline',status:503}}];
    }}
  };
  return {connection:createConnection(browser,appBridge,async()=>{}),storage,calls,created,updates,windows,tabs,sessions};
}
test('connection accepts HTTPS or loopback app addresses and never stores pasted launch secrets',async()=>{
  assert.equal(appOrigin(first+'/?tab=recipe-intelligence#ri-token=private'),first);
  assert.equal(appOrigin('https://app.example/path?secret=x#key'),'https://app.example');
  for(const value of ['http://example.com','https://user:secret@example.com','https://192.168.1.1','http://127.0.0.1.evil.example','http://user:secret@127.0.0.1','http://192.168.1.1','file:///C:/data','not a URL']) assert.throws(()=>appOrigin(value));
  const f=fixture({tabs:[{id:1,url:first+'/?key=secret#ri-token=private'}]});
  const app=await f.connection.connect();assert.equal(app.root,'E:\\Recipes');
  assert.deepEqual(f.storage,{recipeIntelligenceConnection:{origin:first,root:'E:\\Recipes'}});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[0].op,'probe');
});
test('closed app tab reopens the remembered address once and reuses the existing browser session',async()=>{
  const f=fixture({tabs:[],saved:{origin:first,root:'E:\\Recipes'}});
  const target=await f.connection.connect();await f.connection.connect();
  assert.deepEqual(f.created,[{url:first+'/?tab=recipe-intelligence',active:false}]);
  await f.connection.focus(target);
  assert.equal(f.updates[0].id,target.id);assert.equal(f.created.length,1);
  assert.deepEqual(f.windows,[{id:7,focused:true,state:'normal'}]);
});
test('changed launcher port is recovered from an open tab for the same storage folder',async()=>{
  const f=fixture({saved:{origin:first,root:'E:\\Recipes'},tabs:[{id:2,url:second}],sessions:{[second]:{ready:true,root:'E:\\Recipes'}}});
  const target=await f.connection.connect();assert.equal(target.origin,second);
  assert.equal(f.storage.recipeIntelligenceConnection.origin,second);assert.equal(f.created.length,0);
});
test('multiple workspaces require an explicit choice before remembering a destination',async()=>{
  const f=fixture({tabs:[{id:1,url:first},{id:2,url:second}],sessions:{[first]:{ready:true,root:'E:\\Recipes'},[second]:{ready:true,root:'F:\\Recipes'}}});
  await assert.rejects(f.connection.connect(),error=>error.targets.length===2);
  assert.deepEqual(f.storage,{});
  const target=await f.connection.connect({origin:second});assert.equal(target.root,'F:\\Recipes');
  assert.equal((await f.connection.connect()).origin,second);
});
test('an interrupted capture cannot switch folders even when the saved port now serves another workspace',async()=>{
  const f=fixture({saved:{origin:first,root:'E:\\Recipes'},sessions:{[first]:{ready:true,root:'F:\\Other'}}});
  await assert.rejects(f.connection.connect({root:'E:\\Recipes'}),/different storage folder/);
  assert.equal(f.created.length,0);assert.equal(f.storage.recipeIntelligenceConnection.root,'E:\\Recipes');
  await assert.rejects(f.connection.connect({origin:first,root:'E:\\Recipes'}),/different storage folder/);
});
test('expired sessions request launcher reconnection without repeating authentication or transferring a capture',async()=>{
  const f=fixture({sessions:{[first]:{error:'Authentication required',status:401}}});
  await assert.rejects(f.connection.connect(),/session expired.*desktop shortcut/);
  assert.equal(f.calls.length,1);assert.ok(f.calls.every(c=>c.args[0].op==='probe'));
  assert.deepEqual(f.storage,{});
});
test('offline reconnection attempts are bounded and do not discard remembered settings',async()=>{
  const f=fixture({tabs:[],saved:{origin:first,root:'E:\\Recipes'},sessions:{}});
  await assert.rejects(f.connection.connect(),/Start Recipe Intelligence.*capture is saved/);
  assert.equal(f.calls.length,8);assert.equal(f.created.length,1);
  assert.equal(f.storage.recipeIntelligenceConnection.origin,first);
});
test('opening a result does not replace a repurposed tab or navigate outside the connected app',async()=>{
  const f=fixture();const app=await f.connection.connect();f.tabs[0].url='https://food.example/recipe';
  await f.connection.focus(app);assert.equal(f.updates.length,0);assert.equal(f.created.length,1);
  await assert.rejects(f.connection.focus(app,second+'/'),/destination does not match/);
  await assert.rejects(f.connection.focus(app,'https://evil.example/'));
});
test('cloud connection remembers the server workspace and does not probe unrelated HTTPS tabs',async()=>{
  const cloud='https://recipes.example', f=fixture({tabs:[{id:1,url:cloud+'/?tab=recipe-intelligence'},{id:2,url:'https://unrelated.example'}],sessions:{[cloud]:{ready:true,root:'workspace:persistent-id'}}});
  const connected=await f.connection.connect();assert.equal(connected.origin,cloud);assert.equal(f.calls.length,1);assert.equal(f.calls[0].target.tabId,1);
  f.tabs.splice(0,1);await f.connection.connect();assert.equal(f.created.length,1);assert.equal(f.created[0].url,cloud+'/?tab=recipe-intelligence');
  assert.deepEqual(f.storage.recipeIntelligenceConnection,{origin:cloud,root:'workspace:persistent-id'});
});
