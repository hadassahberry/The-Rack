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
    // A day holds a list of outfits: [{ id, label, itemIds, flagsOff?, worn? }].
    // `label` is the activity ("Class"); `flagsOff` hides repeat warnings for
    // that outfit; `worn` is set only when the owner marks the outfit as worn
    // (planning alone is never treated as wearing, and nothing already saved
    // is turned into "worn" automatically). Days saved before outfits existed hold only { itemIds };
    // they're read as one unlabeled outfit, so nothing needs migrating.
    // Each day's document also keeps a flat `itemIds` (every item across its
    // outfits) so older copies of the app still show the right items.
    _outfitsFromDoc(data) {
        if (Array.isArray(data.outfits)) {
            return data.outfits.map(o => ({
                id: o.id || 'main',
                label: o.label || '',
                itemIds: Array.isArray(o.itemIds) ? o.itemIds : [],
                flagsOff: !!o.flagsOff,
                worn: !!o.worn           // only ever true if the owner marked it as worn
            }));
        }
        if (Array.isArray(data.itemIds) && data.itemIds.length) {
            return [{ id: 'main', label: '', itemIds: data.itemIds, flagsOff: false, worn: false }];
        }
        return [];
    },
    _scheduleDetailFromSnap(snap) {
        const byDate = {};
        snap.docs.forEach(d => {
            const outfits = this._outfitsFromDoc(d.data());
            if (outfits.length) byDate[d.id] = outfits;
        });
        return byDate;
    },
    // { 'YYYY-MM-DD': [itemId, ...] } — every item planned that day, across its outfits.
    flattenSchedule(byDate) {
        const flat = {};
        for (const [date, outfits] of Object.entries(byDate)) {
            const ids = [...new Set(outfits.flatMap(o => o.itemIds))];
            if (ids.length) flat[date] = ids;
        }
        return flat;
    },
    async getScheduleDetail() {
        const { dbFns } = await waitForFirebase();
        return this._scheduleDetailFromSnap(await dbFns.getDocs(await this._collection('schedule')));
    },
    async getSchedule() {
        return this.flattenSchedule(await this.getScheduleDetail());
    },
    // Replaces a day's outfits. An empty list removes the day.
    async setScheduleOutfits(dateKey, outfits) {
        const { dbFns } = await waitForFirebase();
        if (outfits.length === 0) {
            await dbFns.deleteDoc(await this._doc('schedule', dateKey));
            return;
        }
        const clean = outfits.map(o => ({
            id: o.id,
            label: String(o.label || '').trim().slice(0, 40),
            itemIds: [...new Set(o.itemIds)],
            ...(o.flagsOff ? { flagsOff: true } : {}),
            ...(o.worn ? { worn: true } : {})
        }));
        await dbFns.setDoc(await this._doc('schedule', dateKey), {
            outfits: clean,
            itemIds: [...new Set(clean.flatMap(o => o.itemIds))]
        });
    },
    // Used when an item is deleted from the closet: take it out of every planned outfit.
    async removeItemFromSchedule(itemId) {
        const byDate = await this.getScheduleDetail();
        for (const [date, outfits] of Object.entries(byDate)) {
            if (!outfits.some(o => o.itemIds.includes(itemId))) continue;
            const next = outfits
                .map(o => ({ ...o, itemIds: o.itemIds.filter(id => id !== itemId) }))
                .filter(o => o.itemIds.length > 0 || o.label);     // drop outfits left empty and unlabeled
            await this.setScheduleOutfits(date, next);
        }
    },
    // Live updates: callback receives { 'YYYY-MM-DD': [outfit, ...] }.
    onScheduleChange(callback) {
        this._subscribe('schedule', (snap) => this._scheduleDetailFromSnap(snap), callback);
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
        // The other optional calendars (js/calendars.js) all start switched off.
        publicHolidays: false,
        christianHolidays: false,
        christianStyle: 'western',   // 'western' | 'orthodox' (which Easter)
        hijriCalendar: false,
        tempUnit: 'auto',      // 'auto' (by location) | 'F' | 'C'
        weekStart: 'sun',      // 'sun' | 'mon'
        showOutfitPhotos: true, // little photos of the planned pieces on each calendar day
        // Repeat warnings (js/repeats.js): on/off, how many past times to check,
        // and which categories count. Shoes, accessories and coats repeat
        // constantly, so they start switched off.
        repeatWarnings: true,
        repeatLookBack: 3,
        repeatCategories: ['tops', 'bottoms', 'dresses']
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
            schedule: await this.getScheduleDetail(),  // { 'YYYY-MM-DD': [{ id, label, itemIds }] }
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
