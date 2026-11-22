// Settings > Default calendar view: which view the calendar opens on, that a temporary choice with the Week / 2 weeks /
// Month buttons never changes the saved default (or is overridden by it), and that the choice is saved per account.
const { check, done, assert, loadScript, read } = require('./_harness');
const V = require('../js/view-range.js');

// ---- the pure rules (js/view-range.js) ----
check('the supported views are exactly the three the calendar already has', () => {
    assert.deepStrictEqual(V.CALENDAR_VIEWS, ['week', '2weeks', 'month']);
    const html = read('index.html');
    const buttons = [...html.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(buttons, V.CALENDAR_VIEWS, 'the calendar buttons');
    const options = [...html.slice(html.indexOf('id="pref-calview"')).split('</select>')[0].matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(options, V.CALENDAR_VIEWS, 'the Settings choices');
});
check('each supported view is read back as saved', () => {
    for (const v of V.CALENDAR_VIEWS) assert.strictEqual(V.savedDefaultView({ defaultCalendarView: v }), v);
});
check('nothing saved, or something that is not a view, reads as no choice (null)', () => {
    for (const p of [undefined, null, {}, { defaultCalendarView: undefined }, { defaultCalendarView: null }, { defaultCalendarView: '' }, { defaultCalendarView: 'day' }, { defaultCalendarView: 'Week' }, { defaultCalendarView: 7 }, { defaultCalendarView: ['week'] }])
        assert.strictEqual(V.savedDefaultView(p), null, JSON.stringify(p));
});
check('viewFromDefault: switches only when a default is saved, differs from what shows, and nothing was picked by hand', () => {
    assert.strictEqual(V.viewFromDefault({ prefs: { defaultCalendarView: 'week' }, current: 'month', userPicked: false }), 'week');
    assert.strictEqual(V.viewFromDefault({ prefs: { defaultCalendarView: '2weeks' }, current: 'month', userPicked: false }), '2weeks');
    assert.strictEqual(V.viewFromDefault({ prefs: { defaultCalendarView: 'month' }, current: 'week', userPicked: false }), 'month');
    assert.strictEqual(V.viewFromDefault({ prefs: { defaultCalendarView: 'week' }, current: 'week', userPicked: false }), null, 'already showing');
    assert.strictEqual(V.viewFromDefault({ prefs: {}, current: 'month', userPicked: false }), null, 'no default: unchanged');
    assert.strictEqual(V.viewFromDefault({ prefs: {}, current: 'week', userPicked: false }), null, 'no default never forces Month either');
    assert.strictEqual(V.viewFromDefault({ prefs: { defaultCalendarView: 'week' }, current: 'month', userPicked: true }), null, 'a hand-picked view wins');
});

// ---- the calendar's own logic, taken from js/calendar.js and run in a sandbox ----
function calendar() {
    const src = read('js/calendar.js').replace(/\r\n/g, '\n');
    const from = src.indexOf('// Opens the calendar on the saved default view.');
    const to = src.indexOf('async function setViewMode(mode)');
    assert(from > 0 && to > from, 'applyDefaultView is in calendar.js');
    const code = `
        let viewMode = 'month', viewPickedByUser = false, openingViewSettled = false;
        const calls = [];
        function setViewMode(m) { if (m === viewMode || !CALENDAR_VIEWS.includes(m)) return; calls.push(m); viewMode = m; }
        ${src.slice(from, to)}
        // the Week / 2 weeks / Month buttons (the click handler in calendar.js, checked below to do exactly this)
        function clickButton(m) { viewPickedByUser = true; setViewMode(m); }
        this.api = { applyDefaultView, showChosenDefaultView, clickButton, view: () => viewMode, calls: () => calls.slice() };`;
    const sb = loadScript('js/view-range.js', {}, ['CALENDAR_VIEWS', 'viewFromDefault', 'savedDefaultView']);
    require('vm').runInContext(code, sb);
    return sb.api;
}
const server = { fromCache: false }, cache = { fromCache: true };

check('the click handler marks the view as picked by hand and saves nothing', () => {
    const src = read('js/calendar.js').replace(/\r\n/g, '\n');
    const h = src.slice(src.indexOf(`document.getElementById('view-switcher')`), src.indexOf(`document.getElementById('add-outfit-btn')`));
    assert(/viewPickedByUser = true;\s*\/\/[^\n]*\n\s*setViewMode\(btn\.dataset\.view\)/.test(h), h);
    assert(!/savePrefs|savePref\b|Store\./.test(h), 'switching views is not saved');
    assert(!/viewPickedByUser/.test(src.slice(src.indexOf('async function setViewMode'), src.indexOf('function renderCalendar()'))), 'setViewMode (also used for the default) does not mark a hand pick');
});

for (const v of ['week', '2weeks', 'month']) {
    check(`an account whose default is ${v}: the calendar opens on it, from this device's copy and again with the server's answer`, () => {
        const c = calendar();
        c.applyDefaultView({ defaultCalendarView: v }, cache);
        assert.strictEqual(c.view(), v);
        c.applyDefaultView({ defaultCalendarView: v }, server);
        assert.strictEqual(c.view(), v);
    });
}
check('no saved default: the calendar opens on Month, exactly as before', () => {
    const c = calendar();
    c.applyDefaultView({}, cache);
    c.applyDefaultView({ weekStart: 'mon' }, server);
    assert.strictEqual(c.view(), 'month');
    assert.strictEqual(JSON.stringify(c.calls()), '[]', 'nothing was switched');
});
check('a new device: no local copy yet, so Month first; then the account\'s saved default arrives and is applied', () => {
    const c = calendar();
    c.applyDefaultView({}, cache);
    assert.strictEqual(c.view(), 'month');
    c.applyDefaultView({ defaultCalendarView: '2weeks' }, server);
    assert.strictEqual(c.view(), '2weeks');
});
check('a temporary choice: the buttons change the view and the saved default is untouched', () => {
    const c = calendar();
    const prefs = { defaultCalendarView: 'week' };
    c.applyDefaultView(prefs, server);
    c.clickButton('month');
    assert.strictEqual(c.view(), 'month');
    assert.strictEqual(prefs.defaultCalendarView, 'week');
});
check('a temporary choice survives later settings updates, repeat answers and calendar updates', () => {
    const c = calendar();
    c.applyDefaultView({ defaultCalendarView: 'week' }, cache);
    c.clickButton('2weeks');
    for (let i = 0; i < 4; i++) c.applyDefaultView({ defaultCalendarView: 'week', weatherEnabled: i % 2 === 0 }, i % 2 ? server : cache);
    assert.strictEqual(c.view(), '2weeks');
});
check('a choice made before the server\'s answer arrives is not replaced when it does', () => {
    const c = calendar();
    c.applyDefaultView({}, cache);                        // opened on Month, saved default not known yet
    c.clickButton('week');
    c.applyDefaultView({ defaultCalendarView: '2weeks' }, server);
    assert.strictEqual(c.view(), 'week');
});
check('once the server\'s answer has been applied, a later change from another device does not move the screen', () => {
    const c = calendar();
    c.applyDefaultView({ defaultCalendarView: 'week' }, server);
    c.applyDefaultView({ defaultCalendarView: 'month' }, server);
    assert.strictEqual(c.view(), 'week');
});
check('the local copy then a different server answer: the server (the account\'s truth) wins if nothing was picked', () => {
    const c = calendar();
    c.applyDefaultView({ defaultCalendarView: 'week' }, cache);
    c.applyDefaultView({ defaultCalendarView: 'month' }, server);
    assert.strictEqual(c.view(), 'month');
});
check('changing the default in Settings shows it now and an older settings answer cannot undo it', () => {
    const c = calendar();
    c.applyDefaultView({}, cache);
    c.showChosenDefaultView('2weeks');
    assert.strictEqual(c.view(), '2weeks');
    c.applyDefaultView({ defaultCalendarView: 'week' }, server);       // a stale answer that was already on its way
    assert.strictEqual(c.view(), '2weeks');
});
check('a stored value that is not a view is ignored', () => {
    const c = calendar();
    c.applyDefaultView({ defaultCalendarView: 'decade' }, server);
    assert.strictEqual(c.view(), 'month');
});

// ---- wiring: Settings, the first paint, and the settings answer ----
check('Settings: the select shows the saved view (Month when none), and a change saves only that field', () => {
    const s = read('js/settings.js').replace(/\r\n/g, '\n');
    assert(s.includes(`$('pref-calview').value = savedDefaultView(prefs) || 'month';`));
    const h = s.slice(s.indexOf(`$('pref-calview').addEventListener`), s.indexOf(`$('pref-photos').addEventListener`));
    assert(/savePref\(\{ defaultCalendarView: mode \}\)/.test(h) && /showChosenDefaultView\(mode\)/.test(h) && /CALENDAR_VIEWS\.includes\(mode\)/.test(h), h);
});
check('the default is applied after sign-in (first paint) and with each settings answer, before anything is drawn from them', () => {
    const a = read('js/app.js').replace(/\r\n/g, '\n');
    const boot = a.slice(a.indexOf('await window.waitForAuth()'), a.indexOf('async function applyPrefs'));
    assert(boot.indexOf('applyDefaultView(Store.getPrefs(), { fromCache: true })') > 0);
    assert(boot.indexOf('applyDefaultView(') < boot.indexOf('renderCalendar()'));
    assert(/FirstRun\.notePrefs\(prefs, meta\);[\s\S]*?applyDefaultView\(prefs, meta\);/.test(a));
});
check('the preference is not part of PREF_DEFAULTS (so "never chosen" stays distinguishable) and is stored with the other settings', () => {
    const st = read('js/state.js');
    assert(!/defaultCalendarView/.test(st), 'nothing view-specific is needed in the store: savePrefs merges the one field');
});

// ---- saved with the account, per account ----
function store(storageData = {}) {
    const data = { ...storageData };
    const localStorage = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
    const writes = [];
    const window = { Firebase: { db: {}, dbFns: { doc: (...a) => a.slice(1).join('/'), collection: (...a) => a.join('/'), setDoc: async (ref, d, o) => { writes.push([ref, d, o || null]); }, onSnapshot: () => {} } }, addEventListener() {} };
    return { Store: loadScript('js/state.js', { localStorage, window }, ['Store']).Store, data, writes };
}
check('saving each view writes just that field to the account\'s settings, merged, and keeps this device\'s copy for that account', async () => {
    for (const v of V.CALENDAR_VIEWS) {
        const { Store, writes, data } = store(); Store.setUid('A');
        await Store.savePrefs({ defaultCalendarView: v });
        assert.deepStrictEqual(JSON.parse(JSON.stringify(writes)), [['users/A/settings/prefs', { defaultCalendarView: v }, { merge: true }]]);
        assert.strictEqual(JSON.parse(data.rack_prefs_A).defaultCalendarView, v);
        assert.strictEqual(V.savedDefaultView(Store.getPrefs()), v);
    }
});
check('after a reload (a new page, the same device) and after signing out and back in, the same account still has its view', async () => {
    const first = store(); first.Store.setUid('A');
    await first.Store.savePrefs({ defaultCalendarView: '2weeks' });
    const reloaded = store(first.data); reloaded.Store.setUid('A');
    assert.strictEqual(V.savedDefaultView(reloaded.Store.getPrefs()), '2weeks');
    const other = store(reloaded.data); other.Store.setUid('B');              // signing out reloads the page; B signs in
    const again = store(other.data); again.Store.setUid('A');                 // and A signs back in
    assert.strictEqual(V.savedDefaultView(again.Store.getPrefs()), '2weeks');
});
check('one account\'s choice never reaches another account, on the same device or in the database', async () => {
    const a = store(); a.Store.setUid('A');
    await a.Store.savePrefs({ defaultCalendarView: 'week' });
    const b = store(a.data); b.Store.setUid('B');
    assert.strictEqual(V.savedDefaultView(b.Store.getPrefs()), null, 'B has no choice and so opens on Month');
    await b.Store.savePrefs({ defaultCalendarView: 'month' });
    assert.strictEqual(JSON.parse(b.data.rack_prefs_A).defaultCalendarView, 'week', 'A is untouched');
    assert.deepStrictEqual(b.writes.map(w => w[0]), ['users/B/settings/prefs']);
});
check('an account that never chose has no stored default, and saving some other setting does not invent one', async () => {
    const { Store, writes } = store(); Store.setUid('C');
    assert.strictEqual(V.savedDefaultView(Store.getPrefs()), null);
    await Store.savePrefs({ weekStart: 'mon' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(writes)), [['users/C/settings/prefs', { weekStart: 'mon' }, { merge: true }]]);
    assert.strictEqual(V.savedDefaultView(Store.getPrefs()), null);
});

done();
