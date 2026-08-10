// Local storage layer, built on IndexedDB — the browser's built-in
// database for storing structured data offline. Everything here wraps
// IndexedDB's old-school, callback/event-based API in Promises so the
// rest of the app can just `await store.getAllProjects()` etc.

const DB_NAME = 'timetracker';
const DB_VERSION = 1; // bump this + add an onupgradeneeded branch if the schema ever changes

// Opens (or creates) the database and returns a Promise of the connection.
// `onupgradeneeded` only fires the very first time a browser opens this
// DB_NAME/DB_VERSION combo (or when DB_VERSION is bumped) — that's where
// the object stores ("tables") and their indexes get created.
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        // keyPath: 'id' means each stored project object's own `.id` field
        // is used as its database key (no separate auto-increment id).
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id' });
        // Indexes let us query entries by a field other than the primary
        // key — e.g. "all entries for project X" — without scanning every row.
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

// Shorthand for starting a transaction against one or more object stores.
// mode is 'readonly' or 'readwrite'.
function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

// Wraps a single IndexedDB request (e.g. `store.get(id)`) in a Promise,
// since IDBRequest objects use onsuccess/onerror callbacks natively.
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Generates a random unique id for new projects/entries (e.g.
// "3fa85f64-5717-4562-b3fc-2c963f66afa6").
export function uuid() {
  return crypto.randomUUID();
}

// Thin, promise-based wrapper around the app's IndexedDB access. Holds a
// single lazily-opened connection (`_db`) and exposes CRUD methods per
// object store. Call sites just `await store.putEntry(...)` etc. — none
// of the underlying transaction/event plumbing leaks out.
class Store {
  constructor() {
    this._db = null;
  }

  // Opens the DB connection once and reuses it for the lifetime of the page.
  async db() {
    if (!this._db) this._db = await openDB();
    return this._db;
  }

  async getAllProjects() {
    const db = await this.db();
    const t = tx(db, 'projects', 'readonly');
    return reqToPromise(t.objectStore('projects').getAll());
  }

  // put() both inserts new rows and overwrites existing ones with the same
  // key — there's no separate insert/update method in IndexedDB.
  async putProject(project) {
    const db = await this.db();
    const t = tx(db, 'projects', 'readwrite');
    t.objectStore('projects').put(project);
    // The individual put() request resolves before the data is durably
    // committed — waiting on the transaction's oncomplete instead is the
    // safe way to know the write has actually landed.
    return new Promise((res, rej) => {
      t.oncomplete = () => res(project);
      t.onerror = () => rej(t.error);
    });
  }

  // Deletes a project and cascades the delete to every entry that
  // belongs to it, using the 'projectId' index to find them.
  async deleteProject(id) {
    const db = await this.db();
    const t = tx(db, ['projects', 'entries'], 'readwrite');
    t.objectStore('projects').delete(id);
    const idx = t.objectStore('entries').index('projectId');
    const range = IDBKeyRange.only(id);
    // A cursor walks matching rows one at a time (rather than loading them
    // all into memory first) — call .continue() after each delete to
    // advance to the next matching entry until the cursor runs out.
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

  // Looks up entries via the 'projectId' index instead of scanning every
  // entry and filtering in JS.
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

  // Simple key/value row, used for small bits of app state that don't fit
  // the projects/entries shape (not currently used elsewhere, but kept as
  // a general-purpose escape hatch).
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

// A single shared instance — every module that needs storage imports this
// same `store`, so they all share one lazily-opened DB connection.
export const store = new Store();
