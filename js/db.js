const DB_NAME = 'timetracker';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('projectId', 'projectId');
        store.createIndex('start', 'start');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function uuid() {
  return crypto.randomUUID();
}

class Store {
  constructor() {
    this._db = null;
  }

  async db() {
    if (!this._db) this._db = await openDB();
    return this._db;
  }

  async getAllProjects() {
    const db = await this.db();
    const t = tx(db, 'projects', 'readonly');
    return reqToPromise(t.objectStore('projects').getAll());
  }

  async putProject(project) {
    const db = await this.db();
    const t = tx(db, 'projects', 'readwrite');
    t.objectStore('projects').put(project);
    return new Promise((res, rej) => {
      t.oncomplete = () => res(project);
      t.onerror = () => rej(t.error);
    });
  }

  async deleteProject(id) {
    const db = await this.db();
    const t = tx(db, ['projects', 'entries'], 'readwrite');
    t.objectStore('projects').delete(id);
    const idx = t.objectStore('entries').index('projectId');
    const range = IDBKeyRange.only(id);
    idx.openCursor(range).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    return new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }

  async getAllEntries() {
    const db = await this.db();
    const t = tx(db, 'entries', 'readonly');
    return reqToPromise(t.objectStore('entries').getAll());
  }

  async getEntriesForProject(projectId) {
    const db = await this.db();
    const t = tx(db, 'entries', 'readonly');
    const idx = t.objectStore('entries').index('projectId');
    return reqToPromise(idx.getAll(IDBKeyRange.only(projectId)));
  }

  async putEntry(entry) {
    const db = await this.db();
    const t = tx(db, 'entries', 'readwrite');
    t.objectStore('entries').put(entry);
    return new Promise((res, rej) => {
      t.oncomplete = () => res(entry);
      t.onerror = () => rej(t.error);
    });
  }

  async deleteEntry(id) {
    const db = await this.db();
    const t = tx(db, 'entries', 'readwrite');
    t.objectStore('entries').delete(id);
    return new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }

  async getMeta(key) {
    const db = await this.db();
    const t = tx(db, 'meta', 'readonly');
    const row = await reqToPromise(t.objectStore('meta').get(key));
    return row ? row.value : undefined;
  }

  async setMeta(key, value) {
    const db = await this.db();
    const t = tx(db, 'meta', 'readwrite');
    t.objectStore('meta').put({ key, value });
    return new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
}

export const store = new Store();
