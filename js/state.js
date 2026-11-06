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

    // ---- Preferences (Settings page) ----
    // Synced with the account (users/{uid}/settings/prefs) so they follow you
    // between devices; a local copy makes the first paint instant. Location is
    // deliberately NOT in here — it stays on the device.
    PREF_DEFAULTS: {
        weatherEnabled: true,
        hebrewCalendarEnabled: true,
        tempUnit: 'auto',      // 'auto' (by location) | 'F' | 'C'
        weekStart: 'sun'       // 'sun' | 'mon'
    },

    getPrefs() {
        try {
            return { ...this.PREF_DEFAULTS, ...(JSON.parse(localStorage.getItem('rack_prefs')) || {}) };
        } catch {
            return { ...this.PREF_DEFAULTS };
        }
    },
    async savePrefs(patch) {
        const next = { ...this.getPrefs(), ...patch };
        localStorage.setItem('rack_prefs', JSON.stringify(next));
        const { dbFns } = await waitForFirebase();
        await dbFns.setDoc(await this._doc('settings', 'prefs'), next);
        return next;
    },
    onPrefsChange(callback) {
        this._subscribe('settings', (snap) => {
            const doc = snap.docs.find(d => d.id === 'prefs');
            return { ...this.PREF_DEFAULTS, ...(doc ? doc.data() : {}) };
        }, (prefs) => {
            localStorage.setItem('rack_prefs', JSON.stringify(prefs));
            callback(prefs);
        });
    },

    // ---- Clearing and deleting data ----
    // Deletes every document in the named collections. Batches of 400 keep a
    // big closet under Firestore's per-batch limit.
    async _deleteCollections(names) {
        const { db, dbFns } = await waitForFirebase();
        for (const name of names) {
            const snap = await dbFns.getDocs(await this._collection(name));
            for (let i = 0; i < snap.docs.length; i += 400) {
                const batch = dbFns.writeBatch(db);
                snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        }
    },

    // "Clear my closet" (Settings): empties the closet, planner and saved
    // outfits but keeps the account and the user's settings.
    clearClosetData() {
        return this._deleteCollections(['closet', 'schedule', 'savedOutfits']);
    },

    // "Delete account": everything stored for the signed-in user, settings
    // included. The login itself is deleted separately (js/account.js).
    deleteAllUserData() {
        return this._deleteCollections(['closet', 'schedule', 'savedOutfits', 'settings']);
    },

    // "Export my closet" (Settings): everything the user has stored, in one object.
    async exportAllUserData(accountEmail) {
        return {
            app: 'The Rack',
            exportedAt: new Date().toISOString(),
            account: accountEmail || null,
            settings: this.getPrefs(),
            closet: await this.getCloset(),          // each item's photo is included as base64 text
            schedule: await this.getSchedule(),      // { 'YYYY-MM-DD': [item ids] }
            savedOutfits: await this.getSavedOutfits()
        };
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
