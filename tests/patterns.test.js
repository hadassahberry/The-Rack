// Pattern metadata and the one-pattern rule for "Help me choose" (js/outfit-suggest.js, js/help-choose.js, the item editor).
// Plain Node, no packages: node tests/patterns.test.js
const { check, done, assert, read, vm } = require('./_harness');
const S = require('../js/outfit-suggest.js');
const { suggestOutfits, describePiece, normalizePattern, patternPatch, patternCheck, SUGGEST_PATTERNS, SUGGEST_PATTERNED } = S;
const { planApplySavedOutfit } = require('../js/apply-outfit.js');

const J = (x) => JSON.parse(JSON.stringify(x));
let n = 0;
// a piece; `pattern` is left OUT entirely when undefined, like every piece saved before this feature
const P = (id, name, category, pattern, extra = {}) => ({ id, name, category, color: '#222222', occasion: 'casual', season: 'all-season', tagged: true, ...(pattern === undefined ? {} : { pattern }), ...extra });
const run = (items, more = {}) => suggestOutfits({ items, dateKey: '2026-11-22', weather: null, texts: [], worn: [], weekendPlanned: [], ...more }, more.options);
const byId = (items) => Object.fromEntries(items.map(i => [i.id, i]));
const patternedCount = (itemIds, items) => itemIds.filter(id => SUGGEST_PATTERNED.includes(normalizePattern(byId(items)[id].pattern))).length;

// ================= what a stored pattern means =================
check('the choices are solid, striped, plaid, floral, other; anything else is unknown', () => {
    assert.deepStrictEqual(J(SUGGEST_PATTERNS), ['solid', 'striped', 'plaid', 'floral', 'other']);
    assert.deepStrictEqual(J(SUGGEST_PATTERNED), ['striped', 'plaid', 'floral', 'other'], 'solid is not patterned');
    for (const v of SUGGEST_PATTERNS) assert.strictEqual(normalizePattern(v), v);
    for (const v of [undefined, null, '', 'unknown', 'Unknown', 'checkered', 'polka', 0, 1, true, {}, [], NaN]) assert.strictEqual(normalizePattern(v), 'unknown', String(v));
});
check('case and spaces in a saved value do not matter', () => {
    assert.strictEqual(normalizePattern(' Striped '), 'striped');
    assert.strictEqual(normalizePattern('PLAID'), 'plaid');
});
check('a piece with no pattern is described as UNKNOWN: not solid, not patterned', () => {
    const d = describePiece(P('a', 'Tee', 'tops'));
    assert.strictEqual(d.pattern, 'unknown');
    assert.strictEqual(d.patterned, false);
    assert.notStrictEqual(d.pattern, 'solid');
});
check('solid is a known pattern that does not count as patterned; striped, plaid, floral and other do', () => {
    assert.deepStrictEqual(['solid', 'striped', 'plaid', 'floral', 'other'].map(p => describePiece(P('a', 'x', 'tops', p)).patterned), [false, true, true, true, true]);
});
check('describing a piece never changes the stored piece (an unlabeled piece stays unlabeled)', () => {
    const item = P('a', 'Tee', 'tops'), before = JSON.stringify(item);
    describePiece(item);
    assert.strictEqual(JSON.stringify(item), before);
    assert(!('pattern' in item));
});

// ================= what the editor saves =================
check('the editor leaves a piece that has no pattern saved exactly as it is', () => {
    assert.deepStrictEqual(J(patternPatch({}, '')), {});
    assert.deepStrictEqual(J(patternPatch({ name: 'x' }, '')), {});
    assert.deepStrictEqual(J(patternPatch({ pattern: null }, '')), {});
    assert.deepStrictEqual(J(patternPatch({ pattern: 'unknown' }, '')), {}, 'an explicit "unknown" is already unknown');
    assert.deepStrictEqual(J(patternPatch({ pattern: 'mystery' }, '')), {}, 'an unrecognised stored value is not rewritten just because the piece was opened');
    assert.deepStrictEqual(J(patternPatch(undefined, '')), {});
});
check('choosing a pattern saves it; clearing a saved one writes null (unknown again)', () => {
    for (const p of SUGGEST_PATTERNS) assert.deepStrictEqual(J(patternPatch({}, p)), { pattern: p });
    assert.deepStrictEqual(J(patternPatch({ pattern: 'solid' }, 'floral')), { pattern: 'floral' });
    assert.deepStrictEqual(J(patternPatch({ pattern: 'striped' }, '')), { pattern: null });
});
check('a value that is not one of the choices is never saved', () => {
    for (const bad of ['unknown', 'checkered', undefined, null, 5]) assert.deepStrictEqual(J(patternPatch({}, bad)), {});
});

// ================= the one-pattern rule =================
const SOLID_CLOSET = [P('t1', 'Solid tee', 'tops', 'solid'), P('t2', 'Navy top', 'tops', 'solid'), P('b1', 'Black skirt', 'bottoms', 'solid'), P('b2', 'Jeans', 'bottoms', 'solid'), P('s1', 'Flats', 'shoes', 'solid')];
check('all solid: nothing is patterned, every idea is fully checked', () => {
    const r = run(SOLID_CLOSET);
    assert(r.suggestions.length >= 1);
    r.suggestions.forEach(s => { assert.strictEqual(s.pattern.status, 'checked'); assert.deepStrictEqual(s.pattern.patterned, []); assert(/no patterned pieces/.test(s.pattern.text)); });
    assert(!r.notes.some(t => /pattern/i.test(t)), 'nothing to say about patterns');
});
check('one patterned piece is fine: a striped top with solid pieces', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Black skirt', 'bottoms', 'solid'), P('s1', 'Flats', 'shoes', 'solid')];
    const r = run(items);
    assert.strictEqual(r.suggestions.length, 1);
    assert.strictEqual(r.suggestions[0].pattern.status, 'checked');
    assert.deepStrictEqual(r.suggestions[0].pattern.patterned, ['Striped top']);
    assert(/one patterned piece \(Striped top\)/.test(r.suggestions[0].pattern.text));
});
check('two patterned pieces are never suggested together, in any slot', () => {
    const items = [
        P('t1', 'Striped top', 'tops', 'striped'), P('t2', 'Floral blouse', 'tops', 'floral'), P('t3', 'Plain tee', 'tops', 'solid'),
        P('b1', 'Plaid skirt', 'bottoms', 'plaid'), P('b2', 'Other pants', 'bottoms', 'other'), P('b3', 'Black skirt', 'bottoms', 'solid'),
        P('d1', 'Floral dress', 'dresses', 'floral'), P('s1', 'Striped shoes', 'shoes', 'striped'), P('s2', 'Black flats', 'shoes', 'solid'),
        P('o1', 'Plaid coat', 'outerwear', 'plaid'), P('o2', 'Navy coat', 'outerwear', 'solid'), P('a1', 'Floral scarf', 'accessories', 'floral')
    ];
    for (const weather of [null, { high: 85, low: 70, code: 0 }, { high: 40, low: 30, code: 71 }, { high: 60, low: 50, code: 61 }]) {
        const r = run(items, { weather });
        assert(r.suggestions.length >= 1, JSON.stringify(weather));
        r.suggestions.forEach(s => assert(patternedCount(s.itemIds, items) <= 1, `${s.itemIds} in ${JSON.stringify(weather)}`));
    }
    const asked = run(items, { options: { max: 3 } });
    asked.suggestions.forEach(s => assert(patternedCount(s.itemIds, items) <= 1));
});
check('an accessory is never added if it would make a second pattern, but a solid one still can be', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Black skirt', 'bottoms', 'solid'), P('a1', 'Floral scarf', 'accessories', 'floral')];
    assert(!run(items).suggestions[0].itemIds.includes('a1'));
    const withSolid = run([...items, P('a2', 'Black belt', 'accessories', 'solid')]);
    assert(patternedCount(withSolid.suggestions[0].itemIds, [...items, P('a2', 'Black belt', 'accessories', 'solid')]) <= 1);
    const noPattern = run([P('t1', 'Tee', 'tops', 'solid'), P('b1', 'Skirt', 'bottoms', 'solid'), P('a1', 'Floral scarf', 'accessories', 'floral')], { options: { keepIds: ['a1'] } });
    assert(noPattern.suggestions[0].itemIds.includes('a1'), 'a patterned accessory on an all-solid outfit is one pattern: allowed');
});
check('a patterned dress with only patterned shoes is suggested without the shoes, not dropped', () => {
    const r = run([P('d1', 'Floral dress', 'dresses', 'floral'), P('s1', 'Striped shoes', 'shoes', 'striped')]);
    assert.strictEqual(r.suggestions.length, 1);
    assert.deepStrictEqual(r.suggestions[0].itemIds, ['d1']);
});
check('a patterned piece always gets an un-patterned partner when the closet has one, even among many patterned pieces', () => {
    const tops = Array.from({ length: 12 }, (_, i) => P('tp' + i, 'Patterned top ' + i, 'tops', 'floral', { occasion: 'casual' }));
    const items = [...tops, P('tsolid', 'Plain top', 'tops', 'solid', { occasion: 'workout' }), P('b1', 'Plaid skirt', 'bottoms', 'plaid')];
    const r = run(items);
    assert(r.suggestions.length >= 1, 'the plain top is found even though twelve patterned tops rank first');
    assert.deepStrictEqual(r.suggestions[0].itemIds.sort(), ['b1', 'tsolid']);
});

// ================= not enough options =================
check('when every possible outfit breaks the rule: no idea, and the notes say why and what would help', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Plaid skirt', 'bottoms', 'plaid')];
    const r = run(items);
    assert.deepStrictEqual(r.suggestions, []);
    assert.strictEqual(r.notes.length >= 1, true);
    const note = r.notes.join(' ');
    assert(/I haven’t suggested an outfit/.test(note) && /two or more patterned pieces/.test(note) && /at most one/.test(note));
    assert(/Striped top/.test(note) && /Plaid skirt/.test(note));
    assert(/Add a solid piece/.test(note));
    assert(!/Add at least a top and a bottom/.test(note), 'it is not that the closet lacks a top and a bottom');
});
check('adding one solid piece makes the explanation go away and an idea appear', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Plaid skirt', 'bottoms', 'plaid'), P('b2', 'Black skirt', 'bottoms', 'solid')];
    const r = run(items);
    assert.strictEqual(r.suggestions.length, 1);
    assert.deepStrictEqual(r.suggestions[0].itemIds.sort(), ['b2', 't1']);
    assert(!r.notes.some(t => /haven’t suggested/.test(t)));
});
check('a closet where only SOME outfits break the rule says how many were left out', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('t2', 'Plain tee', 'tops', 'solid'), P('b1', 'Plaid skirt', 'bottoms', 'plaid')];
    const r = run(items);
    assert.strictEqual(r.suggestions.length, 1, 'only the plain tee with the plaid skirt');
    assert.deepStrictEqual(r.suggestions[0].itemIds.sort(), ['b1', 't2']);
    assert(r.notes.some(t => /One possible outfit was left out because it has two or more patterned pieces/.test(t)), r.notes.join(' | '));
});
check('a dress alone is a valid outfit however many patterned tops and bottoms there are', () => {
    const r = run([P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Plaid skirt', 'bottoms', 'plaid'), P('d1', 'Floral dress', 'dresses', 'floral')]);
    assert.deepStrictEqual(r.suggestions.map(s => s.itemIds), [['d1']]);
});
check('the old "add a top and a bottom" note is unchanged when the closet really is missing one', () => {
    const r = run([P('t1', 'Striped top', 'tops', 'striped')]);
    assert.deepStrictEqual(r.suggestions, []);
    assert(r.notes.some(t => /Add at least a top and a bottom/.test(t)));
});
check('"Different ideas" running out of outfits is still reported as before (the rule adds no new wording to it)', () => {
    const items = [P('t1', 'Tee', 'tops', 'solid'), P('b1', 'Skirt', 'bottoms', 'solid')];
    const first = run(items);
    const again = run(items, { options: { exclude: first.suggestions.map(s => s.signature) } });
    assert(again.notes.some(t => /everything I can put together/.test(t)));
    assert(!again.notes.some(t => /pattern/i.test(t)));
});

// ================= unknown pieces =================
const UNLABELED = [P('t1', 'Navy blouse', 'tops'), P('t2', 'White tee', 'tops'), P('b1', 'Blue jeans', 'bottoms'), P('b2', 'Black skirt', 'bottoms'), P('s1', 'Sneakers', 'shoes')];
check('unlabeled pieces: ideas come out as before, but none is called checked, solid or compatible', () => {
    const r = run(UNLABELED);
    assert(r.suggestions.length >= 1);
    r.suggestions.forEach(s => {
        assert.strictEqual(s.pattern.status, 'unverified');
        assert(s.pattern.unknown.length >= 2);
        assert(/Pattern check incomplete/.test(s.pattern.text) && /no pattern is set for/.test(s.pattern.text) && /can’t tell whether/.test(s.pattern.text));
        assert(!/solid|compatible|verified|matches|safe/i.test(s.pattern.text.replace(/unverified/i, '')), s.pattern.text);
        assert(!/checked/.test(s.pattern.status));
    });
});
check('unlabeled pieces: the notes explain that the rule could not be checked for them', () => {
    const r = run(UNLABELED);
    const note = r.notes.find(t => /no pattern set/.test(t));
    assert(note, r.notes.join(' | '));
    assert(/can’t check the one-pattern rule/.test(note) && /More details/.test(note));
    assert(/\d pieces have no pattern set/.test(note));
    assert(/One piece has no pattern set/.test(run([P('t1', 'Tee', 'tops', 'solid'), P('b1', 'Skirt', 'bottoms')]).notes.join(' ')));
});
check('unlabeled pieces rank exactly as they did before this feature: the ideas are the same as for pieces with a pattern set', () => {
    const asSolid = UNLABELED.map(i => ({ ...i, pattern: 'solid' }));
    const a = run(UNLABELED), b = run(asSolid);
    assert.deepStrictEqual(a.suggestions.map(s => [s.signature, s.score, s.reason]), b.suggestions.map(s => [s.signature, s.score, s.reason]));
});
check('an unknown piece is not counted as patterned, so it may be paired with one known pattern, but the idea is flagged', () => {
    const r = run([P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Mystery pants', 'bottoms')]);
    assert.strictEqual(r.suggestions.length, 1);
    const p = r.suggestions[0].pattern;
    assert.strictEqual(p.status, 'unverified');
    assert.deepStrictEqual(p.unknown, ['Mystery pants']);
    assert(/One patterned piece: Striped top\./.test(p.text) && /can’t tell/.test(p.text));
});
check('unknown with no known pattern at all is not described as "no patterned pieces"', () => {
    const p = run([P('t1', 'Tee', 'tops'), P('b1', 'Jeans', 'bottoms')]).suggestions[0].pattern;
    assert(!/Pattern check: no patterned pieces/.test(p.text));
    assert(/No patterned pieces among the ones with a known pattern/.test(p.text), 'only claims what is known');
});
check('"unknown" written explicitly behaves exactly like nothing saved', () => {
    const a = run([P('t1', 'Tee', 'tops'), P('b1', 'Jeans', 'bottoms')]);
    const b = run([P('t1', 'Tee', 'tops', 'unknown'), P('b1', 'Jeans', 'bottoms', 'unknown')]);
    assert.deepStrictEqual(J(a), J(b));
});
check('the idea\'s text names at most three unlabeled pieces and counts the rest', () => {
    const text = patternCheck(['A', 'B', 'C', 'D', 'E'].map((n, i) => describePiece(P('p' + i, n, 'tops')))).text;
    assert(/A, B, C and 2 more/.test(text), text);
});
check('a mix: one known pattern plus unknown plus solid is unverified; all known is checked', () => {
    assert.strictEqual(patternCheck([describePiece(P('a', 'A', 'tops', 'striped')), describePiece(P('b', 'B', 'bottoms', 'solid'))]).status, 'checked');
    assert.strictEqual(patternCheck([describePiece(P('a', 'A', 'tops', 'striped')), describePiece(P('b', 'B', 'bottoms'))]).status, 'unverified');
});

// ================= keeping pieces the person chose =================
check('"Keep this piece": a patterned piece they keep is respected and paired with something un-patterned', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Plaid skirt', 'bottoms', 'plaid'), P('b2', 'Black skirt', 'bottoms', 'solid')];
    const r = run(items, { options: { keepIds: ['t1'] } });
    assert(r.suggestions.length >= 1);
    r.suggestions.forEach(s => { assert(s.itemIds.includes('t1')); assert(!s.itemIds.includes('b1')); });
    assert.deepStrictEqual(r.keepIds, ['t1']);
});
check('keeping two patterned pieces: it says they both have a pattern, and starts again without them (never breaks the rule)', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Plaid skirt', 'bottoms', 'plaid'), P('t2', 'Plain tee', 'tops', 'solid'), P('b2', 'Black skirt', 'bottoms', 'solid')];
    const r = run(items, { options: { keepIds: ['t1', 'b1'] } });
    assert(r.notes.some(t => /both have a pattern, and I keep to one patterned piece per outfit/.test(t)), r.notes.join(' | '));
    r.suggestions.forEach(s => assert(patternedCount(s.itemIds, items) <= 1));
    assert.deepStrictEqual(r.keepIds, []);
});
check('a kept patterned accessory is never put on top of another pattern', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('t2', 'Plain tee', 'tops', 'solid'), P('b1', 'Black skirt', 'bottoms', 'solid'), P('a1', 'Floral scarf', 'accessories', 'floral')];
    const r = run(items, { options: { keepIds: ['a1'] } });
    r.suggestions.forEach(s => { assert(s.itemIds.includes('a1')); assert(!s.itemIds.includes('t1'), 'not with the striped top'); assert(patternedCount(s.itemIds, items) <= 1); });
    assert(r.suggestions.length >= 1);
});
check('the typed refinements ("keep my striped top") go through the same rule', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Plaid skirt', 'bottoms', 'plaid'), P('b2', 'Black skirt', 'bottoms', 'solid')];
    const r = run(items, { options: { text: 'keep striped top' } });
    r.suggestions.forEach(s => assert(patternedCount(s.itemIds, items) <= 1));
});

// ================= manual outfits are never touched =================
check('suggesting changes nothing it is given: pieces, wear history and planned outfits', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Plaid skirt', 'bottoms', 'plaid'), P('b2', 'Black skirt', 'bottoms', 'solid')];
    const worn = [{ date: '2026-11-10', itemIds: ['t1', 'b1'] }];
    const input = { items, dateKey: '2026-11-22', weather: null, texts: [], worn, weekendPlanned: [{ date: '2026-11-21', itemIds: ['t1', 'b1'] }] };
    const before = JSON.stringify(input);
    const a = suggestOutfits(input), b = suggestOutfits(J(input));
    assert.strictEqual(JSON.stringify(input), before);
    assert.deepStrictEqual(J(a), J(b), 'the same answer every time');
});
check('an outfit the person made by hand with two patterns is left exactly as it is, and still counts as worn history', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped'), P('b1', 'Plaid skirt', 'bottoms', 'plaid'), P('t2', 'Plain tee', 'tops', 'solid'), P('b2', 'Black skirt', 'bottoms', 'solid')];
    const manual = { id: 'o1', label: 'Class', itemIds: ['t1', 'b1'], worn: true };
    const planned = J([manual]), before = JSON.stringify(planned);
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise });
    for (const f of ['js/outfit-suggest.js', 'js/help-choose.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext('this.api = { buildDayContext };', ctx);
    const day = ctx.api.buildDayContext('2026-11-22', { closet: items, outfitsByDate: { '2026-11-12': planned }, prefs: {} });
    assert.strictEqual(JSON.stringify(planned), before, 'the planned outfit was only read');
    assert.deepStrictEqual(J(day.worn), [{ date: '2026-11-12', itemIds: ['t1', 'b1'] }], 'a manual outfit still counts as worn, pattern or not');
    const r = suggestOutfits(J(day));
    assert(r.suggestions.length >= 1);
    assert(r.suggestions.every(s => !(s.itemIds.includes('t1') && s.itemIds.includes('b1'))), 'and the pair is not suggested');
});
check('applying a manual outfit is the same as before: the rule is not in that path', () => {
    const day = [{ id: 'o1', label: '', itemIds: ['t1', 'b1'], worn: false }];
    const plan = planApplySavedOutfit({ dayOutfits: day, activeId: 'o1', savedItemIds: ['t1', 'b1'] });
    assert.strictEqual(plan.action, 'already', 'a hand-made two-pattern outfit is recognised and left alone');
    for (const f of ['js/apply-outfit.js', 'js/calendar.js', 'js/closet.js']) assert(!/patternOk|patternCheck|SUGGEST_PATTERNED/.test(read(f)), f + ' does not apply the rule to manual choices');
    const choose = read('js/help-choose.js');
    assert(!/patternOk|SUGGEST_PATTERNED/.test(choose), 'the panel only shows what the engine said');
});
check('the rule lives only in the suggestion engine, which is pure: it can read nothing stored and write nothing', () => {
    const src = read('js/outfit-suggest.js');
    assert(!/Store\.|localStorage|fetch\(|document\./.test(src));
});

// ================= how it looks and is saved =================
const html = read('index.html');
check('the item editor has a Pattern field with exactly the five choices and Unknown (not set)', () => {
    const select = /<select id="modal-pattern"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    assert(select);
    const values = [...select[1].matchAll(/<option value="([^"]*)">([^<]*)</g)];
    assert.deepStrictEqual(values.map(m => m[1]), ['', ...SUGGEST_PATTERNS]);
    assert.strictEqual(values[0][2], 'Unknown (not set)');
    assert(/<label for="modal-pattern">Pattern<\/label>/.test(html));
});
check('the editor refills it, notices a change in it, and saves it only through patternPatch (so unlabeled pieces are not rewritten)', () => {
    const src = read('js/closet.js');
    assert(/normalizePattern\(item\.pattern\)/.test(src) && /getElementById\('modal-pattern'\)\.value = savedPattern === 'unknown' \? '' : savedPattern/.test(src));
    assert(/pattern: document\.getElementById\('modal-pattern'\)\.value,/.test(src.slice(src.indexOf('function readEditForm'))), 'part of "did anything change?"');
    const patch = src.slice(src.indexOf('async function saveEditModal'), src.indexOf('async function deleteEditingItem'));
    assert(/\.\.\.patternPatch\(existing, document\.getElementById\('modal-pattern'\)\.value\)/.test(patch));
    assert(!/pattern: document/.test(patch), 'never writes the field directly');
});
check('Help me choose shows each idea\'s pattern line, amber when it could not be fully checked', () => {
    const src = read('js/help-choose.js');
    assert(/choose-pattern/.test(src) && /is-unverified/.test(src) && /s\.pattern\.text/.test(src));
    const css = read('css/components.css');
    assert(/\.choose-pattern\.is-unverified/.test(css));
});
check('the feature is free and on the device: no network, no new file, no key', () => {
    const src = read('js/outfit-suggest.js') + read('js/help-choose.js');
    assert(!/fetch\(|httpsCallable|apiKey/i.test(src.replace(/Gemini[\s\S]*?\n/g, '')));
});

done();
