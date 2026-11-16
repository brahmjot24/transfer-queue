// Firebase wiring for Transfer Queue. You shouldn't need to edit this file.
// Your project's settings go in firebase-config.js.
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot, getDoc, setDoc, deleteDoc, writeBatch, runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const configured = !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("PASTE");
const app = initializeApp(firebaseConfig);
const _auth = getAuth(app);
const _db = getFirestore(app);
const ref = p => doc(_db, ...p.split("/"));
const wrap = s => ({ id: s.id, exists: s.exists(), data: s.exists() ? s.data() : undefined, fromCache: s.metadata.fromCache });

export const db = {
  listen(path, next, err) { return onSnapshot(ref(path), { includeMetadataChanges: false }, s => next(wrap(s)), e => err && err(e)); },
  listenColl(path, next, err) { return onSnapshot(collection(_db, ...path.split("/")), q => next({ docs: q.docs.map(wrap), fromCache: q.metadata.fromCache }), e => err && err(e)); },
  async get(path) { return wrap(await getDoc(ref(path))); },
  set(path, data) { return setDoc(ref(path), data); },
  merge(path, data) { return setDoc(ref(path), data, { merge: true }); },
  del(path) { return deleteDoc(ref(path)); },
  async batch(ops) {
    const b = writeBatch(_db);
    ops.forEach(o => o.op === "delete" ? b.delete(ref(o.path)) : o.op === "merge" ? b.set(ref(o.path), o.data, { merge: true }) : b.set(ref(o.path), o.data));
    await b.commit();
  },
  tx(fn) {
    return runTransaction(_db, async t => fn({
      async get(path) { return wrap(await t.get(ref(path))); },
      set(path, data) { t.set(ref(path), data); }
    }));
  }
};

export const auth = {
  onChange(cb) { return onAuthStateChanged(_auth, u => cb(u ? { email: u.email, uid: u.uid } : null)); },
  signIn(email, pw) { return signInWithEmailAndPassword(_auth, email, pw); },
  create(email, pw) { return createUserWithEmailAndPassword(_auth, email, pw); },
  signOut() { return signOut(_auth); },
  async changePassword(email, oldPw, newPw) {
    const u = _auth.currentUser; if (!u) throw { code: "auth/no-user" };
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(email, oldPw));
    await updatePassword(u, newPw);
  }
};
