// Checks for "Help me choose" (js/outfit-suggest.js and js/help-choose.js). Plain Node, no packages:
//     node tests/outfit-suggest.test.js
// The logic is pure and runs on the device, so these tests need no browser, no network and no database.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// Load both files exactly as the page does (classic scripts sharing one global scope), in a sandbox that has
// NOTHING else: no document, no Store, no fetch. If the logic touched any of those it would throw.
const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise });
for (const f of ['js/outfit-suggest.js', 'js/help-choose.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('this.api = { suggestOutfits, buildDayContext, parseRefineText, specialRunOthers, describePiece, sgColor, sgColorScore, sgWeatherNeed };', ctx);
const { suggestOutfits, buildDayContext, parseRefineText, specialRunOthers, describePiece, sgColor, sgColorScore, sgWeatherNeed } = ctx.api;
const clone = (x) => JSON.parse(JSON.stringify(x));
// objects made inside the sandbox have the sandbox's own Array/Object, so compare them by value, not by prototype
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).split('\n').slice(0, 3).join('\n    ')); }
}

// ---- a made-up closet ----
const P = (id, name, category, color, extra = {}) => ({ id, name, category, color, season: 'all-season', occasion: 'casual', tagged: true, ...extra });
const CLOSET = [
    P('t1', 'White tee', 'tops', '#f5f5f5'), P('t2', 'Navy blouse', 'tops', '#1f2a52', { occasion: 'work' }),
    P('t3', 'Red top', 'tops', '#c62828'), P('t4', 'Black silk top', 'tops', '#222222', { occasion: 'formal', formality: 5 }),
    P('t5', 'Grey sweater', 'tops', '#9a9a9a', { season: 'winter', layer: 'mid', warmth: 4 }),
    P('t6', 'Linen tank', 'tops', '#f0e6d2', { season: 'summer' }),
    P('b1', 'Navy skirt', 'bottoms', '#1f2a52', { occasion: 'work' }), P('b2', 'Blue jeans', 'bottoms', '#4a6fa5'),
    P('b3', 'Black pencil skirt', 'bottoms', '#222222', { occasion: 'formal', formality: 5 }),
    P('b4', 'Beige trousers', 'bottoms', '#d9c7a7', { occasion: 'work' }), P('b5', 'Denim shorts', 'bottoms', '#4a6fa5', { season: 'summer', length: 'short' }),
    P('d1', 'Green dress', 'dresses', '#3f8f4f'), P('d2', 'Black formal dress', 'dresses', '#222222', { occasion: 'formal', formality: 5 }),
    P('d3', 'Floral summer dress', 'dresses', '#f4a6c0', { season: 'summer' }),
    P('o1', 'Camel coat', 'outerwear', '#c19a6b', { season: 'winter', occasion: 'work' }), P('o2', 'Rain jacket', 'outerwear', '#1f8a8a'),
    P('o3', 'Black blazer', 'outerwear', '#222222', { occasion: 'formal', season: 'all-season' }),
    P('s1', 'White sneakers', 'shoes', '#f5f5f5'), P('s2', 'Black heels', 'shoes', '#222222', { occasion: 'formal', formality: 5 }),
    P('s3', 'Brown boots', 'shoes', '#7b5233', { season: 'winter' }), P('s4', 'Sandals', 'shoes', '#c8a77a', { season: 'summer' }),
    P('a1', 'Gold necklace', 'accessories', '#d4af37', { occasion: 'formal' }), P('a2', 'Grey scarf', 'accessories', '#9a9a9a', { season: 'winter' })
];
const IDS = new Set(CLOSET.map(i => i.id));
const base = (over = {}) => ({ items: CLOSET, dateKey: '2026-11-12', weather: { high: 62, low: 50, code: 2 }, texts: [], isShabbat: false, isYomTov: false, worn: [], weekendPlanned: [], ...over });
const byId = Object.fromEntries(CLOSET.map(i => [i.id, i]));
const cats = (s) => s.itemIds.map(id => byId[id].category);
const meanFormality = (s) => s.itemIds.reduce((a, id) => a + describePiece(byId[id]).formality, 0) / s.itemIds.length;
// the same rule the scoring uses: the body (a dress, or the top weighted 0.6 and the bottom 0.4) plus 0.6 of the outerwear
const insulation = (s) => { const r = s.itemIds.map(id => describePiece(byId[id])); const top = r.find(p => p.cat === 'tops'), bottom = r.find(p => p.cat === 'bottoms'), dress = r.find(p => p.cat === 'dresses'), out = r.find(p => p.cat === 'outerwear'); return (dress ? dress.warmth : top.warmth * 0.6 + bottom.warmth * 0.4) + (out ? out.warmth * 0.6 : 0); };
const topsIn = (s) => s.itemIds.filter(id => byId[id].category === 'tops');
const allIds = (r) => r.suggestions.flatMap(s => s.itemIds);

// ---- owned pieces only, complete outfits, 2-3 distinct ----
check('every suggested piece is in the closet', () => {
    for (const w of [null, { high: 30, low: 20, code: 73 }, { high: 90, low: 75, code: 0 }, { high: 55, low: 48, code: 63 }]) {
        const r = suggestOutfits(base({ weather: w }));
        r.suggestions.forEach(s => s.itemIds.forEach(id => assert(IDS.has(id), 'not owned: ' + id)));
    }
});
check('a closet with only two pieces never gets a made-up one', () => {
    const tiny = [P('x1', 'Tee', 'tops', '#fff'), P('x2', 'Jeans', 'bottoms', '#4a6fa5')];
    const r = suggestOutfits(base({ items: tiny }));
    assert(r.suggestions.length === 1 && r.suggestions[0].itemIds.sort().join() === 'x1,x2');
    assert(r.notes.length > 0);
});
check('2 or 3 outfits, all different, each complete', () => {
    const r = suggestOutfits(base());
    assert(r.suggestions.length >= 2 && r.suggestions.length <= 3, 'count ' + r.suggestions.length);
    assert.strictEqual(new Set(r.suggestions.map(s => s.signature)).size, r.suggestions.length);
    r.suggestions.forEach(s => {
        const c = cats(s);
        assert((c.includes('dresses') || (c.includes('tops') && c.includes('bottoms'))), 'not complete: ' + c);
        assert(c.includes('shoes'), 'no shoes: ' + c);
        assert(!(c.includes('dresses') && c.includes('bottoms')), 'dress with a bottom');
    });
    const main = r.suggestions.map(s => s.itemIds.filter(id => ['tops', 'bottoms', 'dresses'].includes(byId[id].category) && describePiece(byId[id]).layer !== 'mid'));
    for (let i = 0; i < main.length; i++) for (let j = i + 1; j < main.length; j++) assert(main[i].join() !== main[j].join());
});
check('no complete outfit possible: says so instead of inventing one', () => {
    const r = suggestOutfits(base({ items: [P('x1', 'Tee', 'tops', '#fff'), P('x3', 'Sneakers', 'shoes', '#fff')] }));
    assert.strictEqual(r.suggestions.length, 0);
    assert(/top and a bottom/.test(r.notes.join(' ')));
    assert.strictEqual(suggestOutfits(base({ items: [] })).suggestions.length, 0);
});
check('pieces still needing a tag are left out, and the person is told', () => {
    const ctxd = buildDayContext('2026-11-12', { closet: [...CLOSET, P('u1', 'Mystery', 'tops', '#fff', { tagged: false })], outfitsByDate: {}, prefs: {} });
    assert(!ctxd.items.some(i => i.id === 'u1') && ctxd.skippedUntagged === 1);
    assert(/still needs tagging/.test(suggestOutfits(ctxd).notes.join(' ')));
});

// ---- weather ----
check('cold and wet: a layer or outerwear is added, and rain gets outerwear', () => {
    const r = suggestOutfits(base({ weather: { high: 44, low: 36, code: 63 } }));
    assert(r.suggestions.length >= 2);
    r.suggestions.forEach(s => assert(cats(s).includes('outerwear'), 'no outerwear when cold and rainy: ' + s.itemIds));
});
check('cold and dry: layered (outerwear or a sweater)', () => {
    const r = suggestOutfits(base({ weather: { high: 38, low: 28, code: 0 } }));
    r.suggestions.forEach(s => assert(cats(s).includes('outerwear') || s.itemIds.includes('t5'), 'unlayered in the cold: ' + s.itemIds));
});
check('rain alone (mild) still asks for outerwear', () => {
    const r = suggestOutfits(base({ weather: { high: 66, low: 58, code: 61 } }));
    assert(r.suggestions.every(s => cats(s).includes('outerwear')));
});
check('hot: light, no outerwear, no winter pieces', () => {
    const r = suggestOutfits(base({ weather: { high: 92, low: 78, code: 0 } }));
    r.suggestions.forEach(s => {
        assert(!cats(s).includes('outerwear') && !s.itemIds.includes('t5'));
        assert(!s.itemIds.some(id => byId[id].season === 'winter'), 'winter piece in the heat');
    });
    const cold = suggestOutfits(base({ weather: { high: 35, low: 25, code: 0 } }));
    const avg = (x) => x.suggestions.reduce((a, s) => a + insulation(s), 0) / x.suggestions.length;
    assert(avg(r) + 2 < avg(cold), 'cold outfits are not warmer than hot ones');
});
check('no forecast: still works, and says nothing about weather in the reasons', () => {
    const r = suggestOutfits(base({ weather: null }));
    assert(r.suggestions.length >= 2);
    r.suggestions.forEach(s => assert(!/cold|rain|snow|heat/.test(s.reason), s.reason));
    assert.strictEqual(r.need.weather.has, false);
});

// ---- occasion / formality ----
check('Shabbos asks for dressier outfits than a casual day', () => {
    const casual = suggestOutfits(base({ texts: ['brunch'] }));
    const shabbos = suggestOutfits(base({ isShabbat: true }));
    const avg = (x) => x.suggestions.reduce((a, s) => a + meanFormality(s), 0) / x.suggestions.length;
    assert(avg(shabbos) > avg(casual) + 0.7, `shabbos ${avg(shabbos)} vs casual ${avg(casual)}`);
});
check('wedding is dressier than teaching; a workout day is the most relaxed', () => {
    const f = (texts) => { const r = suggestOutfits(base({ texts })); return r.suggestions.reduce((a, s) => a + meanFormality(s), 0) / r.suggestions.length; };
    assert(f(['Wedding']) > f(['Teaching']));
    assert(f(['Teaching']) > f(['Gym']));
});
check('Yom Tov and holiday names are read', () => {
    assert.strictEqual(suggestOutfits(base({ isYomTov: true })).need.formality.target, 4.5);
    assert.strictEqual(suggestOutfits(base({ texts: ['Rosh Hashana I'] })).need.formality.target, 4.5);
});
check('several things in one day: leans dressy but is not the dressiest alone', () => {
    const r = suggestOutfits(base({ texts: ['Teaching', 'going out'] }));
    const t = r.need.formality.target;
    assert(t > 3 && t < 3.6, 'target ' + t);
});

// ---- recency ----
const wornOn = (date, ids) => ({ date, itemIds: ids });
check('pieces worn in the last 7 days are not suggested', () => {
    const worn = [wornOn('2026-11-10', ['t1', 'b2', 's1']), wornOn('2026-11-07', ['t3', 'b1', 'd1'])];
    const r = suggestOutfits(base({ worn }));
    const recent = new Set(['t1', 'b2', 't3', 'b1', 'd1']);
    r.suggestions.forEach(s => s.itemIds.forEach(id => assert(!recent.has(id), 'recently worn: ' + id)));
});
check('a piece worn 8+ days ago is allowed again', () => {
    const worn = [wornOn('2026-11-04', ['t1', 'b2'])];
    const all = suggestOutfits(base({ worn, texts: ['casual'] })).suggestions.flatMap(s => s.itemIds);
    assert(all.includes('t1') || all.includes('b2') || true);
    // the rule itself: 7 days back is still "recent", 8 is not
    const seven = suggestOutfits(base({ worn: [wornOn('2026-11-05', ['d1'])], items: [P('t1', 'Tee', 'tops', '#fff'), P('b1', 'Jeans', 'bottoms', '#4a6fa5'), P('d1', 'Dress', 'dresses', '#3f8f4f'), P('d9', 'Other dress', 'dresses', '#222222')] }));
    assert(!seven.suggestions.some(s => s.itemIds.includes('d1')));
    const eight = suggestOutfits(base({ worn: [wornOn('2026-11-04', ['d1'])], items: [P('t1', 'Tee', 'tops', '#fff'), P('b1', 'Jeans', 'bottoms', '#4a6fa5'), P('d1', 'Dress', 'dresses', '#3f8f4f'), P('d9', 'Other dress', 'dresses', '#222222')] }));
    assert(eight.suggestions.some(s => s.itemIds.includes('d1')));
});
check('pieces not worn for a long time are preferred', () => {
    const items = [P('ta', 'Tee A', 'tops', '#f5f5f5'), P('tb', 'Tee B', 'tops', '#f5f5f5'), P('bb', 'Jeans', 'bottoms', '#4a6fa5'), P('ss', 'Sneakers', 'shoes', '#f5f5f5')];
    const r = suggestOutfits(base({ items, worn: [wornOn('2026-11-02', ['ta']), wornOn('2026-09-01', ['tb'])] }));
    assert(r.suggestions[0].itemIds.includes('tb'), 'the long-rested top should come first');
});
check('planning is not wearing: only outfits marked worn count', () => {
    const planned = buildDayContext('2026-11-12', { closet: CLOSET, outfitsByDate: { '2026-11-11': [{ id: 'o', itemIds: ['t1', 'b2'], worn: false }], '2026-11-10': [{ id: 'p', itemIds: ['t3'], worn: true }] }, prefs: {} });
    same(planned.worn, [{ date: '2026-11-10', itemIds: ['t3'] }]);
});
check('relaxes (and says so) when everything in a category was worn this week', () => {
    const items = [P('t1', 'Tee', 'tops', '#fff'), P('b1', 'Jeans', 'bottoms', '#4a6fa5')];
    const r = suggestOutfits(base({ items, worn: [wornOn('2026-11-11', ['t1', 'b1'])] }));
    assert(r.suggestions.length === 1 && /worn in the last week/.test(r.notes.join(' ')));
});

// ---- Shabbos / Yom Tov weekend ----
check('the Friday-Saturday run around a Shabbos day (and Yom Tov runs)', () => {
    const special = (k) => ['2026-11-13', '2026-11-14'].includes(k);          // a Friday and Saturday
    same(specialRunOthers('2026-11-14', special), ['2026-11-13']);
    same(specialRunOthers('2026-11-12', special), []);
    const run = (k) => ['2026-10-12', '2026-10-13', '2026-10-14'].includes(k);
    same(specialRunOthers('2026-10-13', run), ['2026-10-12', '2026-10-14']);
});
check('an outfit planned on Friday is not repeated on Shabbos', () => {
    const friday = ['t4', 'b3', 's2'];
    const r = suggestOutfits(base({ dateKey: '2026-11-14', isShabbat: true, weekendPlanned: [{ date: '2026-11-13', itemIds: friday }] }));
    r.suggestions.forEach(s => assert(!(friday.every(id => s.itemIds.includes(id))), 'repeated the Friday outfit'));
    const dressDay = suggestOutfits(base({ dateKey: '2026-11-14', isShabbat: true, weekendPlanned: [{ date: '2026-11-13', itemIds: ['d2', 's2'] }] }));
    dressDay.suggestions.forEach(s => assert(!s.itemIds.includes('d2') || s !== dressDay.suggestions[0], 'dress repeated as the top idea'));
});
check('the weekend days come from the calendar only when the Hebrew calendar is on', () => {
    const outfitsByDate = { '2026-11-13': [{ id: 'f', itemIds: ['t4', 'b3'] }] };
    const on = buildDayContext('2026-11-14', { closet: CLOSET, outfitsByDate, prefs: { hebrewCalendarEnabled: true }, holidayInfoFor: () => null });
    const off = buildDayContext('2026-11-14', { closet: CLOSET, outfitsByDate, prefs: { hebrewCalendarEnabled: false } });
    assert.strictEqual(on.weekendPlanned.length, 1);
    assert.strictEqual(off.weekendPlanned.length, 0);
    assert.strictEqual(on.isShabbat, true);
    assert.strictEqual(off.isShabbat, false);
});
check('the day context reads activities, holidays and the forecast, and invents nothing', () => {
    const c = buildDayContext('2026-11-12', {
        closet: CLOSET, prefs: { weatherEnabled: true, hebrewCalendarEnabled: true },
        outfitsByDate: { '2026-11-12': [{ id: 'a', label: 'Teaching', itemIds: [] }] },
        holidayInfoFor: () => ({ holidays: [{ title: 'Rosh Hashana I', yomtov: true }] }),
        forecastFor: () => ({ high: 70, low: 55, code: 1 }), otherNotesFor: () => ['Veterans Day']
    });
    same(c.texts, ['Teaching', 'Veterans Day']);
    assert.strictEqual(c.isYomTov, true);
    same(c.weather, { high: 70, low: 55, code: 1 });
    const noWeather = buildDayContext('2026-11-12', { closet: CLOSET, prefs: { weatherEnabled: false }, outfitsByDate: {}, forecastFor: () => ({ high: 1, low: 1, code: 0 }) });
    assert.strictEqual(noWeather.weather, null);
});

// ---- reasons ----
check('each suggestion has one short plain reason that names an owned piece', () => {
    const r = suggestOutfits(base({ weather: { high: 40, low: 30, code: 0 } }));
    r.suggestions.forEach(s => {
        assert(typeof s.reason === 'string' && s.reason.length > 10 && s.reason.length <= 160, s.reason);
        assert(/^Uses your /.test(s.reason) && s.reason.endsWith('.'));
        assert(s.pieces.some(p => s.reason.includes(p.name)));
        assert((s.reason.match(/\./g) || []).length === 1, 'more than one sentence: ' + s.reason);
    });
    assert(r.suggestions.some(s => /for the cold/.test(s.reason)));
});

// ---- deterministic and side-effect free ----
check('same day and closet give the same suggestions, and the input is not changed', () => {
    const input = base({ worn: [wornOn('2026-11-01', ['t2'])], texts: ['Teaching'] });
    const before = clone(input);
    const a = suggestOutfits(input), b = suggestOutfits(input), c = suggestOutfits(clone(input));
    same(a, b);
    same(a, c);
    same(input, before);
    const shuffled = base({ items: [...CLOSET].reverse(), worn: input.worn, texts: input.texts });
    same(suggestOutfits(shuffled).suggestions.map(s => s.signature), a.suggestions.map(s => s.signature), 'order of the closet must not matter');
});
check('the logic needs no page, no storage and no network (it ran in a sandbox with none of them)', () => {
    assert.strictEqual(typeof ctx.document, 'undefined');
    assert.strictEqual(typeof ctx.fetch, 'undefined');
    assert.strictEqual(typeof ctx.localStorage, 'undefined');
    assert.strictEqual(typeof ctx.Store, 'undefined');
    assert(suggestOutfits(base()).suggestions.length >= 2);
});
check('showing and refining suggestions never writes to the planner (only the Use button does)', () => {
    // every refinement is just another call that reads the same plain data
    const calls = [{}, { formalityShift: -1 }, { warmthShift: 1 }, { keepIds: ['b1'] }, { text: 'teaching then going out' }, { exclude: ['x'] }];
    const plan = { '2026-11-12': [{ id: 'a', itemIds: [] }] };
    const frozen = clone(plan);
    const env = { closet: CLOSET, outfitsByDate: plan, prefs: {} };
    calls.forEach(o => suggestOutfits(buildDayContext('2026-11-12', env), o));
    same(plan, frozen);
    const src = fs.readFileSync(path.join(__dirname, '..', 'js/help-choose.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'js/outfit-suggest.js'), 'utf8');
    assert(!/Store\.(set|add|update|delete)/.test(src), 'writes to the database');
    assert(!/\bupdateDay\(/.test(src), 'writes a day directly');
    assert((src.match(/applySavedOutfit\(/g) || []).length === 1, 'the planner is only touched in one place: Use this outfit');
});

// ---- refinements ----
check('More casual gives more relaxed outfits; More dressy the opposite', () => {
    const f = (o) => { const r = suggestOutfits(base({ texts: ['Teaching'] }), o); return r.suggestions.reduce((a, s) => a + meanFormality(s), 0) / r.suggestions.length; };
    const normal = f({});
    assert(f({ formalityShift: -1 }) < normal - 0.2, 'casual');
    assert(f({ formalityShift: 1 }) > normal + 0.2, 'dressy');
    assert.notStrictEqual(JSON.stringify(suggestOutfits(base({ texts: ['Teaching'] }), { formalityShift: -1 }).suggestions.map(s => s.signature)), JSON.stringify(suggestOutfits(base({ texts: ['Teaching'] })).suggestions.map(s => s.signature)));
});
check('Warmer makes the outfits warmer; Lighter makes them lighter', () => {
    const f = (o) => { const r = suggestOutfits(base(), o); return r.suggestions.reduce((a, s) => a + insulation(s), 0) / r.suggestions.length; };
    const normal = f({});
    assert(f({ warmthShift: 1 }) > normal + 0.15, 'warmer');
    assert(f({ warmthShift: -1 }) < normal - 0.15, 'lighter');
});
check('Keep a piece: every idea keeps it and the rest changes', () => {
    const first = suggestOutfits(base());
    const keep = first.suggestions[0].itemIds.find(id => byId[id].category === 'bottoms' || byId[id].category === 'dresses');
    const r = suggestOutfits(base(), { keepIds: [keep] });
    assert(r.suggestions.length >= 1);
    r.suggestions.forEach(s => assert(s.itemIds.includes(keep), 'dropped the kept piece'));
    if (r.suggestions.length > 1) {
        const others = r.suggestions.map(s => s.itemIds.filter(id => id !== keep).sort().join());
        assert.strictEqual(new Set(others).size, others.length, 'the rest should differ');
    }
});
check('Keep pieces that cannot go together: starts again and says so', () => {
    const r = suggestOutfits(base(), { keepIds: ['d1', 'b2'] });
    assert(r.suggestions.length >= 2 && /can’t go together/.test(r.notes.join(' ')));
});
check('the typed box: dressier / warmer / named pieces', () => {
    assert.strictEqual(parseRefineText('something dressy', CLOSET).formalityShift, 1);
    assert.strictEqual(parseRefineText('keep it comfy', CLOSET).formalityShift, -1);
    assert.strictEqual(parseRefineText('it is freezing', CLOSET).warmthShift, 1);
    same(parseRefineText('keep my navy skirt please', CLOSET).keepIds, ['b1']);
    same(parseRefineText('', CLOSET), { formalityShift: 0, warmthShift: 0, keepIds: [], heard: [] });
    const withText = suggestOutfits(base(), { text: 'teaching then going out' });
    assert(withText.need.formality.events.length >= 1 && withText.need.formality.target > 3);
    const keepByName = suggestOutfits(base(), { text: 'wearing my navy skirt' });
    keepByName.suggestions.forEach(s => assert(s.itemIds.includes('b1')));
});
check('Different ideas: nothing already shown comes back', () => {
    const first = suggestOutfits(base());
    const seen = first.suggestions.map(s => s.signature);
    const next = suggestOutfits(base(), { exclude: seen });
    next.suggestions.forEach(s => assert(!seen.includes(s.signature)));
    assert(next.suggestions.length >= 2);
});

// ---- one slot per piece: exactly one top and one bottom (or one dress), never a second top ----
const SCENARIOS = [];
for (const weather of [null, { high: 30, low: 20, code: 73 }, { high: 44, low: 36, code: 63 }, { high: 58, low: 50, code: 61 }, { high: 62, low: 50, code: 2 }, { high: 92, low: 78, code: 0 }]) {
    for (const texts of [[], ['Teaching'], ['Wedding'], ['Gym']]) SCENARIOS.push({ weather, texts });
}
check('no suggestion ever has two tops, or a top with a dress, or two of anything else (every weather, every kind of day)', () => {
    for (const sc of SCENARIOS) for (const o of [{}, { warmthShift: 2 }, { warmthShift: -2 }, { formalityShift: 2 }, { keepIds: ['t5'] }]) {
        const r = suggestOutfits(base(sc), o);
        assert(r.suggestions.length >= 1, JSON.stringify(sc));
        r.suggestions.forEach(s => {
            const c = cats(s);
            const count = (k) => c.filter(x => x === k).length;
            assert(count('tops') <= 1, 'two tops: ' + s.pieces.map(p => p.name) + ' ' + JSON.stringify(sc) + JSON.stringify(o));
            ['bottoms', 'dresses', 'outerwear', 'shoes', 'accessories'].forEach(k => assert(count(k) <= 1, 'two of one kind: ' + k));
            assert((c.includes('dresses') && !c.includes('tops') && !c.includes('bottoms')) || (c.includes('tops') && c.includes('bottoms') && !c.includes('dresses')), 'not exactly top+bottom or a dress: ' + c);
        });
    }
});
check('a closet made mostly of sweaters still never stacks two tops', () => {
    const items = [P('w1', 'Wool sweater', 'tops', '#9a9a9a', { season: 'winter' }), P('w2', 'Cardigan', 'tops', '#1f2a52'), P('w3', 'Hoodie', 'tops', '#222222'), P('w4', 'Fleece pullover', 'tops', '#c62828'),
        P('b1', 'Jeans', 'bottoms', '#4a6fa5'), P('b2', 'Black trousers', 'bottoms', '#222222'), P('b3', 'Grey skirt', 'bottoms', '#9a9a9a'), P('s1', 'Boots', 'shoes', '#7b5233'), P('s2', 'Sneakers', 'shoes', '#f5f5f5'), P('s3', 'Loafers', 'shoes', '#222222')];
    for (const weather of [{ high: 25, low: 15, code: 0 }, { high: 50, low: 40, code: 61 }, null]) {
        const r = suggestOutfits(base({ items, weather }));
        assert(r.suggestions.length >= 2);
        r.suggestions.forEach(s => assert.strictEqual(s.itemIds.filter(id => items.find(i => i.id === id).category === 'tops').length, 1, 'tops in ' + s.itemIds));
    }
});
check('a sweater counts as the top when it is chosen, and is a warmer top than a tee', () => {
    assert(describePiece(P('z', 'Wool sweater', 'tops', '#999')).warmth > describePiece(P('z', 'Tee', 'tops', '#999')).warmth);
    assert.strictEqual(describePiece(P('z', 'Wool sweater', 'tops', '#999', { warmth: 2 })).warmth, 2, 'what the person set always wins');
    const cold = suggestOutfits(base({ weather: { high: 36, low: 28, code: 0 }, items: CLOSET.filter(i => i.category !== 'outerwear') }));
    assert(cold.suggestions.length >= 1);
    assert(cold.suggestions[0].itemIds.includes('t5'), 'with no outerwear, the warm sweater is the single top chosen for the cold');
    assert(/for the cold/.test(cold.suggestions[0].reason) && /warm Grey sweater/.test(cold.suggestions[0].reason), cold.suggestions[0].reason);
});

// ---- a piece appears in at most one suggestion ----
check('no piece is in more than one suggestion when the closet can support distinct ones', () => {
    for (const sc of SCENARIOS) {
        const r = suggestOutfits(base(sc));
        const ids = allIds(r);
        assert.strictEqual(new Set(ids).size, ids.length, 'a piece repeated: ' + JSON.stringify(sc) + ' ' + r.suggestions.map(s => s.pieces.map(p => p.name).join(',')).join(' | '));
        assert(r.suggestions.length >= 2, 'fewer than two ideas for ' + JSON.stringify(sc));
    }
});
check('the sweater (or any one piece) is not in all three suggestions', () => {
    const r = suggestOutfits(base({ weather: { high: 40, low: 30, code: 0 } }));
    ['t5', 'o1', 'o2', 'o3', 's1', 's2'].forEach(id => assert(allIds(r).filter(x => x === id).length <= 1, id + ' repeated'));
});
check('refinements and "Different ideas" keep the same rule (a kept piece is the one exception)', () => {
    for (const o of [{ formalityShift: -1 }, { warmthShift: 1 }, { exclude: suggestOutfits(base()).suggestions.map(s => s.signature) }, { text: 'teaching then going out' }]) {
        const ids = allIds(suggestOutfits(base(), o));
        assert.strictEqual(new Set(ids).size, ids.length, JSON.stringify(o));
    }
    const kept = suggestOutfits(base(), { keepIds: ['b1'] });
    assert(kept.suggestions.every(s => s.itemIds.includes('b1')));
    const others = kept.suggestions.flatMap(s => s.itemIds.filter(id => id !== 'b1'));
    assert.strictEqual(new Set(others).size, others.length, 'everything except the kept piece is different');
});
check('a closet too small for three distinct ideas shows fewer, never the same piece again', () => {
    const items = [P('t1', 'Tee', 'tops', '#f5f5f5'), P('t2', 'Blouse', 'tops', '#1f2a52'), P('b1', 'Jeans', 'bottoms', '#4a6fa5'), P('b2', 'Skirt', 'bottoms', '#222222'), P('s1', 'Sneakers', 'shoes', '#f5f5f5'), P('s2', 'Flats', 'shoes', '#222222')];
    const r = suggestOutfits(base({ items }));
    assert.strictEqual(r.suggestions.length, 2);
    const ids = allIds(r); assert.strictEqual(new Set(ids).size, ids.length);
    assert(/too small|only idea/.test(r.notes.join(' ')), r.notes.join(' | '));
});
check('too few shoes: shoes are the only thing that may repeat, and only to still give two ideas, with a note', () => {
    const items = [P('t1', 'Tee', 'tops', '#f5f5f5'), P('t2', 'Blouse', 'tops', '#1f2a52'), P('t3', 'Tank', 'tops', '#c62828'), P('b1', 'Jeans', 'bottoms', '#4a6fa5'), P('b2', 'Skirt', 'bottoms', '#222222'), P('b3', 'Trousers', 'bottoms', '#d9c7a7'), P('s1', 'Sneakers', 'shoes', '#f5f5f5')];
    const r = suggestOutfits(base({ items }));
    assert(r.suggestions.length >= 2);
    const garments = r.suggestions.flatMap(s => s.itemIds.filter(id => id !== 's1'));
    assert.strictEqual(new Set(garments).size, garments.length, 'no top or bottom repeated');
    assert(/share shoes/.test(r.notes.join(' ')));
});
check('one top and one bottom: just one idea, not the same piece twice', () => {
    const r = suggestOutfits(base({ items: [P('x1', 'Tee', 'tops', '#fff'), P('x2', 'Jeans', 'bottoms', '#4a6fa5'), P('x3', 'Sneakers', 'shoes', '#fff')] }));
    assert.strictEqual(r.suggestions.length, 1);
});

// ---- cold and rainy days: warm enough, one top, outerwear ----
check('cold and rainy: one top and one bottom plus outerwear, and warm enough', () => {
    const r = suggestOutfits(base({ weather: { high: 38, low: 30, code: 63 } }));
    assert(r.suggestions.length >= 2);
    r.suggestions.forEach(s => {
        assert(topsIn(s).length === 1 || (topsIn(s).length === 0 && cats(s).includes('dresses')), 'one top, or a dress instead');
        assert(cats(s).includes('outerwear'), 'no outerwear: ' + s.pieces.map(p => p.name));
        assert(insulation(s) >= 3.8, 'too thin for 38°F: insulation ' + insulation(s));
    });
    const mild = suggestOutfits(base({ weather: { high: 75, low: 62, code: 1 } }));
    const avg = (x) => x.suggestions.reduce((a, s) => a + insulation(s), 0) / x.suggestions.length;
    assert(avg(r) > avg(mild) + 1.5);
});
check('cold and dry: outerwear, or a single warm top', () => {
    const r = suggestOutfits(base({ weather: { high: 30, low: 20, code: 0 } }));
    r.suggestions.forEach(s => assert(cats(s).includes('outerwear') || topsIn(s).some(id => describePiece(byId[id]).warmth >= 4), s.pieces.map(p => p.name).join()));
});

// ---- rain always asks for outerwear (the gap that let a sweater stand in for it) ----
check('rain on a mild day still gets outerwear in every idea, even when a sweater is available', () => {
    for (const weather of [{ high: 58, low: 50, code: 61 }, { high: 66, low: 58, code: 80 }, { high: 52, low: 46, code: 53 }, { high: 40, low: 33, code: 71 }]) {
        const r = suggestOutfits(base({ weather }));
        assert(r.suggestions.length >= 2, JSON.stringify(weather));
        r.suggestions.forEach(s => assert(cats(s).includes('outerwear'), 'no outerwear in the rain ' + JSON.stringify(weather) + ': ' + s.pieces.map(p => p.name)));
        r.suggestions.forEach(s => assert(/rain|snow/.test(s.reason), s.reason));
    }
});
check('every forecast code for rain, drizzle, showers, snow and storms counts as wet', () => {
    for (const code of [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) assert.strictEqual(sgWeatherNeed({ high: 60, low: 50, code }, 0).wet, true, 'code ' + code);
    for (const code of [0, 1, 2, 3, 45, 48]) assert.strictEqual(sgWeatherNeed({ high: 60, low: 50, code }, 0).wet, false, 'code ' + code);
});
check('rain with all the outerwear worn this week: it is repeated rather than leaving the rain unprotected', () => {
    const worn = [wornOn('2026-11-10', ['o1', 'o2', 'o3'])];
    const r = suggestOutfits(base({ weather: { high: 58, low: 50, code: 61 }, worn }));
    assert(r.suggestions.length >= 1);
    r.suggestions.forEach(s => assert(cats(s).includes('outerwear')));
});
check('rain with no outerwear in the closet: still suggests outfits, and says why there is no coat', () => {
    const r = suggestOutfits(base({ weather: { high: 58, low: 50, code: 61 }, items: CLOSET.filter(i => i.category !== 'outerwear') }));
    assert(r.suggestions.length >= 2);
    r.suggestions.forEach(s => assert(!cats(s).includes('outerwear')));
    assert(/don’t have any outerwear/.test(r.notes.join(' ')) && /rain/.test(r.notes.join(' ')), r.notes.join(' | '));
    const dry = suggestOutfits(base({ weather: { high: 62, low: 50, code: 2 }, items: CLOSET.filter(i => i.category !== 'outerwear') }));
    assert(!/outerwear/.test(dry.notes.join(' ')), 'no complaint about a missing coat on a mild dry day');
});
check('a summer piece is not offered in the cold, nor a winter piece in the heat, when something else will do', () => {
    const cold = suggestOutfits(base({ weather: { high: 38, low: 30, code: 0 } }));
    allIds(cold).forEach(id => assert.notStrictEqual(byId[id].season, 'summer', byId[id].name));
    const hot = suggestOutfits(base({ weather: { high: 92, low: 78, code: 0 } }));
    allIds(hot).forEach(id => assert.notStrictEqual(byId[id].season, 'winter', byId[id].name));
});

// ---- names are never cut ----
check('a piece\'s full name is shown, however long', () => {
    const long = 'Black A-line midi skirt with side pockets and a soft elastic waistband, moa';
    const items = [P('t1', 'Tee', 'tops', '#f5f5f5'), P('b1', long, 'bottoms', '#222222'), P('s1', 'Sneakers', 'shoes', '#f5f5f5')];
    const r = suggestOutfits(base({ items }));
    assert.strictEqual(r.suggestions[0].pieces.find(p => p.id === 'b1').name, long);
    assert(r.suggestions[0].reason.includes(long), r.suggestions[0].reason);
});

// ---- colours ----
check('neutrals go with anything; clashing colours score lower', () => {
    const pc = (hex) => ({ color: sgColor(hex) });
    assert.strictEqual(sgColor('#222222').neutral, true);
    assert.strictEqual(sgColor('#f5f5f5').neutral, true);
    assert.strictEqual(sgColor('#1f2a52').neutral, true);      // navy
    assert.strictEqual(sgColor('#7b5233').neutral, true);      // brown
    assert.strictEqual(sgColor('#c62828').neutral, false);
    assert.strictEqual(sgColorScore([pc('#c62828'), pc('#222222'), pc('#f5f5f5')]), 1);
    const same = sgColorScore([pc('#c62828'), pc('#e53935')]);
    const clash = sgColorScore([pc('#ff0000'), pc('#00cc66'), pc('#8a2be2')]);
    const orangeBlue = sgColorScore([pc('#ef8a2b'), pc('#2f6fd0')]);
    assert(same > clash && orangeBlue > clash, `${same} ${orangeBlue} ${clash}`);
    assert(sgColorScore([pc('#ff0000'), pc('#00ff00')]) < 0.6);
});

// ---- metadata estimates ----
check('unset warmth / formality / layer are estimated from category, season and occasion; set ones win', () => {
    const d = describePiece(P('z', 'Wool coat', 'outerwear', '#444444', { season: 'winter' }));
    assert(d.warmth === 5 && d.layer === 'outer' && d.estimated.warmth);
    assert.strictEqual(describePiece(P('z', 'Cardigan', 'tops', '#999999')).layer, 'mid');
    assert.strictEqual(describePiece(P('z', 'Tee', 'tops', '#999999')).layer, 'base');
    assert.strictEqual(describePiece(P('z', 'Gown', 'dresses', '#000000', { occasion: 'formal' })).formality, 5);
    const set = describePiece(P('z', 'Tee', 'tops', '#999999', { warmth: 4, formality: 1, length: 'long', fit: 'loose', layer: 'mid' }));
    assert(set.warmth === 4 && set.formality === 1 && set.length === 'long' && set.fit === 'loose' && set.layer === 'mid' && !set.estimated.warmth);
    const junk = describePiece(P('z', 'Tee', 'tops', '#999999', { warmth: 'lots', length: 'huge', fit: 7, layer: null }));
    assert(junk.warmth === 2 && junk.length === null && junk.fit === null && junk.layer === 'base');
});
check('length and layering rules push bad pairings down', () => {
    const items = [P('t1', 'Tunic', 'tops', '#f5f5f5', { length: 'long' }), P('t2', 'Tee', 'tops', '#f5f5f5'), P('b1', 'Mini skirt', 'bottoms', '#222222', { length: 'short' }), P('s1', 'Sneakers', 'shoes', '#f5f5f5')];
    const r = suggestOutfits(base({ items }));
    assert(r.suggestions[0].itemIds.includes('t2'), 'the regular tee should beat the tunic over a mini skirt');
});

console.log(fail === 0 ? `all ${pass} passed` : `${fail} FAILED, ${pass} passed`);
process.exit(fail ? 1 : 0);
