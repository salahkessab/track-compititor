import { cloudStudioEnabled, cloudStudio, importBrowserStudio } from './cloudStudioStorage';
// Cloud deployments use the owner's persistent server; local mode keeps IndexedDB.
const DATABASE = "horse-studio-recipe-designs-v1";
type Store = "settings" | "assets" | "research" | "jobs" | "history" | "locks";
async function remote(){if(!await cloudStudioEnabled())return false;await importBrowserStudio('recipe-designs',database,['settings','assets','research','jobs','history']);return true;}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      for (const name of ["settings", "assets", "research", "jobs", "history", "locks"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Private browser storage is unavailable."));
  });
}
export async function claimPaidJob(id: string): Promise<boolean> {
  if(await remote())return (await cloudStudio('claim','recipe-designs',undefined,id)).claimed;
  const db=await database();
  try {
    return await new Promise<boolean>((resolve,reject)=>{
      const tx=db.transaction("locks","readwrite");const store=tx.objectStore("locks");const lookup=store.get("active");let claimed=false;
      lookup.onsuccess=()=>{if(!lookup.result){store.add({id,createdAt:new Date().toISOString()},"active");claimed=true;}};
      tx.oncomplete=()=>resolve(claimed);tx.onerror=()=>reject(tx.error || new Error("Could not reserve this job."));tx.onabort=()=>reject(tx.error || new Error("Could not reserve this job."));
    });
  } finally {db.close();}
}
export async function releasePaidJob(id: string): Promise<void> {
  if(await remote()){await cloudStudio('release','recipe-designs',undefined,id);return;}
  const db=await database();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction("locks","readwrite");const store=tx.objectStore("locks");const lookup=store.get("active");
      lookup.onsuccess=()=>{if(lookup.result?.id===id)store.delete("active");};
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error || new Error("Could not release the job."));
    });
  } finally {db.close();}
}
export async function saveLocal(store: Store, key: IDBValidKey, value: unknown): Promise<void> {
  if(await remote()){await cloudStudio('save','recipe-designs',store,key,value);return;}
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save to private browser storage."));
      tx.onabort = () => reject(tx.error || new Error("Private browser storage is full or unavailable."));
    });
  } finally { db.close(); }
}
export async function loadLocal<T>(store: Store, key: IDBValidKey): Promise<T | undefined> {
  if(await remote())return (await cloudStudio('get','recipe-designs',store,key)).value??undefined;
  const db = await database();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function listLocal<T>(store: Store): Promise<T[]> {
  if(await remote())return (await cloudStudio('list','recipe-designs',store)).entries.map((entry:any)=>entry.value);
  const db = await database();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function removeLocal(store: Store, key: IDBValidKey): Promise<void> {
  if(await remote()){await cloudStudio('remove','recipe-designs',store,key);return;}
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite"); tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
