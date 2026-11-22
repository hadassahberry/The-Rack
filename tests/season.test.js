// Season and weight in "Help me choose" (js/outfit-suggest.js): a summer piece and a winter piece are never suggested together
// (a rule, explained when it leaves nothing), and a top and bottom of very different warmth are marked down.
// Plain Node, no packages: node tests/season.test.js
const { check, done, assert, read } = require('./_harness');
const S = require('../js/outfit-suggest.js');
const { suggestOutfits, describePiece, warmthBalance, warmthCheck, SUGGEST_WARMTH_GAP_PENALTY } = S;

const J = (x) => JSON.parse(JSON.stringify(x));
const P = (id, name, category, season, extra = {}) => ({ id, name, category, color: '#222222', occasion: 'casual', season, tagged: true, ...extra });
const run = (items, more = {}) => suggestOutfits({ items, dateKey: '2026-11-22', weather: null, texts: [], worn: [], weekendPlanned: [], ...more }, more.options);
const seasonsOf = (itemIds, items) => itemIds.map(id => items.find(i => i.id === id).season);
const mixesOpposites = (s, items) => { const x = seasonsOf(s.itemIds, items); return x.includes('summer') && x.includes('winter'); };

// a closet with every kind of piece in every season, so the rule has plenty to work on
const CLOSET = [
    P('t1', 'Linen tank', 'tops', 'summer'), P('t2', 'White tee', 'tops', 'all-season'), P('t3', 'Wool sweater', 'tops', 'winter'), P('t4', 'Silk blouse', 'tops', 'all-season', { occasion: 'work' }),
    P('b1', 'Denim shorts', 'bottoms', 'summer'), P('b2', 'Blue jeans', 'bottoms', 'all-season'), P('b3', 'Wool skirt', 'bottoms', 'winter'), P('b4', 'Linen pants', 'bottoms', 'summer'),
    P('d1', 'Sundress', 'dresses', 'summer'), P('d2', 'Knit dress', 'dresses', 'winter'), P('d3', 'Wrap dress', 'dresses', 'all-season'),
    P('o1', 'Camel coat', 'outerwear', 'winter'), P('o2', 'Denim jacket', 'outerwear', 'all-season'), P('o3', 'Light cardigan', 'outerwear', 'summer'),
    P('s1', 'Sandals', 'shoes', 'summer'), P('s2', 'Boots', 'shoes', 'winter'), P('s3', 'Sneakers', 'shoes', 'all-season'),
    P('a1', 'Straw hat', 'accessories', 'summer'), P('a2', 'Wool scarf', 'accessories', 'winter'), P('a3', 'Belt', 'accessories', 'all-season')
];

// ================= what counts as opposite =================
check('only summer and winter are opposites; all-season and any transitional season (spring, fall, autumn) mix with both', () => {
    for (const season of ['all-season', 'spring', 'fall', 'autumn', undefined, null, '', 'monsoon']) assert.strictEqual(describePiece(P('a', 'x', 'tops', season)).season, 'all-season', String(season));
    assert.strictEqual(describePiece(P('a', 'x', 'tops', 'summer')).season, 'summer');
    assert.strictEqual(describePiece(P('a', 'x', 'tops', 'winter')).season, 'winter');
});

// ================= the season rule =================
check('no suggestion ever pairs a summer piece with a winter piece, in any slot, in any weather, with any refinement', () => {
    const weathers = [null, { high: 85, low: 70, code: 0 }, { high: 40, low: 30, code: 71 }, { high: 60, low: 50, code: 61 }, { high: 62, low: 50, code: 2 }];
    const options = [{}, { formalityShift: 1 }, { formalityShift: -1 }, { warmthShift: 1 }, { warmthShift: -1 }, { max: 6 }, { exclude: [] }];
    let checked = 0;
    for (const weather of weathers) for (const o of options) {
        const r = run(CLOSET, { weather, options: o });
        assert(r.suggestions.length >= 1, JSON.stringify([weather, o]));
        r.suggestions.forEach(s => { assert(!mixesOpposites(s, CLOSET), `${s.pieces.map(p => p.name).join(', ')} in ${JSON.stringify([weather, o])}`); checked++; });
    }
    assert(checked >= 30);
});
check('the rule covers every slot: a winter coat over a summer dress, summer sandals with a winter skirt, a winter scarf with a summer top', () => {
    const cases = [
        [P('d1', 'Sundress', 'dresses', 'summer'), P('o1', 'Camel coat', 'outerwear', 'winter'), 'o1'],
        [P('b3', 'Wool skirt', 'bottoms', 'winter'), P('s1', 'Sandals', 'shoes', 'summer'), 's1'],
        [P('t1', 'Linen tank', 'tops', 'summer'), P('a2', 'Wool scarf', 'accessories', 'winter'), 'a2']
    ];
    cases.forEach(([a, b, forced]) => {
        const base = a.category === 'dresses' ? [a] : a.category === 'bottoms' ? [a, P('t2', 'White tee', 'tops', 'all-season')] : [a, P('b2', 'Blue jeans', 'bottoms', 'all-season')];
        const r = run([...base, b], { options: { keepIds: [forced] } });
        r.suggestions.forEach(s => assert(!(s.itemIds.includes(a.id) && s.itemIds.includes(b.id)), `${a.name} with ${b.name}`));
    });
});
check('an accessory of the opposite season is never added to an outfit, but one that agrees still can be', () => {
    const items = [P('t1', 'Linen tank', 'tops', 'summer'), P('b2', 'Blue jeans', 'bottoms', 'all-season'), P('a2', 'Wool scarf', 'accessories', 'winter'), P('a1', 'Straw hat', 'accessories', 'summer')];
    const r = run(items);
    r.suggestions.forEach(s => assert(!s.itemIds.includes('a2'), 'the winter scarf with a summer tank'));
});
check('all-season pieces go with summer ones and with winter ones', () => {
    const summery = run([P('t1', 'White tee', 'tops', 'all-season'), P('b1', 'Denim shorts', 'bottoms', 'summer')]);
    const wintery = run([P('t1', 'White tee', 'tops', 'all-season'), P('b3', 'Wool skirt', 'bottoms', 'winter')]);
    assert.strictEqual(summery.suggestions.length, 1);
    assert.strictEqual(wintery.suggestions.length, 1);
    assert.deepStrictEqual(summery.notes.concat(wintery.notes).filter(t => /summer piece with a winter piece/.test(t)), []);
});
check('spring and fall pieces are transitional: they mix with summer and winter ones freely', () => {
    for (const season of ['spring', 'fall', 'autumn']) {
        assert.strictEqual(run([P('t1', 'Light top', 'tops', season), P('b1', 'Summer skirt', 'bottoms', 'summer')]).suggestions.length, 1, season + ' + summer');
        assert.strictEqual(run([P('t1', 'Light top', 'tops', season), P('b3', 'Winter skirt', 'bottoms', 'winter')]).suggestions.length, 1, season + ' + winter');
    }
});
check('the reported pairing: a summer top and a winter skirt are never suggested together, even when it is the only combination', () => {
    const items = [P('t1', 'Summer top', 'tops', 'summer'), P('b3', 'Winter skirt', 'bottoms', 'winter')];
    const r = run(items);
    assert.deepStrictEqual(r.suggestions, []);
});

// ================= explaining it instead of silently breaking it =================
check('when every possible outfit pairs opposite seasons: no idea, and the notes say why and what would help', () => {
    const r = run([P('t1', 'Linen tank', 'tops', 'summer'), P('t0', 'Sleeveless top', 'tops', 'summer'), P('b3', 'Wool skirt', 'bottoms', 'winter')]);
    assert.deepStrictEqual(r.suggestions, []);
    const note = r.notes.join(' ');
    assert(/I haven’t suggested an outfit: every outfit I could put together for this day pairs a summer piece \(Linen tank, Sleeveless top\) with a winter piece \(Wool skirt\), and I keep those apart\./.test(note), note);
    assert(/Add an all-season piece, or change a piece’s season in its details, and I can suggest something\./.test(note));
    assert(!/Add at least a top and a bottom/.test(note), 'the closet has a top and a bottom: it is the season rule in the way');
});
check('adding one all-season piece makes the explanation go away and an idea appear', () => {
    const items = [P('t1', 'Linen tank', 'tops', 'summer'), P('b3', 'Wool skirt', 'bottoms', 'winter'), P('t2', 'White tee', 'tops', 'all-season')];
    const r = run(items);
    assert.strictEqual(r.suggestions.length, 1);
    assert.deepStrictEqual(r.suggestions[0].itemIds.slice().sort(), ['b3', 't2']);
    assert(!r.notes.some(t => /haven’t suggested/.test(t)));
});
check('changing a piece\'s season fixes it too (the note says you can)', () => {
    const r = run([P('t1', 'Linen tank', 'tops', 'all-season'), P('b3', 'Wool skirt', 'bottoms', 'winter')]);
    assert.strictEqual(r.suggestions.length, 1);
});
check('a closet where only SOME outfits are ruled out says how many were left out, when fewer ideas are shown', () => {
    const items = [P('t1', 'Linen tank', 'tops', 'summer'), P('t2', 'White tee', 'tops', 'all-season'), P('b3', 'Wool skirt', 'bottoms', 'winter')];
    const r = run(items);
    assert.deepStrictEqual(r.suggestions[0].itemIds.slice().sort(), ['b3', 't2']);
    assert(r.notes.some(t => /One possible outfit was left out because it pairs a summer piece with a winter piece/.test(t)), r.notes.join(' | '));
});
check('the old "add a top and a bottom" note is unchanged when the closet really lacks one', () => {
    const r = run([P('t1', 'Linen tank', 'tops', 'summer')]);
    assert(r.notes.some(t => /Add at least a top and a bottom/.test(t)));
    assert(!r.notes.some(t => /haven’t suggested/.test(t)));
});
check('a dress alone is a valid outfit when the tops and bottoms are all in the way', () => {
    const r = run([P('t1', 'Linen tank', 'tops', 'summer'), P('b3', 'Wool skirt', 'bottoms', 'winter'), P('d3', 'Wrap dress', 'dresses', 'all-season')]);
    assert.deepStrictEqual(r.suggestions.map(s => s.itemIds), [['d3']]);
});
check('pieces you ask to keep from opposite seasons: it says so and starts again without them', () => {
    const items = [P('t1', 'Linen tank', 'tops', 'summer'), P('b3', 'Wool skirt', 'bottoms', 'winter'), P('t2', 'White tee', 'tops', 'all-season'), P('b2', 'Blue jeans', 'bottoms', 'all-season')];
    const r = run(items, { options: { keepIds: ['t1', 'b3'] } });
    assert(r.notes.some(t => /Those pieces are for opposite seasons \(summer and winter\), and I keep those apart, so I started again without them\./.test(t)), r.notes.join(' | '));
    r.suggestions.forEach(s => assert(!mixesOpposites(s, items)));
    assert.deepStrictEqual(r.keepIds, []);
});
check('a kept piece with all-season ones is honored as before', () => {
    const items = [P('t1', 'Linen tank', 'tops', 'summer'), P('b2', 'Blue jeans', 'bottoms', 'all-season'), P('b3', 'Wool skirt', 'bottoms', 'winter')];
    const r = run(items, { options: { keepIds: ['t1'] } });
    assert(r.suggestions.length >= 1);
    r.suggestions.forEach(s => assert(s.itemIds.includes('t1') && !s.itemIds.includes('b3')));
    assert.deepStrictEqual(r.keepIds, ['t1']);
});

// ================= the rule never hides an outfit that exists =================
check('an all-season piece that ranked low is still found when everything that ranked higher is the wrong season', () => {
    const tops = Array.from({ length: 12 }, (_, i) => P('ts' + i, 'Summer top ' + i, 'tops', 'summer'));          // casual: they rank first
    const items = [...tops, P('ta', 'Dressy all-season top', 'tops', 'all-season', { occasion: 'formal', formality: 5 }), P('bw', 'Heavy winter skirt', 'bottoms', 'winter')];
    const r = run(items);
    assert.strictEqual(r.suggestions.length, 1, 'the one valid outfit exists and is found');
    assert.deepStrictEqual(r.suggestions[0].itemIds.slice().sort(), ['bw', 'ta']);
});
check('the same for bottoms, and for a dress among summer and winter pieces', () => {
    const bottoms = Array.from({ length: 12 }, (_, i) => P('bs' + i, 'Summer shorts ' + i, 'bottoms', 'summer'));
    const r = run([P('tw', 'Wool sweater', 'tops', 'winter'), ...bottoms, P('ba', 'Dressy slacks', 'bottoms', 'all-season', { occasion: 'formal', formality: 5 })]);
    assert.deepStrictEqual(r.suggestions[0].itemIds.slice().sort(), ['ba', 'tw']);
});

// ================= weight =================
check('a top and bottom up to two warmth levels apart are fine; three apart costs 20 points; four or more costs 40', () => {
    const w = (top, bottom) => warmthBalance({ top: describePiece(P('t', 'T', 'tops', 'all-season', { warmth: top })), bottom: describePiece(P('b', 'B', 'bottoms', 'all-season', { warmth: bottom })) });
    assert.deepStrictEqual([w(2, 2).adjust, w(2, 3).adjust, w(1, 3).adjust, w(3, 1).adjust], [0, 0, 0, 0]);
    assert.strictEqual(w(1, 3).adjust, 0, 'two apart: normal (a sweater with jeans)');
    assert.strictEqual(w(1, 4).adjust, -0.2);
    assert.strictEqual(w(4, 1).adjust, -0.2, 'the order does not matter');
    assert.strictEqual(w(1, 5).adjust, -0.4);
    assert.strictEqual(w(5, 1).adjust, -0.4);
    assert.deepStrictEqual(J(SUGGEST_WARMTH_GAP_PENALTY), { 3: 0.2, 4: 0.4 });
});
check('only a top with a bottom is compared: a dress, outerwear, shoes and accessories are not', () => {
    assert.deepStrictEqual(J(warmthBalance({ dress: describePiece(P('d', 'D', 'dresses', 'all-season', { warmth: 1 })), outer: describePiece(P('o', 'O', 'outerwear', 'all-season', { warmth: 5 })) })), { gap: 0, adjust: 0 });
    assert.deepStrictEqual(J(warmthBalance({ top: describePiece(P('t', 'T', 'tops', 'all-season', { warmth: 1 })) })), { gap: 0, adjust: 0 });
    assert.deepStrictEqual(J(warmthBalance(null)), { gap: 0, adjust: 0 });
});
const LIGHT = P('t', 'Lightweight top', 'tops', 'all-season', { warmth: 1 }), HEAVY = P('b', 'Heavy skirt', 'bottoms', 'all-season', { warmth: 4 });
check('REPORTED: a very light top with a very heavy skirt is marked down, and the idea says why', () => {
    const light = run([LIGHT, HEAVY]).suggestions[0], even = run([P('t', 'Lightweight top', 'tops', 'all-season', { warmth: 2 }), HEAVY]).suggestions[0];
    assert.strictEqual(even.score - light.score, 20 - 0, 'the weight check alone costs 20 points');
    assert.strictEqual(light.weight.status, 'unbalanced');
    assert(/Weight check: Lightweight top \(very light\) and Heavy skirt \(warm\) are very different weights, so this idea ranks lower\./.test(light.weight.text), light.weight.text);
    assert.strictEqual(even.weight.status, 'balanced');
    assert.strictEqual(even.weight.text, '');
});
check('it is a penalty, not a ban: an unbalanced pair is still suggested when nothing better exists, with the note', () => {
    const r = run([LIGHT, HEAVY]);
    assert.strictEqual(r.suggestions.length, 1);
    assert(r.notes.some(t => /Every idea here pairs a top and a bottom of very different weights/.test(t)));
});
check('balanced pairs rank ahead of an unbalanced one when the closet has both', () => {
    const items = [LIGHT, P('t2', 'Medium top', 'tops', 'all-season', { warmth: 3 }), HEAVY, P('b2', 'Light skirt', 'bottoms', 'all-season', { warmth: 1 })];
    const r = run(items);
    assert(r.suggestions.every(s => s.weight.status === 'balanced'), r.suggestions.map(s => s.pieces.map(p => p.name).join('+') + ' ' + s.weight.status).join(' | '));
});
check('an estimated warmth is said to be an estimate', () => {
    const r = run([P('t', 'Summer-ish top', 'tops', 'all-season'), P('b', 'Very heavy skirt', 'bottoms', 'all-season', { warmth: 5 })]).suggestions[0];
    assert.strictEqual(r.weight.status, 'unbalanced');
    assert(/Summer-ish top \(light, estimated from its season\) and Very heavy skirt \(very warm\)/.test(r.weight.text), r.weight.text);
});
check('a warm sweater with ordinary jeans is not unbalanced (two apart)', () => {
    const r = run([P('t', 'Wool sweater', 'tops', 'winter', { layer: 'mid', warmth: 4 }), P('b', 'Jeans', 'bottoms', 'all-season')]).suggestions[0];
    assert.strictEqual(r.weight.status, 'balanced');
});
check('estimated warmths of opposite seasons are handled by the season rule, not the weight check: summer + winter is never suggested at all', () => {
    assert.deepStrictEqual(run([P('t', 'Summer top', 'tops', 'summer'), P('b', 'Winter skirt', 'bottoms', 'winter')]).suggestions, []);
});
check('the weight check does not change closets whose pieces are close in weight: the same scores as before', () => {
    const items = [P('t1', 'White tee', 'tops', 'all-season'), P('t2', 'Navy top', 'tops', 'all-season'), P('b1', 'Jeans', 'bottoms', 'all-season'), P('b2', 'Skirt', 'bottoms', 'all-season')];
    run(items).suggestions.forEach(s => { assert.strictEqual(s.weight.adjust, 0); assert.strictEqual(s.weight.text, ''); });
});
check('the weight text uses the real warmth words of both pieces', () => {
    const words = ['', 'very light', 'light', 'medium', 'warm', 'very warm'];
    for (const [top, bottom] of [[1, 4], [1, 5], [2, 5], [5, 1], [4, 1], [5, 2]]) {
        const text = warmthCheck({ top: describePiece(P('t', 'T', 'tops', 'all-season', { warmth: top })), bottom: describePiece(P('b', 'B', 'bottoms', 'all-season', { warmth: bottom })) }).text;
        assert(text.includes('T (' + words[top]) && text.includes('B (' + words[bottom]), text);
    }
});
// ================= manual outfits and the page =================
check('suggesting changes nothing it is given, and gives the same answer every time', () => {
    const input = { items: CLOSET, dateKey: '2026-11-22', weather: null, texts: [], worn: [{ date: '2026-11-10', itemIds: ['t1', 'b3'] }], weekendPlanned: [] };
    const before = JSON.stringify(input);
    const a = suggestOutfits(input), b = suggestOutfits(J(input));
    assert.strictEqual(JSON.stringify(input), before);
    assert.deepStrictEqual(J(a), J(b));
});
check('an outfit you made by hand from opposite seasons is never changed or blocked: the rules live only in the suggestion engine', () => {
    for (const f of ['js/apply-outfit.js', 'js/calendar.js', 'js/closet.js']) assert(!/seasonOk|warmthBalance|warmthCheck|SUGGEST_WARMTH_GAP/.test(read(f)), f);
    assert(!/Store\.|localStorage|fetch\(|document\./.test(read('js/outfit-suggest.js')));
});
check('the item editor tells the owner what Season does', () => {
    const html = read('index.html');
    assert(/<select id="modal-season" aria-describedby="modal-season-hint">/.test(html));
    assert(/<p id="modal-season-hint" class="setting-hint">Help me choose never puts a summer piece and a winter piece in one outfit\. All-season goes with both\.<\/p>/.test(html));
    assert.deepStrictEqual([...(/<select id="modal-season"[^>]*>([\s\S]*?)<\/select>/.exec(html)[1]).matchAll(/value="([^"]+)"/g)].map(m => m[1]), ['all-season', 'summer', 'winter'], 'the season choices are unchanged');
});
check('Help me choose shows the weight line, amber', () => {
    const src = read('js/help-choose.js');
    assert(/s\.weight && s\.weight\.text/.test(src) && /weightLine\.className = 'choose-pattern is-competing'/.test(src));
});

done();
