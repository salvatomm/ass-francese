// Tiny IndexedDB wrapper. Everything the learner does is written here first (works offline).
const STORES = { progress: 'ex_id', attempts: 'id', outbox: null, kv: 'k', agentEx: 'id', reports: 'id' };
let dbp;

function open() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('francese', 1);
    r.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(STORES))
        if (!r.result.objectStoreNames.contains(name))
          r.result.createObjectStore(name, keyPath ? { keyPath } : { autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const done = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function tx(stores, mode, fn) {
  const t = (await open()).transaction(stores, mode);
  const out = fn(...[].concat(stores).map(s => t.objectStore(s)));
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
  return out instanceof IDBRequest ? out.result : out;
}

export const getAll = store => tx(store, 'readonly', s => s.getAll());
export const get = (store, key) => tx(store, 'readonly', s => s.get(key));
export const put = (store, value) => tx(store, 'readwrite', s => { s.put(value); });
export const putMany = (store, values) => tx(store, 'readwrite', s => { values.forEach(v => s.put(v)); });
export const clear = store => tx(store, 'readwrite', s => { s.clear(); });

export const kvGet = async (k, dflt) => (await get('kv', k))?.v ?? dflt;
export const kvSet = (k, v) => put('kv', { k, v });

/** Atomically record a change locally and queue it for the server. */
export function record(changes) {
  // changes: [{store, value, table?, row?}] — table/row go to the outbox for Supabase
  const stores = [...new Set([...changes.map(c => c.store), 'outbox'])];
  return tx(stores, 'readwrite', (...os) => {
    const by = Object.fromEntries(stores.map((n, i) => [n, os[i]]));
    for (const c of changes) {
      by[c.store].put(c.value);
      if (c.table) by.outbox.add({ table: c.table, row: c.row ?? c.value });
    }
  });
}

/** Outbox entries with their auto-increment keys. */
export async function outbox() {
  return tx('outbox', 'readonly', s => {
    const out = [];
    s.openCursor().onsuccess = e => {
      const c = e.target.result;
      if (c) { out.push({ key: c.key, ...c.value }); c.continue(); }
    };
    return out;
  });
}
export const dropOutbox = keys => tx('outbox', 'readwrite', s => { keys.forEach(k => s.delete(k)); });
