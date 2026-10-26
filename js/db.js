// IndexedDB storage. Everything stays in this browser on this device.
//   entries: one record per day, keyed by "YYYY-MM-DD"
//   images:  compressed photos, referenced from entries by id
//   kv:      profile and settings
const DB_NAME = 'intern-diary';
const STORES = ['entries', 'images', 'kv'];

let dbPromise;
function open() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('entries', { keyPath: 'date' });
      db.createObjectStore('images', { keyPath: 'id' });
      db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function run(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const allEntries = () => run('entries', 'readonly', s => s.getAll());
export const putEntry = entry => run('entries', 'readwrite', s => s.put(entry));
export const getImage = id => run('images', 'readonly', s => s.get(id));
export const putImage = img => run('images', 'readwrite', s => s.put(img));
export const deleteImage = id => run('images', 'readwrite', s => s.delete(id));
export const allImages = () => run('images', 'readonly', s => s.getAll());
export const getKV = key => run('kv', 'readonly', s => s.get(key));
export const setKV = (key, value) => run('kv', 'readwrite', s => s.put(value, key));

async function rewrite(fill) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    STORES.forEach(n => tx.objectStore(n).clear());
    fill?.(tx);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const clearAll = () => rewrite();

// Replaces everything with the contents of a backup file, in one transaction.
export function restore({ profile, settings, entries, images }) {
  return rewrite(tx => {
    entries.forEach(e => tx.objectStore('entries').put(e));
    (images || []).forEach(i => tx.objectStore('images').put(i));
    if (profile) tx.objectStore('kv').put(profile, 'profile');
    if (settings) tx.objectStore('kv').put(settings, 'settings');
  });
}
