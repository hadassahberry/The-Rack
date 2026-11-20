// js/state.js: how plans are read from the database (old and new shapes), and how each ACCOUNT's settings are kept
// on this device, so one account's settings can never paint onto another and a saved setting writes only itself.
const { check, done, assert, loadScript } = require('./_harness');

function load(storageData = {}) {
    const store = { ...storageData };
    const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    const writes = [];
    const window = {
        Firebase: { db: {}, dbFns: { doc: (...a) => a.slice(1).join('/'), collection: (...a) => a.join('/'), setDoc: async (ref, data, opts) => { writes.push([ref, data, opts || null]); }, onSnapshot: () => {} } },
        addEventListener() {}
    };
    const sandbox = loadScript('js/state.js', { localStorage, window }, ['Store']);
    return { Store: sandbox.Store, store, writes };
}
const A_PREFS = { hebrewCalendarEnabled: true, hijriCalendar: true, publicHolidays: true, christianHolidays: true, weekStart: 'mon' };

// ---- plans ----
check('a day saved before outfits existed (only itemIds) reads as one unlabeled outfit', () => {
    const { Store } = load();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Store._outfitsFromDoc({ itemIds: ['a', 'b'] }))), [{ id: 'main', label: '', itemIds: ['a', 'b'], flagsOff: false, worn: false }]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Store._outfitsFromDoc({ itemIds: [] }))), []);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Store._outfitsFromDoc({}))), []);
});
check('outfits keep their activity, repeat-warning switch, worn mark and save time; nothing is worn unless the owner marked it', () => {
    const { Store } = load();
    const out = JSON.parse(JSON.stringify(Store._outfitsFromDoc({ outfits: [{ id: 'o1', label: 'Class', itemIds: ['a'], flagsOff: true, worn: true, labelAt: 5 }, { itemIds: 'broken' }] })));
    assert.deepStrictEqual(out[0], { id: 'o1', label: 'Class', itemIds: ['a'], flagsOff: true, worn: true, labelAt: 5 });
    assert.deepStrictEqual(out[1], { id: 'main', label: '', itemIds: [], flagsOff: false, worn: false });
});
check('a day\'s flat list of pieces has each once, across its outfits', () => {
    const { Store } = load();
    const flat = Store.flattenSchedule({ '2026-11-01': [{ itemIds: ['a', 'b'] }, { itemIds: ['b', 'c'] }], '2026-11-02': [{ itemIds: [] }] });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(flat)), { '2026-11-01': ['a', 'b', 'c'] });
});
check('saving a day trims the activity to 40 characters, drops duplicates, and writes the flat list too', async () => {
    const { Store, writes } = load(); Store.setUid('u1');
    await Store.setScheduleOutfits('2026-11-01', [{ id: 'o', label: 'x'.repeat(60), itemIds: ['a', 'a', 'b'], worn: true }]);
    const [ref, data] = writes[0];
    assert.strictEqual(ref, 'users/u1/schedule/2026-11-01');
    assert.strictEqual(data.outfits[0].label.length, 40);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(data.outfits[0].itemIds)), ['a', 'b']);
    assert.strictEqual(data.outfits[0].worn, true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(data.itemIds)), ['a', 'b']);
});

// ---- settings kept per account ----
check('nobody signed in: plain defaults, and the old shared copy is not read', () => {
    const { Store } = load({ rack_prefs: JSON.stringify(A_PREFS) });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Store.getPrefs())), JSON.parse(JSON.stringify(Store.PREF_DEFAULTS)));
});
check('the old device-wide copy is removed once someone signs in', () => {
    const { Store, store } = load({ rack_prefs: JSON.stringify(A_PREFS) });
    Store.setUid('A');
    assert.strictEqual('rack_prefs' in store, false);
    assert.strictEqual(Store.getPrefs().hijriCalendar, false, 'never another account\'s settings');
});
check('on one browser, account B never sees account A\'s settings, and A\'s are untouched', async () => {
    const first = load(); first.Store.setUid('A');
    await first.Store.savePrefs({ hijriCalendar: true, publicHolidays: true, weekStart: 'mon' });
    assert.deepStrictEqual(Object.keys(first.store).filter(k => k.startsWith('rack_prefs')), ['rack_prefs_A']);
    assert.deepStrictEqual([first.Store.getPrefs().hijriCalendar, first.Store.getPrefs().publicHolidays, first.Store.getPrefs().weekStart], [true, true, 'mon']);

    const second = load(first.store); second.Store.setUid('B');            // a page reload, then B signs in
    const D = JSON.parse(JSON.stringify(second.Store.PREF_DEFAULTS));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(second.Store.getPrefs())), D, 'B\'s first paint is B\'s own (defaults)');
    await second.Store.savePrefs({ christianHolidays: true });
    assert.strictEqual(JSON.parse(second.store.rack_prefs_A).christianHolidays, false);
    assert.strictEqual(JSON.parse(second.store.rack_prefs_B).christianHolidays, true);

    const third = load(second.store); third.Store.setUid('A');
    assert.deepStrictEqual([third.Store.getPrefs().hijriCalendar, third.Store.getPrefs().weekStart], [true, 'mon'], 'A comes back: instant and correct');
});
check('the account\'s own settings arriving are remembered for that account only', () => {
    const { Store, store } = load(); Store.setUid('B');
    Store._subscribe = (name, mapFn, cb) => cb({ ...Store.PREF_DEFAULTS, tempUnit: 'C' });
    let delivered = null;
    Store.onPrefsChange((p) => { delivered = p; });
    assert.strictEqual(JSON.parse(store.rack_prefs_B).tempUnit, 'C');
    assert.strictEqual(delivered.tempUnit, 'C');
    assert.strictEqual('rack_prefs_A' in store, false);
});
check('saving a setting writes only that setting, merged (a new device cannot wipe the others with defaults)', async () => {
    const { Store, writes } = load(); Store.setUid('C');
    await Store.savePrefs({ weekStart: 'mon' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(writes)), [['users/C/settings/prefs', { weekStart: 'mon' }, { merge: true }]]);
});
check('the welcome flag is also a one-field merge, remembered for that account', async () => {
    const { Store, writes, store } = load(); Store.setUid('C');
    await Store.markWelcomeSeen();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(writes[0])), ['users/C/settings/prefs', { welcomeSeen: true }, { merge: true }]);
    assert.strictEqual(JSON.parse(store.rack_prefs_C).welcomeSeen, true);
    assert.strictEqual('welcomeSeen' in JSON.parse(JSON.stringify(Store.PREF_DEFAULTS)), false, 'an account without the field reads as "unknown", not "seen"');
});
check('unreadable stored settings never break the app', () => {
    const { Store } = load({ rack_prefs_D: '{not json' }); Store.setUid('D');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Store.getPrefs())), JSON.parse(JSON.stringify(Store.PREF_DEFAULTS)));
});
check('the defaults are what the Settings page promises', () => {
    const { Store } = load(); const d = Store.PREF_DEFAULTS;
    assert.strictEqual(d.hebrewCalendarEnabled, true);
    for (const k of ['publicHolidays', 'christianHolidays', 'hijriCalendar']) assert.strictEqual(d[k], false, k + ' starts off');
    assert.strictEqual(d.tempUnit, 'auto');
    assert.strictEqual(d.weekStart, 'sun');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(d.repeatCategories)), ['tops', 'bottoms', 'dresses']);
});

done();
