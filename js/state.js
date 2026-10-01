// Firestore-backed Store, scoped to the signed-in user (js/auth.js calls
// Store.setUid() once auth resolves). Firebase itself loads as an ES module
// (js/firebase-init.js) and publishes window.Firebase + a 'firebase-ready'
// event, since this file is a classic script. waitForFirebase() bridges that
// gap regardless of which of the two finishes loading first.
function waitForFirebase() {
    if (window.Firebase) return Promise.resolve(window.Firebase);
    return new Promise((resolve) => {
        window.addEventListener('firebase-ready', () => resolve(window.Firebase), { once: true });
    });
}

let currentUid = null;

const Store = {
    setUid(uid) {
        currentUid = uid;
    },

    async _collection(name) {
        const { db, dbFns } = await waitForFirebase();
        return dbFns.collection(db, 'users', currentUid, name);
    },

    async _doc(name, id) {
        const { db, dbFns } = await waitForFirebase();
        return dbFns.doc(db, 'users', currentUid, name, id);
    },

    // onSnapshot right after sign-in can transiently fail with
    // permission-denied before Firestore's internal credential provider has
    // finished picking up the freshly-signed-in auth token (a known Firebase
    // Web SDK race) — and Firestore treats permission-denied as terminal, it
    // won't retry on its own. Retry a few times with backoff so a cold-start
    // sign-in doesn't leave a listener silently dead.
    _subscribe(name, mapFn, callback, attempt = 0) {
        waitForFirebase().then(async ({ dbFns }) => {
            dbFns.onSnapshot(await this._collection(name), (snap) => {
                callback(mapFn(snap));
            }, (err) => {
                if (err.code === 'permission-denied' && attempt < 5) {
                    setTimeout(() => this._subscribe(name, mapFn, callback, attempt + 1), 500 * (attempt + 1));
                } else {
                    console.error(`Store: live listener for "${name}" failed`, err);
                }
            });
        });
    },

    // ---- Closet ----
    async getCloset() {
        const { dbFns } = await waitForFirebase();
        const snap = await dbFns.getDocs(await this._collection('closet'));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async addClosetItem(item) {
        const { dbFns } = await waitForFirebase();
        await dbFns.setDoc(await this._doc('closet', item.id), item);
    },
    async updateClosetItem(id, patch) {
        const { dbFns } = await waitForFirebase();
        await dbFns.setDoc(await this._doc('closet', id), patch, { merge: true });
    },
    async deleteClosetItem(id) {
        const { dbFns } = await waitForFirebase();
        await dbFns.deleteDoc(await this._doc('closet', id));
    },
    onClosetChange(callback) {
        this._subscribe('closet', (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() })), callback);
    },

    // ---- Schedule (keyed by ISO date) ----
    async getSchedule() {
        const { dbFns } = await waitForFirebase();
        const snap = await dbFns.getDocs(await this._collection('schedule'));
        const schedule = {};
        snap.docs.forEach(d => { schedule[d.id] = d.data().itemIds || []; });
        return schedule;
    },
    async setScheduleDay(dateKey, itemIds) {
        const { dbFns } = await waitForFirebase();
        if (itemIds.length === 0) {
            await dbFns.deleteDoc(await this._doc('schedule', dateKey));
        } else {
            await dbFns.setDoc(await this._doc('schedule', dateKey), { itemIds });
        }
    },
    onScheduleChange(callback) {
        this._subscribe('schedule', (snap) => {
            const schedule = {};
            snap.docs.forEach(d => { schedule[d.id] = d.data().itemIds || []; });
            return schedule;
        }, callback);
    },

    // ---- Saved outfits ----
    async getSavedOutfits() {
        const { dbFns } = await waitForFirebase();
        const snap = await dbFns.getDocs(await this._collection('savedOutfits'));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async addSavedOutfit(outfit) {
        const { dbFns } = await waitForFirebase();
        await dbFns.setDoc(await this._doc('savedOutfits', outfit.id), outfit);
    },
    async deleteSavedOutfit(id) {
        const { dbFns } = await waitForFirebase();
        await dbFns.deleteDoc(await this._doc('savedOutfits', id));
    },
    onSavedOutfitsChange(callback) {
        this._subscribe('savedOutfits', (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() })), callback);
    },

    // ---- Device-local only (not synced: inherently per-device) ----
    getLocation() {
        return JSON.parse(localStorage.getItem('rack_location')) || null;
    },
    saveLocation(location) {
        localStorage.setItem('rack_location', JSON.stringify(location));
    },
    getCache(key) {
        try {
            return JSON.parse(localStorage.getItem('rack_cache_' + key)) || null;
        } catch {
            return null;
        }
    },
    saveCache(key, value) {
        localStorage.setItem('rack_cache_' + key, JSON.stringify(value));
    }
};
