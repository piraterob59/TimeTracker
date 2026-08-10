const CONFIG_KEY = 'tt_firebase_config';
const SDK_VERSION = '10.7.0';

let fbApp = null;
let fbAuth = null;
let fbDb = null;
let _authMod = null;
let _fsMod = null;
let currentUser = null;
let localStore = null;
let onRemoteChangeCb = null;
let unsubProjects = null;
let unsubEntries = null;

export function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function syncStatus() {
  return { connected: !!currentUser, email: currentUser ? currentUser.email : null };
}

async function ensureFirebase(config) {
  if (fbApp) return;
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
  ]);
  _authMod = authMod;
  _fsMod = fsMod;
  fbApp = initializeApp(config);
  fbAuth = authMod.getAuth(fbApp);
  fbDb = fsMod.getFirestore(fbApp);
}

function userCollection(kind) {
  return _fsMod.collection(fbDb, 'users', currentUser.uid, kind);
}

function userDoc(kind, id) {
  return _fsMod.doc(fbDb, 'users', currentUser.uid, kind, id);
}

function stopListening() {
  if (unsubProjects) unsubProjects();
  if (unsubEntries) unsubEntries();
  unsubProjects = null;
  unsubEntries = null;
}

// Watches one Firestore collection and mirrors remote changes into the
// local store via `put`/`del`, firing onRemoteChangeCb once per snapshot
// that actually changed something. Returns the unsubscribe function.
function subscribeCollection(kind, { put, del }) {
  return _fsMod.onSnapshot(userCollection(kind), (snap) => {
    let changed = false;
    snap.docChanges().forEach((change) => {
      changed = true;
      if (change.type === 'removed') {
        del(change.doc.id);
      } else {
        put(change.doc.data());
      }
    });
    if (changed && onRemoteChangeCb) onRemoteChangeCb();
  });
}

function startListening() {
  stopListening();
  unsubProjects = subscribeCollection('projects', {
    put: (p) => localStore.putProject(p),
    del: (id) => localStore.deleteProject(id),
  });
  unsubEntries = subscribeCollection('entries', {
    put: (e) => localStore.putEntry(e),
    del: (id) => localStore.deleteEntry(id),
  });
}

async function uploadLocalDataOnce(uid) {
  const flagKey = `tt_sync_uploaded_${uid}`;
  if (localStorage.getItem(flagKey)) return;
  const [projects, entries] = await Promise.all([
    localStore.getAllProjects(),
    localStore.getAllEntries(),
  ]);
  await Promise.all([
    ...projects.map((p) => _fsMod.setDoc(userDoc('projects', p.id), p, { merge: true })),
    ...entries.map((e) => _fsMod.setDoc(userDoc('entries', e.id), e, { merge: true })),
  ]);
  localStorage.setItem(flagKey, '1');
}

export async function initSync(store, onRemoteChange) {
  localStore = store;
  onRemoteChangeCb = onRemoteChange;
  const config = getConfig();
  if (!config) return;
  try {
    await ensureFirebase(config);
  } catch (err) {
    console.warn('Firebase init failed', err);
    return;
  }
  try {
    await _authMod.getRedirectResult(fbAuth);
  } catch (err) {
    console.warn('Redirect sign-in failed', err);
  }
  _authMod.onAuthStateChanged(fbAuth, async (user) => {
    currentUser = user;
    if (user) {
      await uploadLocalDataOnce(user.uid);
      startListening();
    } else {
      stopListening();
    }
    if (onRemoteChangeCb) onRemoteChangeCb();
  });
}

export async function connectWithConfig(config, onRemoteChange) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  if (onRemoteChange) onRemoteChangeCb = onRemoteChange;
  await ensureFirebase(config);
  const provider = new _authMod.GoogleAuthProvider();
  try {
    await _authMod.signInWithPopup(fbAuth, provider);
  } catch (err) {
    if (err && (err.code === 'auth/operation-not-supported-in-this-environment' || err.code === 'auth/popup-blocked')) {
      await _authMod.signInWithRedirect(fbAuth, provider);
      return;
    }
    throw err;
  }
}

export async function disconnectSync() {
  if (fbAuth && _authMod) {
    try { await _authMod.signOut(fbAuth); } catch { /* ignore */ }
  }
  stopListening();
  currentUser = null;
  localStorage.removeItem(CONFIG_KEY);
  fbApp = null;
  fbAuth = null;
  fbDb = null;
  _authMod = null;
  _fsMod = null;
}

async function pushDoc(kind, item) {
  if (!currentUser || !fbDb) return;
  try { await _fsMod.setDoc(userDoc(kind, item.id), item, { merge: true }); } catch (err) { console.warn('sync push failed', err); }
}

async function pushDeleteDoc(kind, id) {
  if (!currentUser || !fbDb) return;
  try { await _fsMod.deleteDoc(userDoc(kind, id)); } catch (err) { console.warn('sync delete failed', err); }
}

export function pushProject(project) {
  return pushDoc('projects', project);
}

export function pushDeleteProject(id) {
  return pushDeleteDoc('projects', id);
}

export function pushEntry(entry) {
  return pushDoc('entries', entry);
}

export function pushDeleteEntry(id) {
  return pushDeleteDoc('entries', id);
}
