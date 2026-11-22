// Pattern metadata and how patterns are SCORED in "Help me choose" (js/outfit-suggest.js, js/help-choose.js, the item editor).
// Patterns are soft: competing bold patterns lower an outfit's score, shared color helps a little, unknown is never a clash or a
// match, and an outfit is never rejected because of its patterns.
// Plain Node, no packages: node tests/patterns.test.js
const { check, done, assert, read, vm } = require('./_harness');
const S = require('../js/outfit-suggest.js');
const { suggestOutfits, describePiece, normalizePattern, patternPatch, normalizePatternStrength, patternStrengthPatch, patternCheck, patternAnalysis, sgSharedColor, SUGGEST_PATTERNS, SUGGEST_PATTERN_STRENGTHS } = S;
const { planApplySavedOutfit } = require('../js/apply-outfit.js');

const J = (x) => JSON.parse(JSON.stringify(x));
// a piece; pattern and strength are left OUT entirely when undefined, like every piece saved before this feature
const P = (id, name, category, pattern, strength, extra = {}) => ({ id, name, category, color: '#222222', occasion: 'casual', season: 'all-season', tagged: true, ...(pattern === undefined ? {} : { pattern }), ...(strength === undefined ? {} : { patternStrength: strength }), ...extra });
const run = (items, more = {}) => suggestOutfits({ items, dateKey: '2026-11-22', weather: null, texts: [], worn: [], weekendPlanned: [], ...more }, more.options);
const RED = '#c62828', NAVY = '#1f2a52', RED2 = '#d03030', GREEN = '#3f8f4f';
// the score of the one outfit a top + a bottom can make (so only the patterns differ between the two closets compared)
const pairScore = (top, bottom) => run([top, bottom]).suggestions[0].score;
const pairIdea = (top, bottom) => run([top, bottom]).suggestions[0];

// ================= what a stored pattern and strength mean =================
check('the pattern choices are solid, striped, plaid, floral, other; anything else is unknown; solid is not patterned', () => {
    assert.deepStrictEqual(J(SUGGEST_PATTERNS), ['solid', 'striped', 'plaid', 'floral', 'other']);
    for (const v of SUGGEST_PATTERNS) assert.strictEqual(normalizePattern(v), v);
    for (const v of [undefined, null, '', 'unknown', 'Unknown', 'checkered', 'polka', 0, 1, true, {}, [], NaN]) assert.strictEqual(normalizePattern(v), 'unknown', String(v));
    assert.strictEqual(normalizePattern(' Striped '), 'striped');
    assert.deepStrictEqual(['solid', 'striped', 'plaid', 'floral', 'other'].map(p => describePiece(P('a', 'x', 'tops', p)).patterned), [false, true, true, true, true]);
});
check('the strength choices are subtle and bold; anything else, including nothing, is unknown', () => {
    assert.deepStrictEqual(J(SUGGEST_PATTERN_STRENGTHS), ['subtle', 'bold']);
    assert.strictEqual(normalizePatternStrength('bold'), 'bold');
    assert.strictEqual(normalizePatternStrength(' Subtle '), 'subtle');
    for (const v of [undefined, null, '', 'unknown', 'loud', 'medium', 0, 1, true, {}, []]) assert.strictEqual(normalizePatternStrength(v), 'unknown', String(v));
});
check('a piece with no pattern and no strength saved is UNKNOWN on both: not solid, not patterned, not subtle', () => {
    const d = describePiece(P('a', 'Tee', 'tops'));
    assert.deepStrictEqual([d.pattern, d.patterned, d.strength], ['unknown', false, 'unknown']);
});
check('strength is never guessed from the kind of pattern: a floral piece with no strength set is unknown, not bold', () => {
    for (const kind of ['striped', 'plaid', 'floral', 'other']) assert.strictEqual(describePiece(P('a', 'x', 'tops', kind)).strength, 'unknown', kind);
    assert.strictEqual(describePiece(P('a', 'x', 'tops', 'floral', 'bold')).strength, 'bold');
});
check('describing a piece never changes the stored piece (an unlabeled piece stays unlabeled)', () => {
    const item = P('a', 'Tee', 'tops'), before = JSON.stringify(item);
    describePiece(item);
    assert.strictEqual(JSON.stringify(item), before);
    assert(!('pattern' in item) && !('patternStrength' in item));
});

// ================= what the editor saves =================
check('the editor leaves a piece with nothing saved exactly as it is (pattern and strength)', () => {
    for (const existing of [{}, { name: 'x' }, { pattern: null, patternStrength: null }, { pattern: 'unknown', patternStrength: 'unknown' }, { pattern: 'mystery', patternStrength: 'loud' }, undefined]) {
        assert.deepStrictEqual(J(patternPatch(existing, '')), {});
        assert.deepStrictEqual(J(patternStrengthPatch(existing, '')), {});
    }
});
check('choosing saves it; clearing a saved one writes null (unknown again); anything that is not a choice is never saved', () => {
    for (const p of SUGGEST_PATTERNS) assert.deepStrictEqual(J(patternPatch({}, p)), { pattern: p });
    for (const s of SUGGEST_PATTERN_STRENGTHS) assert.deepStrictEqual(J(patternStrengthPatch({}, s)), { patternStrength: s });
    assert.deepStrictEqual(J(patternPatch({ pattern: 'striped' }, '')), { pattern: null });
    assert.deepStrictEqual(J(patternStrengthPatch({ patternStrength: 'bold' }, '')), { patternStrength: null });
    for (const bad of ['unknown', 'checkered', undefined, null, 5]) { assert.deepStrictEqual(J(patternPatch({}, bad)), {}); assert.deepStrictEqual(J(patternStrengthPatch({}, bad)), {}); }
});

// ================= competing bold patterns cost points; nothing else does =================
const TOP = (kind, strength, color = RED) => P('t1', 'Striped top', 'tops', kind, strength, { color });
const BOT = (kind, strength, color = NAVY) => P('b1', 'Plaid skirt', 'bottoms', kind, strength, { color });
check('bold with bold is penalized: it scores lower than bold with subtle, subtle with subtle, or solid', () => {
    const boldBold = pairScore(TOP('striped', 'bold'), BOT('plaid', 'bold'));
    const boldSubtle = pairScore(TOP('striped', 'bold'), BOT('plaid', 'subtle'));
    const subtleBold = pairScore(TOP('striped', 'subtle'), BOT('plaid', 'bold'));
    const subtleSubtle = pairScore(TOP('striped', 'subtle'), BOT('plaid', 'subtle'));
    const boldSolid = pairScore(TOP('striped', 'bold'), BOT('solid'));
    assert(boldBold < boldSubtle && boldBold < subtleSubtle, `${boldBold} < ${boldSubtle}, ${subtleSubtle}`);
    assert.strictEqual(boldSubtle, subtleBold, 'the order does not matter');
    assert.strictEqual(boldSubtle, subtleSubtle, 'bold with subtle costs nothing extra');
    assert.strictEqual(boldSubtle, boldSolid, 'neither does a pattern with a solid');
    assert.strictEqual(subtleSubtle - boldBold, 16, 'the clash is worth 16 points on the 0-100 score');
});
check('a bold pattern with a subtle one is described as fine, naming which is bold', () => {
    const p = pairIdea(TOP('striped', 'bold'), BOT('plaid', 'subtle')).pattern;
    assert.strictEqual(p.status, 'checked');
    assert.deepStrictEqual(p.competing, []);
    assert(/only one is bold, so they don’t compete/.test(p.text), p.text);
});
check('two bold patterns are described as competing and ranked lower, and the pair is listed', () => {
    const p = pairIdea(TOP('striped', 'bold'), BOT('plaid', 'bold')).pattern;
    assert.deepStrictEqual(p.competing, [['Striped top', 'Plaid skirt']]);
    assert(/both have bold patterns, which compete, so this idea ranks lower/.test(p.text), p.text);
    assert.strictEqual(p.status, 'checked', 'every pattern and strength is known: the check is complete');
});
check('two subtle patterns do not compete', () => {
    const p = pairIdea(TOP('striped', 'subtle'), BOT('plaid', 'subtle')).pattern;
    assert.deepStrictEqual(p.competing, []);
    assert(/both subtle patterns, so they don’t compete/.test(p.text));
});
check('three bold patterns: each pair counts, but the penalty is capped', () => {
    const pieces = [describePiece(P('a', 'A', 'tops', 'striped', 'bold', { color: RED })), describePiece(P('b', 'B', 'bottoms', 'plaid', 'bold', { color: NAVY })), describePiece(P('c', 'C', 'shoes', 'floral', 'bold', { color: GREEN })), describePiece(P('d', 'D', 'accessories', 'other', 'bold', { color: '#7b3fa0' }))];
    assert.strictEqual(patternAnalysis(pieces.slice(0, 2)).adjust, -0.16);
    assert.strictEqual(patternAnalysis(pieces.slice(0, 3)).pairs.length, 3);
    assert.strictEqual(patternAnalysis(pieces.slice(0, 3)).adjust, -0.3, 'three pairs = 0.48, capped at 0.30');
    assert.strictEqual(patternAnalysis(pieces).adjust, -0.3);
});
check('the pattern of ANY slot counts: shoes, outerwear and accessories compete too', () => {
    for (const cat of ['shoes', 'outerwear', 'accessories']) {
        const items = [TOP('striped', 'bold'), P('b1', 'Plain skirt', 'bottoms', 'solid'), P('x1', 'Floral thing', cat, 'floral', 'bold', { color: GREEN })];
        const withIt = run(items, { options: { keepIds: ['x1'] } }).suggestions[0];
        assert(withIt.itemIds.includes('x1') && withIt.itemIds.includes('t1'));
        assert.deepStrictEqual(withIt.pattern.competing, [['Striped top', 'Floral thing']], cat);
    }
});

// ================= shared colors help, without guaranteeing a match =================
check('what counts as a shared color: two real main colors that are close; missing or invalid ones never match', () => {
    const d = (color) => describePiece(P('a', 'x', 'tops', 'striped', 'bold', { color }));
    assert.strictEqual(sgSharedColor(d(RED), d(RED)), true);
    assert.strictEqual(sgSharedColor(d(RED), d(RED2)), true, 'a close shade');
    assert.strictEqual(sgSharedColor(d(RED), d(NAVY)), false);
    assert.strictEqual(sgSharedColor(d(RED), d(GREEN)), false);
    for (const bad of [undefined, null, '', 'red', '#12345', 7]) { assert.strictEqual(sgSharedColor(d(bad), d(bad)), false, String(bad)); assert.strictEqual(sgSharedColor(d(RED), d(bad)), false); }
    assert.strictEqual(sgSharedColor(describePiece({ id: 'z', category: 'tops' }), describePiece({ id: 'y', category: 'tops' })), false, 'no color saved on either');
});
check('bold with bold that share a color is penalized LESS than bold with bold that do not, but still penalized', () => {
    const far = pairScore(TOP('striped', 'bold', RED), BOT('plaid', 'bold', NAVY));
    const shared = pairScore(TOP('striped', 'bold', RED), BOT('plaid', 'bold', RED2));
    const ok = pairScore(TOP('striped', 'bold', RED), BOT('plaid', 'subtle', NAVY));
    assert(far < shared, `${far} < ${shared}`);
    assert(shared < ok, `a shared color softens the clash but does not guarantee a match: ${shared} < ${ok}`);
    assert.strictEqual(far - shared, -8, 'the penalty is halved: 8 points back');
    const p = pairIdea(TOP('striped', 'bold', RED), BOT('plaid', 'bold', RED2)).pattern;
    assert.deepStrictEqual(p.competing.length, 1, 'still listed as competing');
    assert(/share a similar color, which softens it/.test(p.text) && !/guarantee|match is certain/.test(p.text.replace('doesn’t guarantee', '')));
});
check('a pair that does not compete gets a small bonus for a shared color, and none without one', () => {
    const noShare = pairScore(TOP('striped', 'bold', RED), BOT('plaid', 'subtle', NAVY));
    const share = pairScore(TOP('striped', 'bold', RED), BOT('plaid', 'subtle', RED2));
    assert.strictEqual(share - noShare, 2, 'two points: a nudge, never an override');
    const p = pairIdea(TOP('striped', 'bold', RED), BOT('plaid', 'subtle', RED2)).pattern;
    assert(/share a similar color, which helps \(it doesn’t guarantee a match\)/.test(p.text), p.text);
});
check('a shared color between a patterned piece and a solid or unknown one changes nothing', () => {
    const base = pairScore(TOP('striped', 'bold', RED), BOT('solid', undefined, NAVY));
    assert.strictEqual(pairScore(TOP('striped', 'bold', RED), BOT('solid', undefined, RED2)), base);
    assert.strictEqual(pairScore(TOP('striped', 'bold', RED), BOT(undefined, undefined, RED2)), base);
});

// ================= unknown is neither a clash nor a match =================
check('unknown strength: two known patterns with no strength set are NOT penalized, and the idea says it can’t tell', () => {
    const unknown = pairScore(TOP('striped'), BOT('plaid'));
    assert.strictEqual(unknown, pairScore(TOP('striped', 'bold'), BOT('plaid', 'subtle')), 'no penalty, no bonus: it is not a confirmed clash');
    const p = pairIdea(TOP('striped'), BOT('plaid')).pattern;
    assert.strictEqual(p.status, 'incomplete');
    assert.deepStrictEqual(p.competing, []);
    assert(/Pattern check incomplete/.test(p.text) && /I can’t tell whether Striped top and Plaid skirt compete: bold or subtle isn’t set for Striped top, Plaid skirt/.test(p.text), p.text);
    assert.deepStrictEqual(p.unknownStrength, ['Striped top', 'Plaid skirt']);
});
check('one strength unknown and one bold: not a confirmed clash either', () => {
    const r = pairIdea(TOP('striped', 'bold'), BOT('plaid'));
    assert.strictEqual(r.score, pairScore(TOP('striped', 'bold'), BOT('plaid', 'subtle')));
    assert.strictEqual(r.pattern.status, 'incomplete');
    assert.deepStrictEqual(r.pattern.unknownStrength, ['Plaid skirt']);
});
check('an unknown pattern (nothing saved) adds no penalty and no bonus, and is never described as solid, safe or compatible', () => {
    const items = [TOP('striped', 'bold'), BOT(undefined)];
    const r = run(items).suggestions[0];
    assert.strictEqual(r.score, pairScore(TOP('striped', 'bold'), BOT('solid')), 'it scores like a piece with no pattern problem');
    assert.strictEqual(r.pattern.status, 'incomplete');
    assert.deepStrictEqual(r.pattern.unknown, ['Plaid skirt']);
    assert(/No pattern is set for Plaid skirt, so I can’t tell whether it adds another pattern/.test(r.pattern.text), r.pattern.text);
    assert(!/solid|safe|compatible|verified|matches|fine|works/i.test(r.pattern.text), r.pattern.text);
});
check('all unlabeled pieces: ideas as before, none called checked, and the text says what could not be checked', () => {
    const UNLABELED = [P('t1', 'Navy blouse', 'tops'), P('t2', 'White tee', 'tops'), P('b1', 'Blue jeans', 'bottoms'), P('b2', 'Black skirt', 'bottoms'), P('s1', 'Sneakers', 'shoes')];
    const r = run(UNLABELED);
    assert(r.suggestions.length >= 1);
    r.suggestions.forEach(s => {
        assert.strictEqual(s.pattern.status, 'incomplete');
        assert(/no pattern is set for/.test(s.pattern.text) && /can’t tell whether any piece is patterned/.test(s.pattern.text), s.pattern.text);
        assert(!/solid|safe|compatible|verified|matches/i.test(s.pattern.text), s.pattern.text);
    });
    assert(r.notes.some(t => /no pattern set, so I can’t check how their patterns fit with the rest/.test(t)), r.notes.join(' | '));
    const asSolid = run(UNLABELED.map(i => ({ ...i, pattern: 'solid' })));
    assert.deepStrictEqual(r.suggestions.map(s => [s.signature, s.score, s.reason]), asSolid.suggestions.map(s => [s.signature, s.score, s.reason]), 'the same ranking as pieces known to be solid: unknown costs nothing');
});
check('"unknown" written explicitly behaves exactly like nothing saved', () => {
    const a = run([P('t1', 'Tee', 'tops'), P('b1', 'Jeans', 'bottoms')]);
    const b = run([P('t1', 'Tee', 'tops', 'unknown', 'unknown'), P('b1', 'Jeans', 'bottoms', 'unknown', 'unknown')]);
    assert.deepStrictEqual(J(a), J(b));
});
check('solid pieces are known and not patterned: a fully solid idea is checked and says "no patterned pieces"', () => {
    const r = run([P('t1', 'Tee', 'tops', 'solid'), P('b1', 'Skirt', 'bottoms', 'solid')]);
    assert.strictEqual(r.suggestions[0].pattern.status, 'checked');
    assert.strictEqual(r.suggestions[0].pattern.text, 'Pattern check: no patterned pieces.');
    assert(!r.notes.some(t => /pattern/i.test(t)));
});
check('one patterned piece among solid ones: checked, and strength does not matter', () => {
    for (const strength of ['bold', 'subtle', undefined]) {
        const p = run([TOP('striped', strength), P('b1', 'Plain skirt', 'bottoms', 'solid')]).suggestions[0].pattern;
        assert.strictEqual(p.status, 'checked', String(strength));
        assert(/one patterned piece \(Striped top\)/.test(p.text));
    }
});
check('a known pattern with an unknown piece: names what is unknown, says only what is known', () => {
    const p = pairIdea(TOP('striped', 'bold'), BOT(undefined)).pattern;
    assert(/one patterned piece \(Striped top\)\. No pattern is set for Plaid skirt/.test(p.text), p.text);
});
check('a note counts patterned pieces whose strength is missing when it stops two patterns being judged', () => {
    const r = run([TOP('striped'), BOT('plaid')]);
    assert(r.notes.some(t => /2 patterned pieces have no strength set \(bold or subtle\), so I can’t tell whether they compete with another pattern/.test(t)), r.notes.join(' | '));
    assert(!run([TOP('striped', 'bold'), BOT('plaid', 'subtle')]).notes.some(t => /strength/.test(t)));
});
check('the idea text names at most three unlabeled pieces and counts the rest', () => {
    const text = patternCheck(['A', 'B', 'C', 'D', 'E'].map((n, i) => describePiece(P('p' + i, n, 'tops')))).text;
    assert(/A, B, C and 2 more/.test(text), text);
});

// ================= nothing is ever rejected because of its patterns =================
const EVERY_BOLD = [
    P('t1', 'Striped top', 'tops', 'striped', 'bold', { color: RED }), P('t2', 'Floral blouse', 'tops', 'floral', 'bold', { color: GREEN }),
    P('b1', 'Plaid skirt', 'bottoms', 'plaid', 'bold', { color: NAVY }), P('b2', 'Other pants', 'bottoms', 'other', 'bold', { color: '#7b3fa0' }),
    P('s1', 'Striped shoes', 'shoes', 'striped', 'bold', { color: '#f4d03f' })
];
check('a closet where EVERY combination has two or more bold patterns still gets suggestions, ranked, with the reason given', () => {
    const r = run(EVERY_BOLD);
    assert(r.suggestions.length >= 2, 'ideas are still shown');
    r.suggestions.forEach(s => assert(s.pattern.competing.length >= 1));
    assert(r.notes.some(t => /Every idea here pairs two bold patterns that compete, so they are ranked lower\. These are the closest I could get from your closet; a solid or subtle piece would give better matches/.test(t)), r.notes.join(' | '));
    assert(!r.notes.some(t => /haven’t suggested|left out|keep to one|at most one/.test(t)));
});
check('the set of outfits that can be suggested is the same with and without pattern data (the patterns only reorder them)', () => {
    const stripped = EVERY_BOLD.map(({ pattern, patternStrength, ...rest }) => rest);
    const withP = run(EVERY_BOLD, { options: { max: 6 } }), without = run(stripped, { options: { max: 6 } });
    assert.strictEqual(withP.suggestions.length, without.suggestions.length);
    assert.deepStrictEqual(withP.suggestions.map(s => s.signature).sort(), without.suggestions.map(s => s.signature).sort());
});
check('a closet with only one possible outfit that has competing patterns shows that outfit, not nothing', () => {
    const r = run([TOP('striped', 'bold'), BOT('plaid', 'bold')]);
    assert.strictEqual(r.suggestions.length, 1);
    assert.deepStrictEqual(r.suggestions[0].itemIds.sort(), ['b1', 't1']);
    assert(r.notes.some(t => /Every idea here pairs two bold patterns/.test(t)));
});
check('a quieter alternative is found and ranked first even when bold-patterned pieces ranked ahead of it', () => {
    const tops = Array.from({ length: 12 }, (_, i) => P('tp' + i, 'Bold top ' + i, 'tops', 'floral', 'bold', { color: GREEN }));
    const items = [...tops, P('tsolid', 'Plain top', 'tops', 'solid', undefined, { occasion: 'workout' }), P('b1', 'Plaid skirt', 'bottoms', 'plaid', 'bold', { color: NAVY })];
    const r = run(items);
    assert.deepStrictEqual(r.suggestions[0].itemIds.slice().sort(), ['b1', 'tsolid'], 'the plain top is found and wins');
    assert.strictEqual(r.suggestions[0].pattern.competing.length, 0);
});
check('with enough quiet pieces, bold/bold outfits sink to the bottom of the list instead of leading it', () => {
    const items = [
        P('t1', 'Striped top', 'tops', 'striped', 'bold', { color: RED }), P('t2', 'Plain tee', 'tops', 'solid', undefined, { color: '#f5f5f5' }), P('t3', 'Navy top', 'tops', 'solid', undefined, { color: NAVY }),
        P('b1', 'Plaid skirt', 'bottoms', 'plaid', 'bold', { color: NAVY }), P('b2', 'Black skirt', 'bottoms', 'solid'), P('b3', 'Jeans', 'bottoms', 'solid', undefined, { color: '#4a6fa5' })
    ];
    const r = run(items, { options: { max: 3 } });
    assert(r.suggestions.every(s => s.pattern.competing.length === 0), 'the three best ideas avoid the clash');
    assert(!r.notes.some(t => /Every idea here pairs/.test(t)));
});
check('"Keep this piece" with two bold patterns is honored, penalized and explained (no refusal, no silent change)', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped', 'bold', { color: RED }), P('b1', 'Plaid skirt', 'bottoms', 'plaid', 'bold', { color: NAVY }), P('t2', 'Plain tee', 'tops', 'solid'), P('b2', 'Black skirt', 'bottoms', 'solid')];
    const r = run(items, { options: { keepIds: ['t1', 'b1'] } });
    assert(r.suggestions.length >= 1);
    r.suggestions.forEach(s => { assert(s.itemIds.includes('t1') && s.itemIds.includes('b1')); assert.strictEqual(s.pattern.competing.length, 1); });
    assert.deepStrictEqual(r.keepIds, ['t1', 'b1']);
    assert(!r.notes.some(t => /started again without them/.test(t)), 'it is not the pieces that cannot go together');
});
check('a kept patterned accessory is never dropped for its pattern', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped', 'bold', { color: RED }), P('b1', 'Black skirt', 'bottoms', 'solid'), P('a1', 'Floral scarf', 'accessories', 'floral', 'bold', { color: GREEN })];
    const r = run(items, { options: { keepIds: ['a1'] } });
    assert.strictEqual(r.suggestions.length, 1);
    assert(r.suggestions[0].itemIds.includes('a1') && r.suggestions[0].itemIds.includes('t1'));
    assert.strictEqual(r.suggestions[0].pattern.competing.length, 1);
});
check('a patterned dress with only patterned shoes is suggested as before (the shoes included)', () => {
    const r = run([P('d1', 'Floral dress', 'dresses', 'floral', 'bold', { color: GREEN }), P('s1', 'Striped shoes', 'shoes', 'striped', 'bold', { color: RED })]);
    assert.deepStrictEqual(r.suggestions.map(s => s.itemIds.slice().sort()), [['d1', 's1']]);
});
check('there is no hard rule left anywhere: no filter, no "one patterned piece" wording', () => {
    const src = read('js/outfit-suggest.js');
    assert(!/patternOk|patternStats|patternRejected/.test(src), 'patterns have no filter (the season rule has its own, and is not about patterns)');
    for (const f of ['js/outfit-suggest.js', 'js/help-choose.js', 'js/closet.js', 'index.html']) {
        const text = read(f).replace(/\/\/.*$/gm, '');
        assert(!/one-pattern|one patterned piece per|at most one (known )?patterned|keeps? to one patterned|I haven’t suggested an outfit: every outfit[^']*patterned|two or more patterned pieces/i.test(text.replace(/one patterned piece \(/g, '')), f);
    }
    assert(!/<p id="modal-pattern-hint"[^>]*>[^<]*one patterned/.test(read('index.html')));
});

// ================= manual outfits are never touched =================
check('suggesting changes nothing it is given: pieces, wear history and planned outfits', () => {
    const items = [TOP('striped', 'bold'), BOT('plaid', 'bold'), P('b2', 'Black skirt', 'bottoms', 'solid')];
    const worn = [{ date: '2026-11-10', itemIds: ['t1', 'b1'] }];
    const input = { items, dateKey: '2026-11-22', weather: null, texts: [], worn, weekendPlanned: [{ date: '2026-11-21', itemIds: ['t1', 'b1'] }] };
    const before = JSON.stringify(input);
    const a = suggestOutfits(input), b = suggestOutfits(J(input));
    assert.strictEqual(JSON.stringify(input), before);
    assert.deepStrictEqual(J(a), J(b), 'the same answer every time');
});
check('an outfit the person made by hand with two bold patterns is left exactly as it is, and still counts as worn history', () => {
    const items = [P('t1', 'Striped top', 'tops', 'striped', 'bold'), P('b1', 'Plaid skirt', 'bottoms', 'plaid', 'bold'), P('t2', 'Plain tee', 'tops', 'solid'), P('b2', 'Black skirt', 'bottoms', 'solid')];
    const manual = { id: 'o1', label: 'Class', itemIds: ['t1', 'b1'], worn: true };
    const planned = J([manual]), before = JSON.stringify(planned);
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise });
    for (const f of ['js/outfit-suggest.js', 'js/help-choose.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext('this.api = { buildDayContext };', ctx);
    const day = ctx.api.buildDayContext('2026-11-22', { closet: items, outfitsByDate: { '2026-11-12': planned }, prefs: {} });
    assert.strictEqual(JSON.stringify(planned), before, 'the planned outfit was only read');
    assert.deepStrictEqual(J(day.worn), [{ date: '2026-11-12', itemIds: ['t1', 'b1'] }], 'a manual outfit still counts as worn');
});
check('applying a manual outfit is the same as before: pattern scoring is not in that path', () => {
    const day = [{ id: 'o1', label: '', itemIds: ['t1', 'b1'], worn: false }];
    assert.strictEqual(planApplySavedOutfit({ dayOutfits: day, activeId: 'o1', savedItemIds: ['t1', 'b1'] }).action, 'already');
    for (const f of ['js/apply-outfit.js', 'js/calendar.js', 'js/closet.js']) assert(!/patternAnalysis|patternCheck|SUGGEST_PATTERN_CLASH/.test(read(f)), f);
    assert(!/patternAnalysis|SUGGEST_PATTERN/.test(read('js/help-choose.js')), 'the panel only shows what the engine said');
});
check('the scoring lives only in the suggestion engine, which is pure: it can read nothing stored and write nothing', () => {
    assert(!/Store\.|localStorage|fetch\(|document\./.test(read('js/outfit-suggest.js')));
});

// ================= the editor and the panel =================
const html = read('index.html');
check('the item editor has Pattern (Unknown + five choices) and Pattern strength (Unknown, Subtle, Bold)', () => {
    const options = (id) => [...(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html)[1]).matchAll(/<option value="([^"]*)">([^<]*)</g)];
    const pat = options('modal-pattern'), str = options('modal-pattern-strength');
    assert.deepStrictEqual(pat.map(m => m[1]), ['', ...SUGGEST_PATTERNS]);
    assert.strictEqual(pat[0][2], 'Unknown (not set)');
    assert.deepStrictEqual(str.map(m => m[1]), ['', ...SUGGEST_PATTERN_STRENGTHS]);
    assert.strictEqual(str[0][2], 'Unknown (not set)');
    assert(/<label for="modal-pattern">Pattern<\/label>/.test(html) && /<label for="modal-pattern-strength">Pattern strength<\/label>/.test(html));
});
check('the editor hint explains soft scoring and unknowns, in plain words', () => {
    const hint = /<p id="modal-pattern-hint"[^>]*>([^<]*)</.exec(html)[1];
    assert(/ranks two bold patterns together lower/.test(hint) && /bold pattern with a subtle one as fine/.test(hint) && /Nothing is ruled out/.test(hint) && /never guessed/.test(hint) && /couldn’t check/.test(hint), hint);
});
check('the editor refills both fields, notices a change in them, and saves them only through the patch helpers (so unlabeled pieces are not rewritten)', () => {
    const src = read('js/closet.js');
    assert(/getElementById\('modal-pattern'\)\.value = savedPattern === 'unknown' \? '' : savedPattern/.test(src));
    assert(/getElementById\('modal-pattern-strength'\)\.value = savedStrength === 'unknown' \? '' : savedStrength/.test(src));
    const form = src.slice(src.indexOf('function readEditForm'));
    assert(/pattern: document\.getElementById\('modal-pattern'\)\.value,/.test(form) && /patternStrength: document\.getElementById\('modal-pattern-strength'\)\.value,/.test(form), 'part of "did anything change?"');
    const patch = src.slice(src.indexOf('async function saveEditModal'), src.indexOf('async function deleteEditingItem'));
    assert(/\.\.\.patternPatch\(existing, document\.getElementById\('modal-pattern'\)\.value\)/.test(patch) && /\.\.\.patternStrengthPatch\(existing, document\.getElementById\('modal-pattern-strength'\)\.value\)/.test(patch));
    assert(!/pattern: document|patternStrength: document/.test(patch), 'never writes the fields directly');
});
check('Help me choose shows each idea\'s pattern line, amber when the check was incomplete or the patterns compete', () => {
    const src = read('js/help-choose.js');
    assert(/choose-pattern/.test(src) && /is-incomplete/.test(src) && /is-competing/.test(src) && /s\.pattern\.text/.test(src));
    assert(/\.choose-pattern\.is-incomplete, \.choose-pattern\.is-competing/.test(read('css/components.css')));
});
check('free and on the device: no network, no key, no new service', () => {
    assert(!/fetch\(|httpsCallable|apiKey/i.test(read('js/outfit-suggest.js')));
});

done();
