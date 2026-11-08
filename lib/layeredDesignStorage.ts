// Separate browser-local storage keeps the existing Recipe Designs history unchanged.
const DATABASE = "horse-studio-layered-designs-v1";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("history", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser storage is unavailable."));
  });
}

export async function listLayeredDesigns<T>(): Promise<T[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("history").objectStore("history").getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error || new Error("Could not load design history."));
    });
  } finally { db.close(); }
}

export async function saveLayeredDesign<T extends { id: string }>(record: T): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("history", "readwrite");
      transaction.objectStore("history").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save the design."));
      transaction.onabort = () => reject(transaction.error || new Error("Could not save the design."));
    });
  } finally { db.close(); }
}
