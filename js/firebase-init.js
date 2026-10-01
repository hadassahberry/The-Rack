// Loaded as type="module" so it can import from the CDN. Everything else in
// the app stays a classic script (inline onclick="" handlers and cross-file
// globals like Store/Location rely on that), so this module's only job is to
// initialize Firebase and publish what the rest of the app needs onto
// `window.Firebase`, then announce readiness via a `firebase-ready` event —
// classic scripts can't `import`, so this is the hand-off point.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
    signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail, signOut,
    verifyPasswordResetCode, confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
    getFirestore, doc, getDoc, getDocs, setDoc, deleteDoc, collection, onSnapshot, query
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.Firebase = {
    app, auth, db,
    authFns: {
        onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
        signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail, signOut,
        verifyPasswordResetCode, confirmPasswordReset
    },
    dbFns: { doc, getDoc, getDocs, setDoc, deleteDoc, collection, onSnapshot, query }
};
window.dispatchEvent(new Event('firebase-ready'));
