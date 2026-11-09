// Offline Storage & Queue for GTD Companion using IndexedDB

export interface QueuedItem {
  id: string;
  type: 'text' | 'audio';
  content?: string;       // for text
  blob?: Blob;           // for audio
  mimeType?: string;
  timestamp: number;
  retries: number;
}

const DB_NAME = "BrainCompanionDB";
const STORE_NAME = "offlineQueue";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e: any) => {
      const db = e.target.result as IDBDatabase;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOfflineTask(item: Omit<QueuedItem, "id" | "timestamp" | "retries"> & { id?: string }): Promise<QueuedItem> {
  const db = await openDB();
  const queued: QueuedItem = {
    id: item.id || `offline_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: item.type,
    content: item.content,
    blob: item.blob,
    mimeType: item.mimeType,
    timestamp: Date.now(),
    retries: 0
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(queued);
    req.onsuccess = () => resolve(queued);
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflineTasks(): Promise<QueuedItem[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to read offline tasks:", err);
    return [];
  }
}

export async function removeOfflineTask(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function countOfflineTasks(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}
