// IndexedDB の薄いラッパー
// v1: sessions / v2: exercises（種目マスタ）と meta（設定）を追加
const DB = (() => {
  const DB_NAME = 'workout-log';
  const DB_VERSION = 2;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('exercises')) db.createObjectStore('exercises', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function req(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  // stores を開いたトランザクションで fn を実行し、完了後に fn の戻り値を返す。
  // fn 内で await してよいのは IDB リクエスト（req）のみ。
  function run(stores, mode, fn) {
    const names = [].concat(stores);
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(names, mode);
      const s = {};
      names.forEach((n) => { s[n] = t.objectStore(n); });
      let result;
      Promise.resolve(fn(s)).then((r) => { result = r; }, (e) => {
        try { t.abort(); } catch (_) { /* already finished */ }
        reject(e);
      });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    }));
  }

  return {
    req,
    run,
    getAll: (store) => run(store, 'readonly', (s) => req(s[store].getAll())),
    get: (store, key) => run(store, 'readonly', (s) => req(s[store].get(key))),
    put: (store, value) => run(store, 'readwrite', (s) => { s[store].put(value); }),
    remove: (store, key) => run(store, 'readwrite', (s) => { s[store].delete(key); }),
  };
})();
