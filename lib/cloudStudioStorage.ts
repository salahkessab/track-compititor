// Personal cloud storage. Local launchers retain their existing IndexedDB mode.
// A failed server request is surfaced, never silently forked into browser storage.
let capability: Promise<boolean>|undefined;
export function cloudStudioEnabled() {
  if (!capability) capability=fetch('/api/recipe-intelligence/capabilities',{cache:'no-store'}).then(async response=>{
    if(!response.ok)throw new Error('Could not connect to workspace storage. Please retry.');
    return (await response.json()).mode==='server';
  }).catch(error=>{capability=undefined;throw error;});
  return capability;
}
async function encode(value:any):Promise<any>{
  if(value instanceof Blob){const bytes=new Uint8Array(await value.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {$studioBlob:1,type:value.type,base64:btoa(binary)};}
  if(Array.isArray(value))return Promise.all(value.map(encode));
  if(value&&typeof value==='object')return Object.fromEntries(await Promise.all(Object.entries(value).map(async([k,v])=>[k,await encode(v)])));
  return value;
}
async function decode(value:any):Promise<any>{
  if(value?.$studioText===1){if(!/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('Invalid stored design reference.');const response=await fetch('/api/recipe-intelligence/studio/blob/'+value.sha256,{cache:'no-store'});if(!response.ok)throw new Error('Could not load a saved workspace design. Retry.');return response.text();}
  if(value?.$studioFile===1){if(!/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('Invalid stored image reference.');const response=await fetch('/api/recipe-intelligence/studio/blob/'+value.sha256,{cache:'no-store'});if(!response.ok)throw new Error('Could not load a saved workspace image. Retry.');return new Blob([await response.arrayBuffer()],{type:value.type});}
  if(Array.isArray(value))return Promise.all(value.map(decode));
  if(value&&typeof value==='object')return Object.fromEntries(await Promise.all(Object.entries(value).map(async([k,v])=>[k,await decode(v)])));
  return value;
}
export async function cloudStudio(action:string,namespace:string,store?:string,key?:IDBValidKey,value?:unknown,onlyIfMissing=false):Promise<any>{
  const response=await fetch('/api/recipe-intelligence/studio',{method:'POST',headers:{'Content-Type':'application/json','X-Recipe-Intelligence':'1'},body:JSON.stringify({action,namespace,store,key,...(value===undefined?{}:{value:await encode(value)}),onlyIfMissing})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Workspace storage is unavailable. Retry.');
  return decode(data);
}
const migrations=new Map<string,Promise<void>>();
export function importBrowserStudio(namespace:string,open:()=>Promise<IDBDatabase>,stores:string[]){
  if(!migrations.has(namespace))migrations.set(namespace,(async()=>{
    let db:IDBDatabase;try{db=await open();}catch{return;}// Browser storage may be disabled on a new device.
    try{for(const store of stores){
      const existing=new Set((await cloudStudio('keys',namespace,store)).keys.map((key:IDBValidKey)=>JSON.stringify(key)));
      const entries=await new Promise<{keys:IDBValidKey[];values:any[]}>((resolve,reject)=>{const tx=db.transaction(store),object=tx.objectStore(store),keys=object.getAllKeys(),values=object.getAll();tx.oncomplete=()=>resolve({keys:keys.result,values:values.result});tx.onerror=()=>reject(tx.error);});
      for(let i=0;i<entries.keys.length;i++)if(!existing.has(JSON.stringify(entries.keys[i])))await cloudStudio('save',namespace,store,entries.keys[i],entries.values[i],true);
    }}finally{db.close();}
  })().catch(error=>{migrations.delete(namespace);throw error;}));
  return migrations.get(namespace)!;
}
