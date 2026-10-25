// Minimal key/value cache on IndexedDB for Overpass responses (too big for localStorage).
const DB = 'streetwise';
const STORE = 'cache';
const MAX_ENTRIES = 60;

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function cacheGet(key, maxAgeMs) {
  try {
    const db = await open();
    const entry = await wrap(db.transaction(STORE).objectStore(STORE).get(key));
    if (entry && Date.now() - entry.t < maxAgeMs) return entry.v;
  } catch {
    /* private mode etc. - run uncached */
  }
  return null;
}

export async function cacheSet(key, value) {
  try {
    const db = await open();
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    store.put({ t: Date.now(), v: value }, key);
    const keys = await wrap(db.transaction(STORE).objectStore(STORE).getAllKeys());
    if (keys.length > MAX_ENTRIES) {
      const all = await Promise.all(
        keys.map(async (k) => [k, (await wrap(db.transaction(STORE).objectStore(STORE).get(k)))?.t ?? 0]),
      );
      all.sort((a, b) => a[1] - b[1]);
      const tx = db.transaction(STORE, 'readwrite').objectStore(STORE);
      for (const [k] of all.slice(0, all.length - MAX_ENTRIES)) tx.delete(k);
    }
  } catch {
    /* ignore */
  }
}
