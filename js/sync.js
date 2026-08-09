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

function startListening() {
  stopListening();
  unsubProjects = _fsMod.onSnapshot(userCollection('projects'), (snap) => {
    let changed = false;
    snap.docChanges().forEach((change) => {
      changed = true;
      if (change.type === 'removed') {
        localStore.deleteProject(change.doc.id);
      } else {
        localStore.putProject(change.doc.data());
      }
    });
    if (changed && onRemoteChangeCb) onRemoteChangeCb();
  });
  unsubEntries = _fsMod.onSnapshot(userCollection('entries'), (snap) => {
    let changed = false;
    snap.docChanges().forEach((change) => {
      changed = true;
      if (change.type === 'removed') {
        localStore.deleteEntry(change.doc.id);
      } else {
        localStore.putEntry(change.doc.data());
      }
    });
    if (changed && onRemoteChangeCb) onRemoteChangeCb();
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

export async function pushProject(project) {
  if (!currentUser || !fbDb) return;
  try { await _fsMod.setDoc(userDoc('projects', project.id), project, { merge: true }); } catch (err) { console.warn('sync push failed', err); }
}

export async function pushDeleteProject(id) {
  if (!currentUser || !fbDb) return;
  try { await _fsMod.deleteDoc(userDoc('projects', id)); } catch (err) { console.warn('sync delete failed', err); }
}

export async function pushEntry(entry) {
  if (!currentUser || !fbDb) return;
  try { await _fsMod.setDoc(userDoc('entries', entry.id), entry, { merge: true }); } catch (err) { console.warn('sync push failed', err); }
}

export async function pushDeleteEntry(id) {
  if (!currentUser || !fbDb) return;
  try { await _fsMod.deleteDoc(userDoc('entries', id)); } catch (err) { console.warn('sync delete failed', err); }
}
