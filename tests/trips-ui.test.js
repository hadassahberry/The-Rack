// The Trips tab, driven for real: js/trips.js runs against a small stand-in page and a stand-in Store, so what is shown after
// each action (saving a trip over planned days, changing the plans in the Planner, picking another trip, deleting one) is
// what the code actually does. The focus is the "these days already had outfits" notice and the packed ticks.
// Plain Node, no packages: node tests/trips-ui.test.js
const { check, done, assert, read, vm } = require('./_harness');
const T = require('../js/trip-logic.js');

const J = (x) => JSON.parse(JSON.stringify(x));
const TODAY = '2026-11-22';

// ---- a very small page ----
class El {
    constructor(tag, id) { this.tag = tag; this.id = id; this.children = []; this.listeners = {}; this.attrs = {}; this.classes = new Set(); this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.dataset = {}; this.type = ''; this.name = ''; this.title = ''; this.maxLength = 0; this.placeholder = ''; this.src = ''; this.alt = ''; }
    get className() { return [...this.classes].join(' '); }
    set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() { const c = this.classes; return { add: (...x) => x.forEach(k => c.add(k)), remove: (...x) => x.forEach(k => c.delete(k)), toggle: (k, f) => { const on = f === undefined ? !c.has(k) : !!f; if (on) c.add(k); else c.delete(k); return on; }, contains: (k) => c.has(k) }; }
    set innerHTML(v) { assert.strictEqual(v, '', 'only emptying is allowed: no HTML is built from data'); this.children = []; }
    get innerHTML() { return ''; }
    append(...n) { n.forEach(x => this.children.push(x)); }
    appendChild(n) { this.children.push(n); return n; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    fire(type) { (this.listeners[type] || []).forEach(fn => fn({ target: this, key: undefined })); }
    click() { this.fire('click'); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    focus() {}
    querySelector(sel) { return this.all().find(e => e.tag === sel) || null; }
    querySelectorAll() { return []; }
    all() { const out = []; const walk = (e) => { (e.children || []).forEach(c => { if (c && typeof c === 'object' && 'tag' in c) { out.push(c); walk(c); } }); }; walk(this); return out; }
    get hidden() { return this.classes.has('hidden'); }
}

function makePage({ trips = [], outfits = {}, closet = [], failDelete = false } = {}) {
    const els = {};
    const doc = {
        listeners: {},
        getElementById: (id) => els[id] || (els[id] = new El(id.includes('input') || id === 'trip-name' || id === 'trip-start' || id === 'trip-end' ? 'input' : 'div', id)),
        createElement: (tag) => new El(tag),
        querySelector: () => new El('div'), querySelectorAll: () => [],
        addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
        dispatchEvent: (e) => { doc.events.push(e.type); }, events: []
    };
    const server = { trips: J(trips), snapshot: null, writes: [] };
    const push = () => { if (server.snapshot) server.snapshot(J(server.trips).sort((a, b) => a.start.localeCompare(b.start))); };
    const Store = {
        getPrefs: () => ({ weatherEnabled: false }), getCache: () => null, saveCache() {}, saveLocation() {},
        getTripsLocal: () => [], saveTripsLocal() {},
        onTripsChange: (cb) => { server.snapshot = cb; },
        saveTrip: async (t) => { server.writes.push(['saveTrip', t.id]); const i = server.trips.findIndex(x => x.id === t.id); if (i >= 0) server.trips[i] = J(t); else server.trips.push(J(t)); push(); },
        deleteTrip: async (id) => { if (failDelete) throw new Error('offline'); server.writes.push(['deleteTrip', id]); server.trips = server.trips.filter(t => t.id !== id); push(); },
        setTripPacked: async (id, pieceId, checked) => { server.writes.push(['pack', id, pieceId, checked]); const t = server.trips.find(x => x.id === id); t.packed = { ...(t.packed || {}), [pieceId]: !!checked }; push(); }
    };
    const geo = { results: [{ id: 1, name: 'Paris', admin1: 'Île-de-France', country: 'France', country_code: 'FR', latitude: 48.85, longitude: 2.35, timezone: 'Europe/Paris', population: 2138551 }] };
    const dialogs = [];
    const ctx = vm.createContext({
        console: { ...console, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, RegExp, Error, Event: class { constructor(t) { this.type = t; } },
        document: doc, window: { waitForAuth: () => Promise.resolve('u'), addEventListener() {} }, Store, setTimeout, clearTimeout,
        fetch: async () => ({ ok: true, json: async () => geo }),
        isoDateKey: () => TODAY, itemThumb: () => new El('span'), demoBadge: () => new El('span'), weatherInfo: () => ({ icon: '', label: '' }), formatTemp: (v) => String(v),
        openDayForPlanning: () => {}, ModalDialogs: { open() {}, close() {}, isOpen: () => true }, closeOnBackdrop() {},
        confirmDialog: async (o) => { dialogs.push(o); return true; },
        plannerOutfits: outfits, plannerCloset: closet, closetLoaded: true, plannerLoaded: true
    });
    for (const f of ['js/save-state.js', 'js/trip-logic.js', 'js/trips.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext('this.Trips = Trips;', ctx);
    (doc.listeners.DOMContentLoaded || []).forEach(fn => fn());                 // the page's init
    const $ = doc.getElementById;
    return {
        ctx, doc, els, server, dialogs, Trips: ctx.Trips, $,
        tick: () => new Promise(r => setTimeout(r, 15)),
        setPlans(o) { ctx.plannerOutfits = o; ctx.Trips.refreshView(); },
        serverSnapshot(list) { server.trips = J(list); push(); },
        notice: () => ({ text: $('trip-notice').textContent, hidden: $('trip-notice').hidden }),
        list: () => $('trip-pack-list').all().filter(e => e.tag === 'input'),
        names: () => $('trip-pack-list').all().filter(e => e.classes.has('trip-pack-name')).map(e => e.textContent),
        cards: () => $('trips-list').children,
        detailHidden: () => $('trip-detail').hidden
    };
}
const dest = { label: 'Paris, Île-de-France, France', name: 'Paris', admin1: 'Île-de-France', country: 'France', countryCode: 'FR', latitude: 48.85, longitude: 2.35, timezone: 'Europe/Paris' };
const trip = (o = {}) => ({ id: 't1', name: '', destination: dest, start: '2026-11-24', end: '2026-11-27', packed: {}, createdAt: 1, ...o });
const piece = (id, name, category) => ({ id, name, category, color: '#222222', tagged: true });
const CLOSET = [piece('tee', 'White tee', 'tops'), piece('jeans', 'Jeans', 'bottoms'), piece('shoes', 'Sneakers', 'shoes'), piece('top', 'Navy top', 'tops'), piece('skirt', 'Black skirt', 'bottoms')];
const outfit = (id, itemIds) => ({ id, label: '', itemIds });
const PLANS = { '2026-11-24': [outfit('a', ['tee', 'jeans'])], '2026-11-25': [outfit('b', ['top', 'skirt', 'shoes'])] };

// walks the real form: add a trip to Paris for the given dates
async function addTripViaForm(p, start, end) {
    p.$('trip-add-btn').click();
    p.$('trip-dest-input').value = 'Paris';
    p.$('trip-dest-search-btn').click();
    await p.tick();
    p.$('trip-start').value = start; p.$('trip-end').value = end;
    p.$('trip-save-btn').click();
    await p.tick();
}

// ================= the notice, from the selected trip and the current plans =================
check('the pure notice: counts days that have outfits WITH pieces right now, and says nothing when there are none', () => {
    const t = trip();
    assert.strictEqual(T.tripPlansNotice(t, PLANS), '2 days of this trip have outfits planned in the Planner. Those pieces are on the packing list.');
    assert.strictEqual(T.tripPlansNotice(t, { '2026-11-24': [outfit('a', ['tee'])] }), '1 day of this trip has outfits planned in the Planner. Those pieces are on the packing list.');
    for (const none of [{}, undefined, { '2026-11-24': [] }, { '2026-11-24': [outfit('a', [])] }, { '2026-12-30': [outfit('a', ['tee'])] }, { '2026-11-23': [outfit('a', ['tee'])] }]) assert.strictEqual(T.tripPlansNotice(t, none), '', JSON.stringify(none));
    assert.strictEqual(T.tripPlansNotice(null, PLANS), '');
    assert.strictEqual(T.tripPlansNotice(undefined, PLANS), '');
});
check('saving a trip over days that already have outfits shows the notice, and the checklist has those pieces', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    assert.strictEqual(p.server.trips.length, 1);
    assert.deepStrictEqual(p.notice(), { text: '2 days of this trip have outfits planned in the Planner. Those pieces are on the packing list.', hidden: false });
    assert.deepStrictEqual(p.names().sort(), ['Black skirt', 'Jeans', 'Navy top', 'Sneakers', 'White tee']);
});
check('saving a trip over days with NO plans shows no notice', async () => {
    const p = makePage({ closet: CLOSET, outfits: {} });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    assert.strictEqual(p.server.trips.length, 1);
    assert.deepStrictEqual(p.notice(), { text: '', hidden: true });
});
check('REPRODUCED BUG: removing the planned outfits in the Planner clears the notice (it used to stay), along with the checklist', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    assert.strictEqual(p.notice().hidden, false);
    p.setPlans({});                                              // the Planner removed every outfit; the Trips tab is opened again
    assert.deepStrictEqual(p.notice(), { text: '', hidden: true });
    assert.deepStrictEqual(p.names(), []);
});
check('removing only SOME of the plans updates the count rather than keeping the old one', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    p.setPlans({ '2026-11-24': PLANS['2026-11-24'] });
    assert.strictEqual(p.notice().text, '1 day of this trip has outfits planned in the Planner. Those pieces are on the packing list.');
    assert.deepStrictEqual(p.names().sort(), ['Jeans', 'White tee']);
});
check('the notice follows plans coming back, but only for the trip that was just saved', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    p.setPlans({});
    assert.strictEqual(p.notice().hidden, true);
    p.setPlans(PLANS);
    assert.strictEqual(p.notice().hidden, false, 'the same trip, plans present again');
});
check('picking another trip hides the notice; picking the first trip again shows it if its plans are still there', async () => {
    const other = trip({ id: 't2', start: '2026-12-10', end: '2026-12-12', destination: { ...dest, name: 'Rome', label: 'Rome, Lazio, Italy', latitude: 41.9, longitude: 12.5 } });
    const p = makePage({ closet: CLOSET, outfits: { ...PLANS, '2026-12-11': [outfit('c', ['tee'])] }, trips: [other] });
    await p.tick();
    p.serverSnapshot([other]);
    await addTripViaForm(p, '2026-11-24', '2026-11-27');                 // saves t1-like trip; it becomes the selected one
    const mine = p.server.trips.find(t => t.id !== 't2');
    assert.strictEqual(p.notice().hidden, false);
    p.cards().find(c => /Rome/.test(c.children.map(x => x.textContent).join(' '))).click();             // switch to the other trip
    assert.deepStrictEqual(p.notice(), { text: '', hidden: true }, 'not this trip\'s notice');
    p.cards().find(c => c.dataset.tripId === mine.id).click();                                        // and back
    assert.strictEqual(p.notice().hidden, false);
    p.setPlans({});
    assert.strictEqual(p.notice().hidden, true);
});
check('a trip that had plans when it was LOADED (not just saved) shows no notice: it is about adding a trip over plans', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS, trips: [trip()] });
    await p.tick();
    p.serverSnapshot([trip()]);
    assert.deepStrictEqual(p.notice(), { text: '', hidden: true });
    assert.deepStrictEqual(p.names().length, 5, 'but its checklist is there');
});
check('REPRODUCED BUG: deleting the trip clears the notice (it used to stay, with no trip left)', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    assert.strictEqual(p.notice().hidden, false);
    p.$('trip-delete-btn').click();
    await p.tick();
    assert.strictEqual(p.dialogs.length, 1);
    assert.strictEqual(p.server.trips.length, 0);
    assert.deepStrictEqual(p.notice(), { text: '', hidden: true });
});
check('deleting the LAST trip: nothing selected, detail hidden, list empty, notice empty and hidden, and nothing comes back later', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    p.$('trip-delete-btn').click();
    await p.tick();
    assert.strictEqual(p.detailHidden(), true);
    assert.strictEqual(p.cards().length, 0);
    assert.strictEqual(p.$('trips-empty').hidden, false, 'the "No trips yet" text is back');
    assert.deepStrictEqual(p.notice(), { text: '', hidden: true });
    p.setPlans({ '2026-11-24': PLANS['2026-11-24'] });                    // plans changing afterwards does not bring it back
    p.setPlans({});
    assert.deepStrictEqual(p.notice(), { text: '', hidden: true });
    assert.deepStrictEqual(p.names(), []);
});
check('deleting one of two trips: the other becomes the selected one, with no leftover notice', async () => {
    const other = trip({ id: 't2', start: '2026-12-10', end: '2026-12-12', destination: { ...dest, name: 'Rome', label: 'Rome, Lazio, Italy', latitude: 41.9, longitude: 12.5 } });
    const p = makePage({ closet: CLOSET, outfits: { ...PLANS, '2026-12-11': [outfit('c', ['tee'])] } });
    await p.tick();
    p.serverSnapshot([other]);
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    p.$('trip-delete-btn').click();                                        // deletes the one just saved
    await p.tick();
    assert.deepStrictEqual(p.server.trips.map(t => t.id), ['t2']);
    assert.strictEqual(p.detailHidden(), false);
    assert.strictEqual(p.$('trip-detail-title').textContent, 'Trip to Rome');
    assert.deepStrictEqual(p.notice(), { text: '', hidden: true });
});
check('a delete that fails changes nothing on screen (the trip and its notice stay) and says so', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS, failDelete: true });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    p.$('trip-delete-btn').click();
    await p.tick();
    assert.strictEqual(p.server.trips.length, 1);
    assert.strictEqual(p.cards().length, 1);
    assert.strictEqual(p.notice().hidden, false);
    assert(p.dialogs.some(d => /Couldn’t delete the trip/.test(d.title)));
});
check('the notice waits for the plans to have loaded: nothing is claimed before then', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    p.ctx.plannerLoaded = false;
    p.Trips.refreshView();
    assert.deepStrictEqual(p.notice(), { text: '', hidden: true });
    p.ctx.plannerLoaded = true;
    p.Trips.refreshView();
    assert.strictEqual(p.notice().hidden, false);
});
check('editing a saved trip over planned days shows the notice for it; over empty days it does not', async () => {
    const p = makePage({ closet: CLOSET, outfits: { '2026-11-24': PLANS['2026-11-24'] }, trips: [trip({ start: '2026-12-01', end: '2026-12-03' })] });
    await p.tick();
    p.serverSnapshot([trip({ start: '2026-12-01', end: '2026-12-03' })]);
    assert.strictEqual(p.notice().hidden, true);
    p.$('trip-edit-btn').click();
    p.$('trip-start').value = '2026-11-24'; p.$('trip-end').value = '2026-11-27';
    p.$('trip-save-btn').click();
    await p.tick();
    assert.strictEqual(p.notice().text, '1 day of this trip has outfits planned in the Planner. Those pieces are on the packing list.');
});

// ================= packed ticks survive all of this =================
const tick = (p, id) => { const box = p.list().find(i => i.dataset.pieceId === id); box.checked = !box.checked; box.fire('change'); return box; };
check('ticks are kept while the plans change, the notice comes and goes, and trips are switched', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    tick(p, 'tee'); tick(p, 'skirt');
    await p.tick();
    const mine = p.server.trips[0];
    assert.deepStrictEqual(J(mine.packed), { tee: true, skirt: true });
    const checked = () => p.list().filter(i => i.checked).map(i => i.dataset.pieceId).sort();
    assert.deepStrictEqual(checked(), ['skirt', 'tee']);
    p.setPlans({ '2026-11-24': PLANS['2026-11-24'] });                    // the skirt's day is removed: the notice shrinks, the tee keeps its tick
    assert.deepStrictEqual(checked(), ['tee']);
    assert.strictEqual(p.notice().text.startsWith('1 day'), true);
    p.setPlans({});
    assert.strictEqual(p.notice().hidden, true);
    assert.deepStrictEqual(J(p.server.trips[0].packed), { tee: true, skirt: true }, 'the saved ticks are untouched by plan changes');
    p.setPlans(PLANS);
    assert.deepStrictEqual(checked(), ['skirt', 'tee'], 'and they are there again when the pieces come back');
});
check('ticking after the notice changed still saves just that piece, once, and never duplicates it', async () => {
    const p = makePage({ closet: CLOSET, outfits: PLANS });
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    p.setPlans({ '2026-11-24': PLANS['2026-11-24'] });
    tick(p, 'jeans'); await p.tick();
    tick(p, 'jeans'); await p.tick();
    tick(p, 'jeans'); await p.tick();
    assert.deepStrictEqual(J(p.server.trips[0].packed), { jeans: true });
    assert.strictEqual(p.list().length, 2, 'one entry per piece');
    assert.deepStrictEqual(p.server.writes.filter(w => w[0] === 'pack').map(w => w[3]), [true, false, true]);
});
check('deleting a trip drops its own ticks only: another trip keeps its checked pieces', async () => {
    const other = trip({ id: 't2', start: '2026-12-10', end: '2026-12-12', packed: { tee: true }, destination: { ...dest, name: 'Rome', label: 'Rome, Lazio, Italy', latitude: 41.9, longitude: 12.5 } });
    const p = makePage({ closet: CLOSET, outfits: { ...PLANS, '2026-12-11': [outfit('c', ['tee', 'jeans'])] } });
    await p.tick();
    p.serverSnapshot([other]);
    await addTripViaForm(p, '2026-11-24', '2026-11-27');
    tick(p, 'tee'); await p.tick();
    p.$('trip-delete-btn').click(); await p.tick();
    assert.deepStrictEqual(p.server.trips.map(t => t.id), ['t2']);
    assert.deepStrictEqual(J(p.server.trips[0].packed), { tee: true });
    assert.deepStrictEqual(p.list().filter(i => i.checked).map(i => i.dataset.pieceId), ['tee']);
});

done();
