// Firebase layer: auth + Firestore with offline cache. Exposes window.FB for the page script.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, sendEmailVerification, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  collection, doc, onSnapshot, setDoc, writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(app);
let db, offlineCache = true;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  offlineCache = false;
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
}

const DEL = "__DEL__";
function conv(v) {
  if (v === DEL) return deleteField();
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = conv(v[k]);
    return o;
  }
  return v;
}

window.FB = {
  DEL,
  offlineCache,
  onAuth(cb) { return onAuthStateChanged(auth, cb); },
  user() { return auth.currentUser; },
  signIn(email, pass) { return signInWithEmailAndPassword(auth, email, pass); },
  async signUp(email, pass, name) {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (name) { try { await updateProfile(cred.user, { displayName: name }); } catch (e) {} }
    return cred;
  },
  google() { return signInWithPopup(auth, new GoogleAuthProvider()); },
  reset(email) { return sendPasswordResetEmail(auth, email); },
  verify() { return auth.currentUser ? sendEmailVerification(auth.currentUser) : Promise.resolve(); },
  async reloadUser() {
    if (!auth.currentUser) return null;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    return auth.currentUser;
  },
  signOut() { return signOut(auth); },
  watchDoc(path, cb, err) {
    return onSnapshot(doc(db, path), { includeMetadataChanges: true },
      s => cb(s.exists() ? s.data() : null, s.metadata), err);
  },
  watchCol(path, cb, err) {
    return onSnapshot(collection(db, path), { includeMetadataChanges: true },
      s => cb(s.docs.map(d => ({ id: d.id, data: d.data() })), s.metadata), err);
  },
  // ops: [{path, data, del}] — data is merged; DEL removes a field (at any depth)
  apply(ops) {
    const chunks = [];
    for (let i = 0; i < ops.length; i += 400) chunks.push(ops.slice(i, i + 400));
    return Promise.all(chunks.map(ch => {
      const b = writeBatch(db);
      ch.forEach(op => {
        const r = doc(db, op.path);
        if (op.del) b.delete(r); else b.set(r, conv(op.data), { merge: true });
      });
      return b.commit();
    }));
  },
  setUser(uid, data) { return setDoc(doc(db, "users", uid), conv(data), { merge: true }); }
};
window.dispatchEvent(new Event("fb-ready"));
