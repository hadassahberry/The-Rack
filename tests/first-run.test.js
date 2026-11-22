// The first-run setup for an empty closet (js/starter-closet.js, js/first-run.js, and the pieces of the app that know about
// demo pieces): who is offered it and when (loading states, skipping, existing users), the starter closet, the demo
// pieces, the one-button demo cleanup (with mixed real and demo data), and the offer of Help me choose.
// Plain Node, no packages: node tests/first-run.test.js
const { check, done, assert, read, fs, path, root, vm } = require('./_harness');
const S = require('../js/starter-closet.js');
const { suggestOutfits, outfitReadiness, suggestionPool } = require('../js/outfit-suggest.js');
const { computeWearStats } = require('../js/analytics.js');

const J = (x) => JSON.parse(JSON.stringify(x));
const piece = (id, name, category, extra = {}) => ({ id, name, category, color: '#222222', occasion: 'casual', season: 'all-season', tagged: true, ...extra });
const decode = (uri) => decodeURIComponent(uri.slice(uri.indexOf(',') + 1));

// ================= who is offered it =================
const D = (o) => S.firstRunDecision({ prefs: {}, prefsConfirmed: true, closetCount: 0, closetConfirmed: true, ...o });
check('an empty closet that has never been offered the setup: show it', () => {
    assert.strictEqual(D({}), 'show');
    assert.strictEqual(D({ prefs: { firstRunSeen: false, weekStart: 'mon' } }), 'show');
});
check('nothing is decided until BOTH the settings and the closet have arrived (loading states)', () => {
    assert.strictEqual(D({ prefsConfirmed: false }), 'wait');
    assert.strictEqual(D({ closetConfirmed: false }), 'wait');
    assert.strictEqual(D({ prefsConfirmed: false, closetConfirmed: false }), 'wait');
    assert.strictEqual(D({ closetCount: undefined }), 'wait', 'closet not read yet');
    assert.strictEqual(D({ closetCount: null }), 'wait');
    assert.strictEqual(D({ closetCount: '0' }), 'wait', 'not a number: unknown');
    assert.strictEqual(D({ prefs: null }), 'wait');
    assert.strictEqual(D({ prefs: undefined }), 'wait');
});
check('a closet that has pieces is never shown it (even when its settings are not loaded... it still waits for both)', () => {
    assert.strictEqual(D({ closetCount: 1 }), 'has-pieces');
    assert.strictEqual(D({ closetCount: 40, prefs: { firstRunSeen: true } }), 'has-pieces');
    assert.strictEqual(D({ closetCount: 3, prefsConfirmed: false }), 'wait');
});
check('already offered once (skipped, closed or finished): never forced again, even with an empty closet', () => {
    assert.strictEqual(D({ prefs: { firstRunSeen: true } }), 'seen');
    for (const v of ['yes', 1, null, {}]) assert.strictEqual(D({ prefs: { firstRunSeen: v } }), 'seen', 'unexpected value ' + JSON.stringify(v));
});

// ================= the live wiring: a page-less copy of js/first-run.js =================
// js/first-run.js runs in a sandbox with a stub page and stub Store, so what happens, and in which order, is tested for real.
function makePage(extra = {}) {
    const els = {};
    const lists = { '[data-demo-banner]': [Object.assign(stubEl('b1'), {}), stubEl('b2')] };
    function stubEl(id) {
        const classes = new Set(id.startsWith('first-run-') && id !== 'first-run-title' && id !== 'first-run-offer' ? [] : []);
        const el = {
            id, classes, listeners: {}, textContent: '', disabled: false, dataset: {},
            classList: {
                add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)),
                toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; if (on) classes.add(c); else classes.delete(c); return on; },
                contains: (c) => classes.has(c)
            },
            addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
            click() { (el.listeners.click || []).forEach(fn => fn({ target: el })); },
            setAttribute() {}, getAttribute() { return null; }, focus() {}, closest: () => null, appendChild() {}, append() {},
            querySelector: () => null, querySelectorAll: () => []
        };
        return el;
    }
    const doc = {
        listeners: {},
        getElementById: (id) => els[id] || (els[id] = stubEl(id)),
        querySelectorAll: (sel) => lists[sel] || [],
        querySelector: () => null,
        addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); }
    };
    // the steps other than "choose" start hidden, like the page
    ['starter', 'ready', 'missing'].forEach(s => doc.getElementById('first-run-' + s).classList.add('hidden'));
    doc.getElementById('first-run-modal').classList.add('hidden');
    doc.getElementById('first-run-offer').classList.add('hidden');
    const calls = { seen: 0, welcome: 0, added: [], announced: [], dialogs: [], closed: 0, opened: 0, removed: 0, helpOpened: [], dayOpened: [] };
    const Store = {
        markFirstRunSeen: async () => { calls.seen++; },
        addClosetItems: async (items) => { if (extra.failAdd) throw new Error('offline'); calls.added.push(...items); },
        removeDemoData: async () => { calls.removed++; return { pieces: 1 }; }
    };
    const globals = {
        document: doc, Store, console: { ...console, error() {} }, Welcome: { consider: () => { calls.welcome++; } },
        ModalDialogs: { open: () => { calls.opened++; }, close: () => { calls.closed++; }, isOpen: () => true },
        confirmDialog: async (o) => { calls.dialogs.push(o); return extra.confirmAnswer !== false; },
        closeOnBackdrop() {}, isoDateKey: () => '2026-11-22', compressImage: async () => 'photo', pluralize: (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`,
        plannerCloset: extra.plannerCloset || [], plannerOutfits: {}, liveCloset: [], liveSavedOutfits: [],
        HelpChoose: { openForDay: (d) => calls.helpOpened.push(d) }, openDayForPlanning: (d) => calls.dayOpened.push(d),
        setTimeout: (fn) => { fn(); return 0; }
    };
    const ctx = vm.createContext({ Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, RegExp, Error, ...globals });
    for (const f of ['js/starter-closet.js', 'js/outfit-suggest.js', 'js/first-run.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext('this.FirstRun = FirstRun;', ctx);
    (doc.listeners.DOMContentLoaded || []).forEach(fn => fn());      // the page's init
    return { FirstRun: ctx.FirstRun, doc, calls, els, lists, ctx, modal: doc.getElementById('first-run-modal'), step: (s) => !doc.getElementById('first-run-' + s).classList.contains('hidden') };
}
const FRESH = { fromCache: false }, CACHED = { fromCache: true };
const tick = () => new Promise(r => setTimeout(r, 5));

check('loading states: nothing shows, and nothing is written, until settings AND closet have come from the server', async () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, FRESH);                              // settings arrived, the closet has not
    await tick();
    assert(p.modal.classList.contains('hidden'));
    assert.strictEqual(p.calls.seen, 0);
    p.FirstRun.noteCloset([], CACHED);                            // an EMPTY answer that came only from a local copy says nothing
    await tick();
    assert(p.modal.classList.contains('hidden'), 'a cached empty answer must not show it');
    assert.strictEqual(p.calls.seen + p.calls.welcome, 0);
    p.FirstRun.noteCloset([], FRESH);                             // now it is real
    await tick();
    assert(!p.modal.classList.contains('hidden'), 'shown once the empty closet is confirmed');
});
check('settings that are only from a local copy do not count either, and neither does an answer with no source information', async () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, CACHED);
    p.FirstRun.noteCloset([], FRESH);
    assert(p.modal.classList.contains('hidden'));
    p.FirstRun.notePrefs({}, undefined);
    assert(p.modal.classList.contains('hidden'));
    p.FirstRun.notePrefs({}, FRESH);
    assert(!p.modal.classList.contains('hidden'));
});
check('either order of arrival works', () => {
    const a = makePage(); a.FirstRun.noteCloset([], FRESH); a.FirstRun.notePrefs({}, FRESH);
    const b = makePage(); b.FirstRun.notePrefs({}, FRESH); b.FirstRun.noteCloset([], FRESH);
    assert(!a.modal.classList.contains('hidden') && !b.modal.classList.contains('hidden'));
});
check('when it is shown: it opens on the choice step, is recorded as seen once (with the old welcome card), and the old card is not also shown', () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, FRESH); p.FirstRun.noteCloset([], FRESH);
    assert.strictEqual(p.step('choose'), true);
    assert.strictEqual(['starter', 'ready', 'missing'].some(p.step), false);
    assert.strictEqual(p.calls.seen, 1);
    assert.strictEqual(p.calls.welcome, 0, 'the welcome card is not shown on top of it');
    p.FirstRun.noteCloset([], FRESH); p.FirstRun.notePrefs({}, FRESH);
    assert.strictEqual(p.calls.seen, 1, 'decided once per page load');
});
check('existing users: a closet with pieces never shows it; that is remembered once, so emptying it later does not bring it back', () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, FRESH);
    p.FirstRun.noteCloset([piece('a', 'Tee', 'tops')], FRESH);
    assert(p.modal.classList.contains('hidden'));
    assert.strictEqual(p.calls.seen, 1, 'recorded on the account');
    assert.strictEqual(p.calls.welcome, 1, 'the older welcome card keeps its own rules');
    p.FirstRun.noteCloset([], FRESH);                              // they empty the closet in this same visit
    assert(p.modal.classList.contains('hidden'), 'never shown mid-visit');
    assert.strictEqual(p.calls.seen, 1);
});
check('existing users who are already marked as seen cost no write at all', () => {
    const p = makePage();
    p.FirstRun.notePrefs({ firstRunSeen: true, welcomeSeen: true }, FRESH);
    p.FirstRun.noteCloset([piece('a', 'Tee', 'tops')], FRESH);
    assert.strictEqual(p.calls.seen, 0);
    assert(p.modal.classList.contains('hidden'));
});
check('already offered before: an empty closet is not offered it again, and nothing is written', () => {
    const p = makePage();
    p.FirstRun.notePrefs({ firstRunSeen: true }, FRESH); p.FirstRun.noteCloset([], FRESH);
    assert(p.modal.classList.contains('hidden'));
    assert.strictEqual(p.calls.seen, 0);
});
check('skipping closes it, says where to find it again, and writes nothing more; it is not shown again', async () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, FRESH); p.FirstRun.noteCloset([], FRESH);
    p.els['first-run-skip-btn'].click();
    await tick();
    assert(p.modal.classList.contains('hidden'));
    assert.strictEqual(p.calls.closed, 1);
    assert(/Skipped\. You can set up your closet any time from the Closet tab/.test(p.els['app-announcer'].textContent));
    assert.strictEqual(p.calls.seen, 1, 'only the one "seen" write, made when it appeared');
    assert.strictEqual(p.calls.dialogs.length, 0, 'skipping asks nothing');
    p.FirstRun.noteCloset([], FRESH);
    assert(p.modal.classList.contains('hidden'));
});
check('Escape-style closing goes through the same path as Skip', async () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, FRESH); p.FirstRun.noteCloset([], FRESH);
    (p.doc.listeners.keydown || []).forEach(fn => fn({ key: 'Escape' }));
    await tick();
    assert(p.modal.classList.contains('hidden'));
});
check('demo pieces: one press adds all of them in one write, then goes straight to the offer of Help me choose', async () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, FRESH); p.FirstRun.noteCloset([], FRESH);
    p.els['first-run-demo-btn'].click();
    await tick();
    assert.strictEqual(p.calls.added.length, S.DEMO_PIECES.length);
    assert(p.calls.added.every(i => i.demo === true && /^demo_/.test(i.id)));
    assert.strictEqual(p.step('ready'), true, 'enough pieces: Help me choose is offered immediately');
    assert(/Demo pieces added/.test(p.els['first-run-ready-text'].textContent));
    assert.strictEqual(p.step('missing'), false);
});
check('demo pieces that could not be added: says so, nothing is half-done, and the buttons work again', async () => {
    const p = makePage({ failAdd: true });
    p.FirstRun.notePrefs({}, FRESH); p.FirstRun.noteCloset([], FRESH);
    p.els['first-run-demo-btn'].click();
    await tick();
    assert.strictEqual(p.step('choose'), true);
    assert.strictEqual(p.step('ready'), false);
    assert.strictEqual(p.els['first-run-demo-btn'].disabled, false);
});
check('demo pieces are not added twice', async () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, FRESH);
    p.FirstRun.noteCloset(S.makeDemoItems(), FRESH);
    p.FirstRun.start('demo');
    await tick();
    assert.strictEqual(p.calls.added.length, 0);
});
check('Help me choose: opens today in the Planner with the ideas showing, once the planner has the pieces', async () => {
    const p = makePage({ plannerCloset: [piece('t', 'Tee', 'tops'), piece('b', 'Jeans', 'bottoms')] });
    p.FirstRun.notePrefs({}, FRESH); p.FirstRun.noteCloset([], FRESH);
    p.els['first-run-demo-btn'].click(); await tick();
    p.els['first-run-help-btn'].click(); await tick(); await tick();
    assert.deepStrictEqual(p.calls.dayOpened, ['2026-11-22']);
    assert.deepStrictEqual(p.calls.helpOpened, ['2026-11-22']);
    assert(p.modal.classList.contains('hidden'));
});
check('Help me choose when the pieces turn out not to be enough: it explains what is missing instead of showing an empty result', async () => {
    const p = makePage({ plannerCloset: [piece('t', 'Tee', 'tops')] });
    p.FirstRun.notePrefs({}, FRESH); p.FirstRun.noteCloset([], FRESH);
    p.els['first-run-demo-btn'].click(); await tick();
    p.els['first-run-help-btn'].click();
    await new Promise(r => setTimeout(r, 30));
    assert.deepStrictEqual(p.calls.helpOpened, []);
    assert.strictEqual(p.step('missing'), true);
    assert(/but no bottom yet/.test(p.els['first-run-missing-text'].textContent));
});
check('"Not now" closes the offer without planning anything', async () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, FRESH); p.FirstRun.noteCloset([], FRESH);
    p.els['first-run-demo-btn'].click(); await tick();
    p.els['first-run-notnow-btn'].click(); await tick();
    assert(p.modal.classList.contains('hidden'));
    assert.deepStrictEqual(p.calls.dayOpened, []);
});
check('own photos: the offer appears as a quiet bar only once the pieces they added can make an outfit', async () => {
    const p = makePage();
    p.FirstRun.notePrefs({}, FRESH); p.FirstRun.noteCloset([], FRESH);
    p.els['first-run-photos-btn'].click(); await tick();
    const bar = p.els['first-run-offer'];
    p.FirstRun.noteCloset([piece('a', 'Top', 'tops', { tagged: false }), piece('b', 'Skirt', 'bottoms', { tagged: false })], FRESH);
    assert(bar.classList.contains('hidden'), 'untagged pieces are not used by Help me choose, so not offered yet');
    p.FirstRun.noteCloset([piece('a', 'Top', 'tops'), piece('b', 'Skirt', 'bottoms', { tagged: false })], FRESH);
    assert(bar.classList.contains('hidden'));
    p.FirstRun.noteCloset([piece('a', 'Top', 'tops'), piece('b', 'Skirt', 'bottoms')], FRESH);
    assert(!bar.classList.contains('hidden'), 'now it can');
    bar.classList.add('hidden');
    p.FirstRun.noteCloset([piece('a', 'Top', 'tops'), piece('b', 'Skirt', 'bottoms'), piece('c', 'Shoes', 'shoes')], FRESH);
    assert(bar.classList.contains('hidden'), 'offered once, not nagged');
});
check('the offer bar is never raised for someone who did not ask for it (skipped, or an existing user)', () => {
    const p = makePage();
    p.FirstRun.notePrefs({ firstRunSeen: true }, FRESH);
    p.FirstRun.noteCloset([piece('a', 'Top', 'tops'), piece('b', 'Skirt', 'bottoms')], FRESH);
    assert(p.els['first-run-offer'].classList.contains('hidden'));
});
check('the Demo banners follow the closet: shown while any demo piece is there, gone when none is', () => {
    const p = makePage();
    p.FirstRun.notePrefs({ firstRunSeen: true }, FRESH);
    const shown = () => p.lists['[data-demo-banner]'].map(b => !b.classList.contains('hidden'));
    p.FirstRun.noteCloset([piece('a', 'Tee', 'tops')], FRESH);
    assert.deepStrictEqual(shown(), [false, false]);
    p.FirstRun.noteCloset([piece('a', 'Tee', 'tops'), ...S.makeDemoItems()], FRESH);
    assert.deepStrictEqual(shown(), [true, true]);
    p.FirstRun.noteCloset([piece('a', 'Tee', 'tops')], FRESH);
    assert.deepStrictEqual(shown(), [false, false]);
});
check('Remove demo pieces asks first; a "no" removes nothing; a "yes" removes via the one Store action', async () => {
    const no = makePage({ confirmAnswer: false });
    no.ctx.liveCloset = S.makeDemoItems();
    await no.FirstRun.removeDemo();
    assert.strictEqual(no.calls.dialogs.length, 1);
    assert(/Remove demo pieces/.test(no.calls.dialogs[0].title));
    assert(/9 demo pieces/.test(no.calls.dialogs[0].message));
    assert(/Your own pieces, plans, saved outfits and wear stats are not touched/.test(no.calls.dialogs[0].note));
    assert.strictEqual(no.calls.removed, 0);
    const yes = makePage();
    yes.ctx.liveCloset = S.makeDemoItems();
    await yes.FirstRun.removeDemo();
    assert.strictEqual(yes.calls.removed, 1);
});
check('Remove demo pieces with no demo pieces present does nothing (and asks nothing)', async () => {
    const p = makePage();
    p.ctx.liveCloset = [piece('a', 'Tee', 'tops')];
    await p.FirstRun.removeDemo();
    assert.strictEqual(p.calls.dialogs.length + p.calls.removed, 0);
});

// ================= the starter closet =================
const row = (category, color, extra = {}) => ({ category, color, ...extra });
check('the starter form starts with 6 rows, takes up to 8, and suggests 5-8 without requiring it', () => {
    assert.strictEqual(S.STARTER_SLOTS.length, 6);
    assert.strictEqual(S.STARTER_MAX, 8);
    assert.strictEqual(S.STARTER_SUGGESTED_MIN, 5);
    assert(S.STARTER_SLOTS.every(c => S.STARTER_CATEGORIES.includes(c)));
    assert(S.STARTER_COLORS.length >= 8 && S.STARTER_COLORS.every(c => /^#[0-9a-f]{6}$/.test(c.hex) && c.name));
});
check('a starter piece needs only a kind and a color: everything else has a default, and it counts as tagged', () => {
    const [item] = S.makeStarterItems([row('tops', '#1f2a52')], { now: 1000, rand: () => 0.5 });
    assert.strictEqual(item.name, 'Navy top');
    assert.deepStrictEqual([item.category, item.color, item.occasion, item.season, item.tagged], ['tops', '#1f2a52', 'casual', 'all-season', true]);
    assert(/^item_/.test(item.id));
    assert.strictEqual(item.noPhoto, true);
    assert(/^data:image\/svg\+xml/.test(item.image), 'a drawing stands in for the photo, so it shows everywhere a photo does');
    assert(!('demo' in item), 'not a demo piece');
});
check('a single piece is enough: 5-8 is only a suggestion', () => {
    assert.strictEqual(S.makeStarterItems([row('dresses', '#222222')]).length, 1);
    assert.deepStrictEqual(S.validateStarterRows([row('dresses', '#222222')]).problems, []);
});
check('photos are optional: a photo replaces the drawing and the piece is a normal photo piece', () => {
    const [item] = S.makeStarterItems([row('bottoms', '#222222', { photo: 'data:image/jpeg;base64,AAAA' })]);
    assert.strictEqual(item.image, 'data:image/jpeg;base64,AAAA');
    assert(!('noPhoto' in item));
});
check('typed names are used (trimmed and cut at 60); the default name is "<Color> <kind>", numbered when repeated', () => {
    const items = S.makeStarterItems([row('tops', '#222222'), row('tops', '#222222'), row('shoes', '#7b5233'), row('outerwear', '#9a9a9a'), row('tops', '#f5f5f5', { name: '   My   favourite tee ' }), row('bottoms', '#222222', { name: 'x'.repeat(80) })]);
    assert.deepStrictEqual(items.map(i => i.name).slice(0, 5), ['Black top', 'Black top 2', 'Brown shoes', 'Gray jacket', 'My favourite tee']);
    assert.strictEqual(items[5].name.length, 60);
});
check('occasion: any of the four; anything else is casual', () => {
    const items = S.makeStarterItems(['work', 'formal', 'workout', 'casual', 'bogus', undefined].map(o => row('tops', '#222222', { occasion: o })));
    assert.deepStrictEqual(items.map(i => i.occasion), ['work', 'formal', 'workout', 'casual', 'casual', 'casual']);
});
check('blank rows are ignored; a row with something filled in needs a color (and says which piece)', () => {
    const v = S.validateStarterRows([row('tops', ''), row('tops', '#222222'), row('bottoms', '', { name: 'Jeans' }), row('shoes', '', { photo: 'p' })]);
    assert.strictEqual(v.complete.length, 1);
    assert.strictEqual(v.problems.length, 2);
    assert(/color for the bottom \(piece #3\)/.test(v.problems[0].text));
    assert(/color for the shoes \(piece #4\)/.test(v.problems[1].text));
    assert.deepStrictEqual(S.makeStarterItems([row('tops', '#222222'), row('bottoms', '')]).map(i => i.category), ['tops'], 'only complete rows become pieces');
});
check('a bad kind or color is a problem, never a saved piece', () => {
    assert.strictEqual(S.validateStarterRows([row('hats', '#222222')]).problems.length, 1);
    assert.strictEqual(S.validateStarterRows([row('tops', 'red')]).problems.length, 1);
    assert.strictEqual(S.validateStarterRows([row('tops', '#12345')]).problems.length, 1);
    assert.strictEqual(S.makeStarterItems([row('hats', '#222222'), row('tops', 'red')]).length, 0);
});
check('at most 8 pieces at a time', () => {
    const nine = Array.from({ length: 9 }, () => row('tops', '#222222'));
    assert.strictEqual(S.makeStarterItems(nine).length, 8);
    assert(S.validateStarterRows(nine).problems.some(p => /up to 8/i.test(p.text)));
});
check('every piece gets its own id, even in the same millisecond', () => {
    const items = S.makeStarterItems(Array.from({ length: 8 }, () => row('tops', '#222222')), { now: 5, rand: () => 0.123 });
    assert.strictEqual(new Set(items.map(i => i.id)).size, 8);
});
check('what the form is given is not changed', () => {
    const rows = [row('tops', '#222222')], before = JSON.stringify(rows);
    S.makeStarterItems(rows); S.validateStarterRows(rows);
    assert.strictEqual(JSON.stringify(rows), before);
});
check('the picture for a piece without a photo is a well-formed drawing in the piece\'s color', () => {
    const svg = decode(S.placeholderImage({ category: 'dresses', color: '#6d1a2b' }));
    assert(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg) && /<\/svg>$/.test(svg));
    assert(svg.includes('#6d1a2b') && !/DEMO/.test(svg));
    assert(decode(S.placeholderImage({ category: 'tops', color: 'not a color' })).includes('#cccccc'), 'a bad color cannot break the picture');
    assert(!/<script|onload|href=/i.test(svg));
});
check('starter pieces make Help me choose work: 5 to 8 pieces give real ideas, with no empty result', () => {
    const items = S.makeStarterItems([row('tops', '#f5f5f5'), row('tops', '#1f2a52'), row('bottoms', '#4a6fa5'), row('bottoms', '#222222'), row('shoes', '#222222'), row('outerwear', '#c19a6b')]);
    assert.strictEqual(outfitReadiness(items).ready, true);
    const r = suggestOutfits({ items, dateKey: '2026-11-22', weather: null, texts: [], worn: [], weekendPlanned: [] });
    assert(r.suggestions.length >= 1);
    assert(r.suggestions.every(s => s.itemIds.every(id => items.some(i => i.id === id))));
});

// ================= enough pieces? =================
check('ready: a top and a bottom, or a dress', () => {
    assert.strictEqual(outfitReadiness([piece('t', 'T', 'tops'), piece('b', 'B', 'bottoms')]).ready, true);
    assert.strictEqual(outfitReadiness([piece('d', 'D', 'dresses')]).ready, true);
});
check('not ready: it says exactly what is missing', () => {
    const none = outfitReadiness([]);
    assert.deepStrictEqual([none.ready, none.missing], [false, ['top', 'bottom']]);
    assert(/at least a top and a bottom, or a dress/.test(none.message));
    const tops = outfitReadiness([piece('t', 'T', 'tops'), piece('t2', 'T2', 'tops')]);
    assert.deepStrictEqual(tops.missing, ['bottom']);
    assert(/tops but no bottom yet/.test(tops.message));
    assert(/a top but no bottom yet/.test(outfitReadiness([piece('t', 'T', 'tops')]).message));
    const bottoms = outfitReadiness([piece('b', 'B', 'bottoms')]);
    assert.deepStrictEqual(bottoms.missing, ['top']);
    assert(/a bottom but no top yet/.test(bottoms.message));
    assert.deepStrictEqual(outfitReadiness([piece('s', 'S', 'shoes'), piece('o', 'O', 'outerwear')]).missing, ['top', 'bottom'], 'shoes and a coat are not an outfit');
});
check('pieces that still need tagging are not used by Help me choose, and the message says so', () => {
    const r = outfitReadiness([piece('t', 'T', 'tops'), piece('b', 'B', 'bottoms', { tagged: false })]);
    assert.strictEqual(r.ready, false);
    assert.strictEqual(r.untagged, 1);
    assert(/1 piece still needs tagging/.test(r.message) && /press Save/.test(r.message));
    assert(/2 pieces still need tagging/.test(outfitReadiness([piece('b', 'B', 'bottoms', { tagged: false }), piece('c', 'C', 'tops', { tagged: false })]).message));
    assert.strictEqual(outfitReadiness([piece('t', 'T', 'tops'), piece('b', 'B', 'bottoms', { tagged: false }), piece('d', 'D', 'dresses')]).ready, true);
});
check('readiness never invents pieces and does not change what it is given', () => {
    const items = [piece('t', 'T', 'tops')], before = JSON.stringify(items);
    outfitReadiness(items); suggestionPool(items);
    assert.strictEqual(JSON.stringify(items), before);
});

// ================= demo pieces =================
const demo = S.makeDemoItems();
check('demo pieces: all labeled, separate, usable, and 6-10 of them', () => {
    assert(demo.length >= 6 && demo.length <= 10);
    assert(demo.every(i => i.demo === true && /^demo_/.test(i.id) && i.tagged === true && i.noPhoto === true && i.name && S.STARTER_CATEGORIES.includes(i.category)));
    assert.strictEqual(new Set(demo.map(i => i.id)).size, demo.length);
    assert(demo.every(i => decode(i.image).includes('DEMO')), 'the picture itself says DEMO');
    assert.strictEqual(JSON.stringify(S.makeDemoItems()), JSON.stringify(demo), 'the same pieces every time (so adding again overwrites, never duplicates)');
});
check('demo pieces can make several different outfits, in any weather', () => {
    assert.strictEqual(outfitReadiness(demo).ready, true);
    for (const weather of [null, { high: 85, low: 70, code: 0 }, { high: 40, low: 30, code: 71 }, { high: 60, low: 50, code: 61 }]) {
        const r = suggestOutfits({ items: demo, dateKey: '2026-11-22', weather, texts: [], worn: [], weekendPlanned: [] });
        assert(r.suggestions.length >= 1, JSON.stringify(weather));
    }
    assert(suggestOutfits({ items: demo, dateKey: '2026-11-22', weather: null, texts: [], worn: [], weekendPlanned: [] }).suggestions.length >= 2);
});
check('demo pieces are recognised only by demo: true (or the reserved demo_ id)', () => {
    assert.strictEqual(S.isDemoItem({ demo: true }), true);
    for (const x of [{}, { demo: false }, { demo: 'true' }, { demo: 1 }, null, undefined]) assert.strictEqual(S.isDemoItem(x), false);
    assert.strictEqual(S.isDemoId('demo_tee', new Set()), true);
    assert.strictEqual(S.isDemoId('item_1', new Set()), false);
});

// ================= real and demo pieces together =================
check('Help me choose uses demo pieces only while the real pieces cannot make an outfit', () => {
    const real = [piece('t', 'My top', 'tops'), piece('b', 'My jeans', 'bottoms')];
    const ids = (arr) => arr.map(i => i.id);
    assert.deepStrictEqual(ids(suggestionPool([...real, ...demo])), ids(real), 'enough real pieces: demo ones left out');
    assert.deepStrictEqual(ids(suggestionPool([piece('t', 'My top', 'tops'), ...demo])), ids([piece('t', 'x', 'tops'), ...demo]), 'real pieces cannot make an outfit yet: demo ones fill in');
    assert.deepStrictEqual(ids(suggestionPool(demo)), ids(demo));
    assert.deepStrictEqual(ids(suggestionPool([piece('t', 'Top', 'tops'), piece('b', 'Untagged', 'bottoms', { tagged: false }), ...demo])), ids([piece('t', 'x', 'tops'), piece('b', 'y', 'bottoms'), ...demo]), 'an untagged real piece does not count as enough');
    assert.deepStrictEqual(suggestionPool([]), []);
});
check('with enough real pieces, no suggestion ever contains a demo piece', () => {
    const real = [piece('t', 'My top', 'tops'), piece('t2', 'My top 2', 'tops'), piece('b', 'My jeans', 'bottoms'), piece('d', 'My dress', 'dresses')];
    const items = suggestionPool([...real, ...demo]);
    const r = suggestOutfits({ items, dateKey: '2026-11-22', weather: null, texts: [], worn: [], weekendPlanned: [] });
    assert(r.suggestions.length >= 1);
    assert(r.suggestions.every(s => s.itemIds.every(id => !id.startsWith('demo_'))));
});
check('buildDayContext (the day\'s input to Help me choose) uses the same pool', () => {
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise });
    for (const f of ['js/outfit-suggest.js', 'js/help-choose.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext('this.api = { buildDayContext };', ctx);
    const build = (closet) => ctx.api.buildDayContext('2026-11-22', { closet, outfitsByDate: {}, prefs: {} });
    const real = [piece('t', 'My top', 'tops'), piece('b', 'My jeans', 'bottoms')];
    assert.deepStrictEqual(build([...real, ...demo]).items.map(i => i.id), ['t', 'b']);
    assert(build([piece('t', 'My top', 'tops'), ...demo]).items.some(i => i.id.startsWith('demo_')));
    assert.strictEqual(build([piece('t', 'Top', 'tops'), piece('u', 'Untagged', 'bottoms', { tagged: false }), ...demo]).skippedUntagged, 1);
});

// ================= wear stats keep demo pieces out =================
check('wear stats ignore demo pieces: not counted as pieces, wears or plans', () => {
    const closet = [piece('real', 'Real tee', 'tops'), ...demo];
    const schedule = {
        '2026-11-10': [{ id: 'o1', itemIds: ['demo_tee', 'demo_jeans'], worn: true }],                  // demo-only, marked worn
        '2026-11-11': [{ id: 'o2', itemIds: ['real', 'demo_jeans'], worn: true }],                      // mixed, worn
        '2026-11-20': [{ id: 'o3', itemIds: ['demo_dress'] }, { id: 'o4', itemIds: ['real'] }],         // demo-only plan + real plan
        '2026-11-08': [{ id: 'o5', itemIds: ['demo_blouse'] }]                                          // a past demo plan, never marked
    };
    const r = computeWearStats(closet, schedule, '2026-11-15');
    assert.strictEqual(r.totalItems, 1);
    assert.strictEqual(r.totalWears, 1, 'only the real tee\'s wear');
    assert.strictEqual(r.plannedOutfits, 1, 'only the real planned outfit');
    assert.deepStrictEqual(r.unmarkedPast, [], 'a past demo plan is not "not marked yet"');
    assert.strictEqual(r.topCategory, 'tops');
    assert.deepStrictEqual(r.perItem.map(p => p.item.id), ['real']);
});
check('wear stats with only demo pieces look like an empty closet', () => {
    const r = computeWearStats(demo, { '2026-11-10': [{ id: 'o', itemIds: ['demo_tee'], worn: true }] }, '2026-11-15');
    assert.deepStrictEqual([r.totalItems, r.totalWears, r.plannedOutfits, r.topCategory], [0, 0, 0, null]);
});
check('real-only wear stats are exactly as before', () => {
    const closet = [piece('a', 'A', 'tops'), piece('b', 'B', 'bottoms')];
    const r = computeWearStats(closet, { '2026-11-10': [{ id: 'o', itemIds: ['a', 'b'], worn: true }] }, '2026-11-15');
    assert.deepStrictEqual([r.totalItems, r.totalWears, r.plannedOutfits], [2, 2, 0]);
});

// ================= removing demo pieces =================
const REAL_A = piece('item_a', 'My top', 'tops'), REAL_B = piece('item_b', 'My jeans', 'bottoms');
const mixedData = () => ({
    closet: [REAL_A, REAL_B, ...S.makeDemoItems()],
    schedule: {
        '2026-11-01': [{ id: 'o1', label: '', itemIds: ['demo_tee', 'demo_jeans'] }],                                        // demo only -> day removed
        '2026-11-02': [{ id: 'o2', label: 'Class', itemIds: ['item_a', 'demo_jeans'], worn: true, flagsOff: true, labelAt: 7 }],  // mixed -> trimmed
        '2026-11-03': [{ id: 'o3', label: 'Dinner', itemIds: ['demo_dress'] }, { id: 'o4', label: 'Walk', itemIds: ['item_b'] }],  // one removed, one kept
        '2026-11-04': [{ id: 'o5', label: 'Only an activity', itemIds: [] }],                                              // never had demo: untouched
        '2026-11-05': [{ id: 'o6', label: '', itemIds: ['item_a', 'item_b'], worn: true }]                                  // all real: untouched
    },
    saved: [
        { id: 's1', name: 'Demo look', itemIds: ['demo_blouse', 'demo_skirt'] },
        { id: 's2', name: 'Mixed look', itemIds: ['item_a', 'demo_skirt'] },
        { id: 's3', name: 'Mine', itemIds: ['item_a', 'item_b'] }
    ]
});
check('cleanup: deletes every demo piece and nothing else from the closet', () => {
    const plan = S.planDemoCleanup(mixedData());
    assert.strictEqual(plan.itemIds.length, S.DEMO_PIECES.length);
    assert(plan.itemIds.every(id => id.startsWith('demo_')));
    assert(!plan.itemIds.includes('item_a') && !plan.itemIds.includes('item_b'));
});
check('cleanup: planned outfits made only of demo pieces go; mixed ones keep their real pieces and everything else about them; others are untouched', () => {
    const plan = S.planDemoCleanup(mixedData());
    const writes = Object.fromEntries(plan.scheduleWrites.map(w => [w.date, J(w.outfits)]));
    assert.deepStrictEqual(Object.keys(writes).sort(), ['2026-11-01', '2026-11-02', '2026-11-03']);
    assert.deepStrictEqual(writes['2026-11-01'], [], 'a day left with no outfits is removed');
    assert.deepStrictEqual(writes['2026-11-02'], [{ id: 'o2', label: 'Class', itemIds: ['item_a'], worn: true, flagsOff: true, labelAt: 7 }]);
    assert.deepStrictEqual(writes['2026-11-03'], [{ id: 'o4', label: 'Walk', itemIds: ['item_b'] }]);
    assert(!('2026-11-04' in writes) && !('2026-11-05' in writes), 'days with no demo piece are not even written');
});
check('cleanup: saved outfits made only of demo pieces are deleted, mixed ones keep their real pieces, real ones are untouched', () => {
    const plan = S.planDemoCleanup(mixedData());
    assert.deepStrictEqual(plan.savedDeletes, ['s1']);
    assert.deepStrictEqual(J(plan.savedWrites), [{ id: 's2', name: 'Mixed look', itemIds: ['item_a'] }]);
});
check('cleanup: the counts say what will happen', () => {
    const c = S.planDemoCleanup(mixedData()).counts;
    assert.deepStrictEqual(J(c), { pieces: S.DEMO_PIECES.length, outfitsRemoved: 2, outfitsTrimmed: 1, days: 1, savedRemoved: 1, savedTrimmed: 1 });
});
check('cleanup: the confirmation spells it out, including what is not touched', () => {
    const t = S.describeDemoRemoval(S.planDemoCleanup(mixedData()).counts);
    assert(new RegExp(`This removes ${S.DEMO_PIECES.length} demo pieces, 2 planned outfits made only of demo pieces and 1 saved outfit made only of demo pieces\\.`).test(t.message), t.message);
    assert(/2 outfits that mix demo and your own pieces keep the pieces that are yours/.test(t.message));
    assert(/Your own pieces, plans, saved outfits and wear stats are not touched/.test(t.note));
    assert(/^This removes 1 demo piece\.$/.test(S.describeDemoRemoval({ pieces: 1, outfitsRemoved: 0, outfitsTrimmed: 0, days: 0, savedRemoved: 0, savedTrimmed: 0 }).message));
});
check('cleanup: no demo pieces means nothing to do', () => {
    const plan = S.planDemoCleanup({ closet: [REAL_A, REAL_B], schedule: { '2026-11-05': [{ id: 'o', itemIds: ['item_a'] }] }, saved: [{ id: 's', name: 'x', itemIds: ['item_a'] }] });
    assert.deepStrictEqual([plan.itemIds, plan.scheduleWrites, plan.savedDeletes, plan.savedWrites], [[], [], [], []]);
    assert.strictEqual(plan.counts.pieces, 0);
});
check('cleanup: a plan that still points at a demo piece that was deleted one by one is cleaned too (the demo_ id is reserved)', () => {
    const plan = S.planDemoCleanup({ closet: [REAL_A], schedule: { '2026-11-05': [{ id: 'o', itemIds: ['item_a', 'demo_gone'] }, { id: 'p', itemIds: ['demo_gone'] }] }, saved: [] });
    assert.deepStrictEqual(J(plan.scheduleWrites), [{ date: '2026-11-05', outfits: [{ id: 'o', itemIds: ['item_a'] }] }]);
});
check('cleanup never changes what it is given, and never lists a real id for deletion even when ids look alike', () => {
    const data = mixedData(), before = JSON.stringify(data);
    S.planDemoCleanup(data);
    assert.strictEqual(JSON.stringify(data), before);
    const odd = S.planDemoCleanup({ closet: [piece('item_demo', 'Looks like demo', 'tops'), piece('demo', 'Called demo', 'tops')], schedule: {}, saved: [] });
    assert.deepStrictEqual(odd.itemIds, []);
});

// ---- ... and the Store action that carries it out, against a small in-memory database ----
function memoryStore() {
    const data = { 'users/u/closet': {}, 'users/u/schedule': {}, 'users/u/savedOutfits': {}, 'users/u/settings': {} };
    const log = [];
    const snap = (path) => ({ metadata: { fromCache: false }, docs: Object.entries(data[path]).map(([id, d]) => ({ id, data: () => J(d), ref: { path: path + '/' + id } })) });
    const ref = (...s) => ({ path: s.join('/'), parent: s.slice(0, -1).join('/'), id: s[s.length - 1] });
    const dbFns = {
        doc: (_d, ...s) => ref(...s), collection: (_d, ...s) => ({ path: s.join('/') }),
        getDocs: async (c) => snap(c.path),
        setDoc: async (r, d, o) => { log.push(['set', r.path]); data[r.parent][r.id] = o && o.merge ? { ...(data[r.parent][r.id] || {}), ...J(d) } : J(d); },
        deleteDoc: async (r) => { log.push(['delete', r.path]); delete data[r.parent][r.id]; },
        writeBatch: () => { const ops = []; return { set: (r, d) => ops.push(['set', r, d]), delete: (r) => ops.push(['delete', r]), commit: async () => { log.push(['batch', ops.length]); ops.forEach(([k, r, d]) => { if (k === 'set') data[r.parent][r.id] = J(d); else delete data[r.parent][r.id]; }); } }; },
        onSnapshot: () => {}
    };
    const win = { Firebase: { db: {}, dbFns }, addEventListener() {} };
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
    for (const f of ['js/starter-closet.js', 'js/state.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext('this.Store = Store;', ctx);
    ctx.Store.setUid('u');
    return { Store: ctx.Store, data, log };
}
check('Store.removeDemoData with mixed data: demo gone, every real piece, plan and saved outfit still there', async () => {
    const m = memoryStore();
    const d = mixedData();
    d.closet.forEach(i => { const { id, ...rest } = i; m.data['users/u/closet'][id] = rest; });
    Object.entries(d.schedule).forEach(([date, outfits]) => { m.data['users/u/schedule'][date] = { outfits: J(outfits), itemIds: [...new Set(outfits.flatMap(o => o.itemIds))] }; });
    d.saved.forEach(s => { const { id, ...rest } = s; m.data['users/u/savedOutfits'][id] = rest; });
    const counts = await m.Store.removeDemoData();
    assert.strictEqual(counts.pieces, S.DEMO_PIECES.length);
    assert.deepStrictEqual(Object.keys(m.data['users/u/closet']).sort(), ['item_a', 'item_b']);
    assert.deepStrictEqual(J(m.data['users/u/closet'].item_a), { name: 'My top', category: 'tops', color: '#222222', occasion: 'casual', season: 'all-season', tagged: true }, 'a real piece is byte-for-byte what it was');
    assert.deepStrictEqual(Object.keys(m.data['users/u/schedule']).sort(), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    assert.deepStrictEqual(J(m.data['users/u/schedule']['2026-11-02'].outfits), [{ id: 'o2', label: 'Class', itemIds: ['item_a'], flagsOff: true, worn: true, labelAt: 7 }]);
    assert.deepStrictEqual(m.data['users/u/schedule']['2026-11-02'].itemIds, ['item_a'], 'the day\'s flat list is rewritten too');
    assert.deepStrictEqual(J(m.data['users/u/schedule']['2026-11-05'].outfits.map(o => o.itemIds)), [['item_a', 'item_b']]);
    assert.deepStrictEqual(Object.keys(m.data['users/u/savedOutfits']).sort(), ['s2', 's3']);
    assert.deepStrictEqual(m.data['users/u/savedOutfits'].s2.itemIds, ['item_a']);
    assert.deepStrictEqual(m.data['users/u/savedOutfits'].s3.itemIds, ['item_a', 'item_b']);
});
check('Store.removeDemoData deletes the demo pieces LAST, so a failure part-way leaves them to be removed again and loses nothing real', async () => {
    const m = memoryStore();
    const d = mixedData();
    d.closet.forEach(i => { const { id, ...rest } = i; m.data['users/u/closet'][id] = rest; });
    Object.entries(d.schedule).forEach(([date, outfits]) => { m.data['users/u/schedule'][date] = { outfits: J(outfits), itemIds: [] }; });
    await m.Store.removeDemoData();
    const lastSchedule = m.log.map(l => l[1]).map((x, i) => [x, i]).filter(([x]) => typeof x === 'string' && x.includes('/schedule/')).pop()[1];
    const batchAt = m.log.findIndex(l => l[0] === 'batch');
    assert(batchAt > lastSchedule, 'plans were fixed before the pieces were deleted');
});
check('Store.removeDemoData on a closet with no demo pieces changes nothing', async () => {
    const m = memoryStore();
    m.data['users/u/closet'].item_a = { name: 'A', category: 'tops' };
    m.data['users/u/schedule']['2026-11-05'] = { outfits: [{ id: 'o', label: '', itemIds: ['item_a'] }], itemIds: ['item_a'] };
    const counts = await m.Store.removeDemoData();
    assert.strictEqual(counts.pieces, 0);
    assert.deepStrictEqual(m.log, []);
    assert.deepStrictEqual(Object.keys(m.data['users/u/closet']), ['item_a']);
});
check('Store.addClosetItems writes all the pieces in ONE batch (all or none)', async () => {
    const m = memoryStore();
    await m.Store.addClosetItems(S.makeDemoItems());
    assert.deepStrictEqual(m.log, [['batch', S.DEMO_PIECES.length]]);
    assert.strictEqual(Object.keys(m.data['users/u/closet']).length, S.DEMO_PIECES.length);
    assert.strictEqual(m.data['users/u/closet'].demo_tee.demo, true);
});
check('Store.markFirstRunSeen merges just the two marks and cannot overwrite the other settings', async () => {
    const m = memoryStore();
    m.data['users/u/settings'].prefs = { weekStart: 'mon', tempUnit: 'C', hebrewCalendarEnabled: false };
    await m.Store.markFirstRunSeen();
    assert.deepStrictEqual(J(m.data['users/u/settings'].prefs), { weekStart: 'mon', tempUnit: 'C', hebrewCalendarEnabled: false, firstRunSeen: true, welcomeSeen: true });
    assert(!('firstRunSeen' in m.Store.PREF_DEFAULTS), 'never seen must be tellable from seen');
});
check('the live listeners say whether an answer came from the server (the loading guard depends on it)', async () => {
    const calls = [];
    const win = { Firebase: { db: {}, dbFns: { collection: () => ({}), onSnapshot: (c, cb) => { cb({ metadata: { fromCache: true }, docs: [] }); cb({ metadata: { fromCache: false }, docs: [] }); cb({ docs: [] }); } } }, addEventListener() {} };
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setTimeout });
    vm.runInContext(read('js/state.js') + '\nthis.Store = Store;', ctx);
    ctx.Store.setUid('u');
    ctx.Store.onClosetChange((items, meta) => calls.push(meta.fromCache));
    await tick(); await tick();
    assert.deepStrictEqual(calls, [true, false, undefined]);
});

// ================= the page =================
const html = read('index.html');
check('the page has the setup window, its four steps, two Demo banners and the offer bar', () => {
    for (const id of ['first-run-modal', 'first-run-title', 'first-run-choose', 'first-run-starter', 'first-run-ready', 'first-run-missing', 'first-run-starter-btn', 'first-run-demo-btn', 'first-run-photos-btn', 'first-run-skip-btn', 'starter-rows', 'starter-add-row-btn', 'starter-save-btn', 'starter-back-btn', 'first-run-help-btn', 'first-run-notnow-btn', 'first-run-add-more-btn', 'first-run-close-btn', 'first-run-offer', 'first-run-offer-btn', 'first-run-offer-dismiss-btn', 'wear-demo-note'])
        assert(html.includes(`id="${id}"`), id);
    assert.strictEqual((html.match(/data-demo-banner/g) || []).length, 2, 'one in the Planner, one in the Closet');
    assert.strictEqual((html.match(/data-first-run="remove-demo"/g) || []).length, 2);
    assert(/id="first-run-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="first-run-title"/.test(html));
});
check('it is skippable from the first screen, and says the pieces and photos are optional and 5-8 is a suggestion', () => {
    assert(/id="first-run-skip-btn"[^>]*>Skip for now</.test(html));
    assert(/Photos are optional/.test(html) && /About 5&ndash;8 pieces gives good ideas, but any number works/.test(html));
    assert(/Nothing here is required/.test(html));
});
check('the scripts are on the page, in an order that works, and cached for offline', () => {
    const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
    const at = (f) => { assert(scripts.includes(f), f); return scripts.indexOf(f); };
    assert(at('js/starter-closet.js') < at('js/closet.js'));
    assert(at('js/outfit-suggest.js') < at('js/help-choose.js') && at('js/help-choose.js') < at('js/first-run.js'));
    assert(at('js/first-run.js') < at('js/app.js'));
    const sw = read('sw.js');
    assert(sw.includes("'js/starter-closet.js'") && sw.includes("'js/first-run.js'"));
});
check('the app gives the first-run setup both the settings and the closet answers (and its "from the server" flag)', () => {
    assert(/FirstRun\.notePrefs\(prefs, meta\)/.test(read('js/app.js')));
    assert(/async function applyPrefs\(prefs, meta\)/.test(read('js/app.js')));
    assert(!/Welcome\.consider\(prefs\)/.test(read('js/app.js')), 'the welcome card is decided by the setup now');
    assert(/FirstRun\.noteCloset\(closet, meta\)/.test(read('js/closet.js')));
});
check('clearing the closet from Settings records the setup as seen first, so it is never pushed on someone who did that on purpose', () => {
    const src = read('js/account.js');
    assert(src.indexOf('Store.markFirstRunSeen()') > 0 && src.indexOf('Store.markFirstRunSeen()') < src.indexOf('Store.clearClosetData()'));
});
check('the Closet shows a real empty state (with the three ways to start) only once the closet has loaded', () => {
    const src = read('js/closet.js');
    assert(/liveCloset\.length === 0 && closetLoaded/.test(src));
    assert(/closetLoaded = !\(meta && meta\.fromCache === true\)/.test(src));
    for (const k of ['starter', 'demo', 'photos']) assert(src.includes(`data-first-run="${k}"`));
});
check('demo pieces are labeled in the closet, the planner, the picker, the builder and the ideas', () => {
    assert(/badge-demo/.test(read('js/closet.js')) && /item\.demo === true \? 'Demo'/.test(read('js/closet.js')));
    const cal = read('js/calendar.js');
    assert(/function demoBadge\(\)/.test(cal) && /row\.appendChild\(demoBadge\(\)\)/.test(cal) && /'Demo · '/.test(cal));
    assert(/choose-demo/.test(read('js/help-choose.js')) && /demoBadge\(\)/.test(read('js/help-choose.js')));
    assert(/\.badge-demo/.test(read('css/components.css')));
});
check('the visual check never sends a demo piece or a drawing: there is no photo to send', async () => {
    let touched = 0;
    const doc = { createElement: () => { touched++; return {}; } };
    class Img { constructor() { touched++; } }
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, document: doc, Image: Img });
    vm.runInContext(read('js/outfit-vision.js') + '\nthis.shrinkPhoto = shrinkPhoto;', ctx);
    assert.strictEqual(await ctx.shrinkPhoto({ id: 'demo_tee', demo: true, image: S.placeholderImage({ category: 'tops', color: '#222222', demo: true }) }), null);
    assert.strictEqual(await ctx.shrinkPhoto({ id: 'x', noPhoto: true, image: S.placeholderImage({ category: 'tops', color: '#222222' }) }), null);
    assert.strictEqual(touched, 0, 'nothing was drawn or loaded');
});
check('the setup writes nothing of its own to the schedule or saved outfits, and adds no network call or paid service', () => {
    const src = read('js/first-run.js') + read('js/starter-closet.js');
    assert(!/setScheduleOutfits|addSavedOutfit|deleteSavedOutfit|deleteClosetItem/.test(src), 'plans and saved outfits are only touched by the one cleanup action in Store');
    assert(!/fetch\(|XMLHttpRequest|httpsCallable|import\(/.test(src), 'client-side only');
});
check('what other people\'s pieces looked like is not changed: demo and starter pieces are ordinary closet documents', () => {
    const rules = read('firestore.rules');
    assert(/match \/users\/\{uid\}\/\{document=\*\*\}/.test(rules), 'the existing per-user rule already covers them: no rules change is needed');
});

done();
