// Pieces with more than one color (js/outfit-suggest.js, js/colors.js, the item editor): a solid piece has to go with EVERY color of a
// patterned piece, not just its main one. Plain Node, no packages: node tests/multicolor.test.js
const { check, done, assert, read, vm } = require('./_harness');
const S = require('../js/outfit-suggest.js');
const C = require('../js/colors.js');
const { suggestOutfits, describePiece, sgPieceColors, sgColorsCoordinate, sgColorName, colorAnalysis, colorCheck, sgSharedColor, SUGGEST_COLOR_CLASH, SUGGEST_COLOR_MAX_PENALTY } = S;

const J = (x) => JSON.parse(JSON.stringify(x));
const CAMEL = '#c19a6b', TAN = '#c8a77a', BLUE = '#2f6fd0', NAVY = '#1f2a52', CREAM = '#f0e6d2', WHITE = '#f5f5f5', BLACK = '#222222';
const RED = '#c62828', GREEN = '#3f8f4f', DKGREEN = '#1f5a35', SKY = '#87ceeb', PINK = '#f4a6c0', BURGUNDY = '#6d1a2b', PURPLE = '#7b3fa0';
const P = (id, name, category, color, extra = {}) => ({ id, name, category, color, occasion: 'casual', season: 'all-season', tagged: true, ...extra });
const run = (items, more = {}) => suggestOutfits({ items, dateKey: '2026-11-22', weather: null, texts: [], worn: [], weekendPlanned: [], ...more }, more.options);
const SWEATER = P('sw', 'Camel sweater', 'tops', CAMEL, { pattern: 'solid' });
const skirt = (other, extra = {}) => P('sk', 'Tan and blue striped maxi skirt', 'bottoms', TAN, { pattern: 'striped', ...(other ? { otherColors: other } : {}), ...extra });

// ================= a piece's colors =================
check('a piece\'s colors are its main color first, then any others saved; one color when nothing else is saved', () => {
    assert.deepStrictEqual(sgPieceColors(P('a', 'x', 'tops', TAN)), [TAN]);
    assert.deepStrictEqual(sgPieceColors(P('a', 'x', 'tops', TAN, { otherColors: [BLUE] })), [TAN, BLUE]);
    assert.deepStrictEqual(sgPieceColors(P('a', 'x', 'tops', 'C8A77A', { otherColors: ['#2F6FD0'] })), [BLUE], 'a main color that is not a real hex is left out');
    assert.deepStrictEqual(sgPieceColors(P('a', 'x', 'tops', '#C8A77A', { otherColors: ['#2F6FD0'] })), [TAN, BLUE], 'lowercased');
});
check('bad, repeated and extra colors are left out, and no more than four are kept', () => {
    assert.deepStrictEqual(sgPieceColors(P('a', 'x', 'tops', TAN, { otherColors: ['red', '#12345', null, 5, BLUE, BLUE, TAN] })), [TAN, BLUE]);
    assert.deepStrictEqual(sgPieceColors(P('a', 'x', 'tops', TAN, { otherColors: [BLUE, RED, GREEN, PINK, PURPLE] })).length, 4);
    assert.deepStrictEqual(sgPieceColors(P('a', 'x', 'tops', undefined, { otherColors: [BLUE] })), [BLUE], 'no main color: the others still count');
    assert.deepStrictEqual(sgPieceColors(P('a', 'x', 'tops', TAN, { otherColors: 'blue' })), [TAN]);
    assert.deepStrictEqual(sgPieceColors(null), []);
});
check('describing a piece does not change it, and an unlabeled piece stays one-colored', () => {
    const item = P('a', 'x', 'tops', TAN), before = JSON.stringify(item);
    assert.deepStrictEqual(describePiece(item).colors, [TAN]);
    assert.strictEqual(JSON.stringify(item), before);
    assert(!('otherColors' in item));
});

// ================= which colors coordinate =================
check('camel does not coordinate with a bright blue (the reported case), but does with tan, navy, white, black and cream', () => {
    assert.strictEqual(sgColorsCoordinate(CAMEL, BLUE), 'clash');
    for (const ok of [TAN, NAVY, WHITE, BLACK, CREAM, BURGUNDY, DKGREEN]) assert.strictEqual(sgColorsCoordinate(CAMEL, ok), 'ok', ok);
    assert.strictEqual(sgColorsCoordinate(BLUE, CAMEL), 'clash', 'the order does not matter');
});
check('neutrals and dark colors go with anything; two different bright colors do not; one family does', () => {
    for (const bright of [BLUE, RED, GREEN, PURPLE, PINK, SKY]) { assert.strictEqual(sgColorsCoordinate(BLACK, bright), 'ok'); assert.strictEqual(sgColorsCoordinate(WHITE, bright), 'ok'); assert.strictEqual(sgColorsCoordinate('#9a9a9a', bright), 'ok'); assert.strictEqual(sgColorsCoordinate(NAVY, bright), 'ok'); }
    assert.strictEqual(sgColorsCoordinate(RED, BLUE), 'clash');
    assert.strictEqual(sgColorsCoordinate(RED, GREEN), 'clash');
    assert.strictEqual(sgColorsCoordinate(GREEN, PINK), 'clash');
    assert.strictEqual(sgColorsCoordinate(RED, PINK), 'ok', 'reds are one family');
    assert.strictEqual(sgColorsCoordinate(BLUE, SKY), 'ok', 'blues are one family');
});
check('a color that is not real is "unknown", never a clash', () => {
    for (const bad of [undefined, null, '', 'blue', '#12345', 7]) { assert.strictEqual(sgColorsCoordinate(CAMEL, bad), 'unknown', String(bad)); assert.strictEqual(sgColorsCoordinate(bad, CAMEL), 'unknown'); }
});
check('colors are named in plain words for the sentences', () => {
    assert.deepStrictEqual([BLUE, NAVY, TAN, CREAM, BLACK, WHITE, '#9a9a9a', RED, GREEN, '#6b7048'].map(sgColorName), ['blue', 'navy', 'tan', 'cream', 'black', 'white', 'gray', 'red', 'green', 'olive']);
    assert.strictEqual(sgColorName('nope'), 'unknown color');
});

// ================= the reported case: camel sweater, tan-and-blue striped skirt =================
const scoreOf = (items) => run(items).suggestions[0].score;
check('REPORTED: a solid camel sweater with a tan-and-blue skirt is flagged and ranked lower, naming the blue', () => {
    const r = run([SWEATER, skirt([BLUE])]);
    assert.strictEqual(r.suggestions.length, 1, 'the only outfit this closet can make is still shown (a penalty, not a ban)');
    const c = r.suggestions[0].color;
    assert.strictEqual(c.status, 'clash');
    assert.deepStrictEqual(c.clashes, [{ single: 'Camel sweater', multi: 'Tan and blue striped maxi skirt', colors: [BLUE] }]);
    assert(/Camel sweater \(tan\) doesn’t go with the blue in Tan and blue striped maxi skirt, so this idea ranks lower/.test(c.text), c.text);
    assert(r.notes.some(t => /Every idea here pairs a solid piece with a pattern that has a color it doesn’t go with/.test(t)));
});
check('the same skirt with only its tan known is NOT penalized, and the idea says the rest of its colors weren\'t known', () => {
    const only = run([SWEATER, skirt(undefined)]).suggestions[0];
    assert.strictEqual(only.color.status, 'incomplete');
    assert.deepStrictEqual(only.color.clashes, []);
    assert(/Color check incomplete: I only know one color for Tan and blue striped maxi skirt, so I can’t check the other colors in its pattern\. You can add them in its details\./.test(only.color.text), only.color.text);
    const full = run([SWEATER, skirt([BLUE])]).suggestions[0];
    assert.strictEqual(only.score - full.score, 25, 'saving the blue costs the outfit 25 points');
});
check('the camel sweater is paired with a skirt it goes with when the closet has one, and the clashing pair is not the first idea', () => {
    const items = [SWEATER, P('sw2', 'White tee', 'tops', WHITE, { pattern: 'solid' }), skirt([BLUE]), P('sk2', 'Black skirt', 'bottoms', BLACK, { pattern: 'solid' })];
    const r = run(items, { options: { max: 3 } });
    r.suggestions.forEach(s => assert(!(s.itemIds.includes('sw') && s.itemIds.includes('sk')), 'camel with the blue skirt: ' + s.itemIds));
    assert(r.suggestions.some(s => s.itemIds.includes('sk') && s.itemIds.includes('sw2')), 'the skirt is still used, with a top that goes with all of its colors');
});
check('with every color of the pattern in agreement the idea says so', () => {
    const c = run([SWEATER, skirt([CREAM])]).suggestions[0].color;
    assert.strictEqual(c.status, 'checked');
    assert(/Tan and blue striped maxi skirt’s colors \(tan, cream\) all go with Camel sweater/.test(c.text), c.text);
});

// ================= EVERY color must coordinate =================
check('one clashing color among several is enough, and only the clashing ones are named', () => {
    assert.strictEqual(run([SWEATER, skirt([CREAM, NAVY])]).suggestions[0].color.status, 'checked', 'cream and navy both go with camel');
    const one = run([SWEATER, skirt([CREAM, BLUE])]).suggestions[0].color;
    assert.deepStrictEqual([one.status, one.clashes[0].colors], ['clash', [BLUE]]);
    const two = run([SWEATER, skirt([BLUE, PINK, NAVY])]).suggestions[0].color;
    assert.deepStrictEqual(two.clashes[0].colors, [BLUE, PINK]);
    assert(/the blue, light pink in/.test(two.text), two.text);
});
check('a pair costs 25 points however many of the pattern\'s colors clash', () => {
    const base = scoreOf([SWEATER, skirt([CREAM])]);
    assert.strictEqual(base - scoreOf([SWEATER, skirt([BLUE])]), 25);
    assert.strictEqual(base - scoreOf([SWEATER, skirt([BLUE, PINK])]), 25);
    assert.strictEqual(SUGGEST_COLOR_CLASH, 0.25);
});
check('the penalty is capped at 40 points however many pieces clash', () => {
    const items = [SWEATER, skirt([BLUE]), P('sh', 'Striped shoes', 'shoes', TAN, { pattern: 'striped', otherColors: [PINK] }), P('co', 'Plaid coat', 'outerwear', TAN, { pattern: 'plaid', otherColors: [PURPLE] })];
    const parts = items.map(describePiece);
    const an = colorAnalysis(parts);
    assert.strictEqual(an.clashes.length, 3);
    assert.strictEqual(an.adjust, -0.4);
    assert.strictEqual(SUGGEST_COLOR_MAX_PENALTY, 0.4);
});
check('a single-color piece is a solid one or one whose pattern is not known; a patterned piece with one color is not checked as a solid', () => {
    const unknownPattern = P('u', 'Camel sweater', 'tops', CAMEL);                         // no pattern saved: one color, checked like a solid
    assert.strictEqual(run([unknownPattern, skirt([BLUE])]).suggestions[0].color.status, 'clash');
    const patternedOne = P('p', 'Camel plaid sweater', 'tops', CAMEL, { pattern: 'plaid' });
    assert.strictEqual(run([patternedOne, skirt([BLUE])]).suggestions[0].color.status, 'incomplete', 'two patterns: the pattern rules judge them, not this check');
    assert.deepStrictEqual(run([patternedOne, skirt([BLUE])]).suggestions[0].color.clashes, []);
});
check('two multi-color pieces are not color-clash checked against each other (patterns handle that); shared colors across lists count', () => {
    const a = P('a', 'Striped top', 'tops', TAN, { pattern: 'striped', patternStrength: 'subtle', otherColors: [BLUE] });
    const b = P('b', 'Plaid skirt', 'bottoms', RED, { pattern: 'plaid', patternStrength: 'subtle', otherColors: ['#2c6bd0'] });
    const r = run([a, b]).suggestions[0];
    assert.deepStrictEqual(r.color.clashes, []);
    assert(sgSharedColor(describePiece(a), describePiece(b)), 'the blues are shared even though the main colors are far apart');
    assert(/share a similar color/.test(r.pattern.text));
    assert(!sgSharedColor(describePiece(P('a', 'x', 'tops', TAN, { otherColors: [BLUE] })), describePiece(P('b', 'y', 'tops', RED, { otherColors: [GREEN] }))));
});
check('colors it cannot read are never a clash', () => {
    const r = run([SWEATER, skirt(['not a color', '#12345'])]);
    assert.strictEqual(r.suggestions[0].color.status, 'incomplete', 'it only knows the one color');
    assert.deepStrictEqual(r.suggestions[0].color.clashes, []);
});

// ================= nothing else changes =================
check('closets with one color per piece score exactly as before: the same with or without an empty other-colors list', () => {
    const items = [P('t1', 'White tee', 'tops', WHITE), P('t2', 'Navy top', 'tops', NAVY), P('b1', 'Jeans', 'bottoms', '#4a6fa5'), P('b2', 'Black skirt', 'bottoms', BLACK), P('s1', 'Sneakers', 'shoes', WHITE)];
    const a = run(items), b = run(items.map(i => ({ ...i, otherColors: [] })));
    assert.deepStrictEqual(a.suggestions.map(s => [s.signature, s.score, s.reason]), b.suggestions.map(s => [s.signature, s.score, s.reason]));
    a.suggestions.forEach(s => { assert.strictEqual(s.color.clashes.length, 0); assert.strictEqual(s.color.text, '', 'nothing to say when no piece has several colors'); });
});
check('a clash is a penalty, never a ban: a closet where every outfit clashes still gets ideas, ranked, with the reason', () => {
    const items = [P('t1', 'Camel top', 'tops', CAMEL, { pattern: 'solid' }), P('t2', 'Tan top', 'tops', TAN, { pattern: 'solid' }), skirt([BLUE]), P('sk2', 'Plaid skirt', 'bottoms', TAN, { pattern: 'plaid', otherColors: [PINK] })];
    const r = run(items, { options: { max: 3 } });
    assert(r.suggestions.length >= 2);
    r.suggestions.forEach(s => assert.strictEqual(s.color.status, 'clash'));
});
check('suggesting changes nothing it is given, and gives the same answer every time', () => {
    const items = [SWEATER, skirt([BLUE]), P('b2', 'Black skirt', 'bottoms', BLACK)], input = { items, dateKey: '2026-11-22', weather: null, texts: [], worn: [], weekendPlanned: [] };
    const before = JSON.stringify(input);
    const a = suggestOutfits(input), b = suggestOutfits(J(input));
    assert.strictEqual(JSON.stringify(input), before);
    assert.deepStrictEqual(J(a), J(b));
});
check('outfits made by hand are not touched: this is only in the suggestion engine', () => {
    for (const f of ['js/apply-outfit.js', 'js/calendar.js']) assert(!/colorAnalysis|colorCheck|sgColorsCoordinate/.test(read(f)), f);
    assert(!/Store\.|localStorage|fetch\(|document\./.test(read('js/outfit-suggest.js')));
});

// ================= the editor's helpers (js/colors.js) =================
check('other colors are cleaned for storing: real hexes, lowercase, no repeats, not the main color, at most three', () => {
    assert.deepStrictEqual(C.cleanOtherColors(['#2F6FD0', '#2f6fd0', 'red', '#12345', null, '#C8A77A'], TAN), [BLUE]);
    assert.deepStrictEqual(C.cleanOtherColors([BLUE, RED, GREEN, PINK], TAN), [BLUE, RED, GREEN]);
    assert.deepStrictEqual(C.cleanOtherColors(undefined, TAN), []);
    assert.deepStrictEqual(C.cleanOtherColors('blue', TAN), []);
});
check('the name suggests the colors the main color does not cover', () => {
    assert.deepStrictEqual(C.suggestOtherColors('Tan and blue striped maxi skirt', TAN), [C.COLOR_NAMES.blue]);
    assert.deepStrictEqual(C.suggestOtherColors('Tan and blue striped maxi skirt', C.COLOR_NAMES.blue), [C.COLOR_NAMES.tan]);
    assert.deepStrictEqual(C.suggestOtherColors('Tan and blue striped maxi skirt', BLACK), [C.COLOR_NAMES.tan, C.COLOR_NAMES.blue], 'a main color that is neither: both');
    assert.deepStrictEqual(C.suggestOtherColors('Navy tee', NAVY), []);
    assert.deepStrictEqual(C.suggestOtherColors('Striped maxi skirt', TAN), [], 'no color word: nothing guessed');
    assert.deepStrictEqual(C.suggestOtherColors('', TAN), []);
    assert.deepStrictEqual(C.suggestOtherColors('Red, blue, green and pink floral dress', RED).length, 3, 'at most three');
});
check('a color close to the main one, or to one already suggested, is not suggested again', () => {
    assert.deepStrictEqual(C.suggestOtherColors('Tan and camel and blue skirt', TAN), [C.COLOR_NAMES.blue], 'camel is close to tan');
    assert.deepStrictEqual(C.suggestOtherColors('Blue and navy blue top', '#9a9a9a').length >= 1, true);
});
check('what the editor saves for other colors: chosen ones are saved; a piece that never had any is left alone; clearing writes null', () => {
    assert.deepStrictEqual(J(C.otherColorsPatch({}, [BLUE], TAN)), { otherColors: [BLUE] });
    assert.deepStrictEqual(J(C.otherColorsPatch({}, [], TAN)), {});
    assert.deepStrictEqual(J(C.otherColorsPatch({ name: 'x' }, undefined, TAN)), {});
    assert.deepStrictEqual(J(C.otherColorsPatch({ otherColors: null }, [], TAN)), {});
    assert.deepStrictEqual(J(C.otherColorsPatch({ otherColors: [] }, [], TAN)), {});
    assert.deepStrictEqual(J(C.otherColorsPatch({ otherColors: [BLUE] }, [], TAN)), { otherColors: null });
    assert.deepStrictEqual(J(C.otherColorsPatch({ otherColors: [BLUE] }, [TAN], TAN)), { otherColors: null }, 'only the main color left: nothing extra');
});
check('colors have plain names for the editor note', () => {
    assert.strictEqual(C.nameOfColor(C.COLOR_NAMES.blue), 'blue');
    assert.strictEqual(C.nameOfColor('#123456'), '#123456');
});

// ================= the editor =================
function makeEditor() {
    const mk = () => { const c = new Set(['hidden']); return { value: '', textContent: '', classList: { toggle: (k, f) => { if (f) c.add(k); else c.delete(k); }, contains: (k) => c.has(k) } }; };
    const els = { 'modal-name': mk(), 'modal-color': mk(), 'modal-colors-note': mk() };
    const src = read('js/closet.js');
    const from = src.indexOf('function applyColorsFromName'), to = src.indexOf('// One color picker per other color');
    assert(from > 0 && to > from);
    const ctx = vm.createContext({ document: { getElementById: (id) => els[id] }, cleanOtherColors: C.cleanOtherColors, suggestOtherColors: C.suggestOtherColors, nameOfColor: C.nameOfColor, console });
    vm.runInContext('let editOtherColors = [], colorsTouched = false, colorsFromName = false; let renders = 0; function renderOtherColors() { renders++; }\n' + src.slice(from, to) +
        '\nthis.api = { apply: applyColorsFromName, list: () => editOtherColors.slice(), touch: (l) => { editOtherColors = l; colorsTouched = true; colorsFromName = false; showColorsNote(""); }, renders: () => renders };', ctx);
    const view = () => ({ colors: J(ctx.api.list()), note: els['modal-colors-note'].classList.contains('hidden') ? '(none)' : els['modal-colors-note'].textContent });
    const type = (name, main, saved) => { els['modal-name'].value = name; els['modal-color'].value = main; ctx.api.apply(saved); };
    return { api: ctx.api, view, type };
}
check('opening a piece with no other colors whose name names more: pre-filled, labeled as a suggestion', () => {
    const e = makeEditor();
    e.type('Tan and blue striped maxi skirt', TAN, undefined);
    assert.deepStrictEqual(e.view(), { colors: [C.COLOR_NAMES.blue], note: 'Suggested from the name: blue. Please check it.' });
});
check('typing a new name changes the suggestion; a name with no new color takes it back', () => {
    const e = makeEditor();
    e.type('Tan and blue striped maxi skirt', TAN, undefined);
    e.type('Tan and pink striped maxi skirt', TAN, undefined);
    assert.deepStrictEqual(e.view().colors, [C.COLOR_NAMES.pink]);
    e.type('Tan striped maxi skirt', TAN, undefined);
    assert.deepStrictEqual(e.view(), { colors: [], note: '(none)' });
});
check('changing the main color changes what the name still has to add', () => {
    const e = makeEditor();
    e.type('Tan and blue striped maxi skirt', TAN, undefined);
    assert.deepStrictEqual(e.view().colors, [C.COLOR_NAMES.blue]);
    e.type('Tan and blue striped maxi skirt', C.COLOR_NAMES.blue, undefined);
    assert.deepStrictEqual(e.view().colors, [C.COLOR_NAMES.tan]);
});
check('once the owner adds, changes or removes a color, the name stops suggesting: their choice is never replaced', () => {
    const e = makeEditor();
    e.type('Tan and blue striped maxi skirt', TAN, undefined);
    e.api.touch([]);                                       // they removed the suggested blue
    e.type('Tan and pink striped maxi skirt', TAN, undefined);
    assert.deepStrictEqual(e.view(), { colors: [], note: '(none)' });
    const f = makeEditor();
    f.type('Tan skirt', TAN, undefined);
    f.api.touch([PURPLE]);
    f.type('Tan and blue skirt', TAN, undefined);
    assert.deepStrictEqual(f.view().colors, [PURPLE]);
});
check('colors already saved always win, and get no note', () => {
    const e = makeEditor();
    e.type('Tan and blue striped maxi skirt', TAN, [RED]);
    assert.deepStrictEqual(e.view(), { colors: [], note: '(none)' }, 'the saved list was loaded by the editor before this; the name adds nothing');
    e.type('Tan and pink striped maxi skirt', TAN, [RED]);
    assert.strictEqual(e.view().note, '(none)');
});
check('a name with no color word leaves nothing suggested, and nothing is made up', () => {
    const e = makeEditor();
    e.type('Striped maxi skirt', TAN, undefined);
    assert.deepStrictEqual(e.view(), { colors: [], note: '(none)' });
});

// ================= wiring =================
const html = read('index.html'), closet = read('js/closet.js');
check('the editor has the other-colors area: a list, an Add button, a suggestion note and a hint', () => {
    for (const id of ['modal-other-colors-label', 'modal-other-colors', 'modal-add-color-btn', 'modal-colors-note', 'modal-colors-hint']) assert(html.includes(`id="${id}"`), id);
    assert(/<div id="modal-other-colors" class="other-colors" role="group" aria-labelledby="modal-other-colors-label">/.test(html));
    assert(/Other colors in this piece \(optional\)/.test(html) && html.includes('+ Add another color'));
    assert(/<p id="modal-colors-note" class="category-note hidden" role="status">/.test(html));
});
check('the editor loads the saved colors, notices changes in them, and saves them only through the patch helper (so other pieces are not rewritten)', () => {
    assert(/editOtherColors = cleanOtherColors\(item\.otherColors, item\.color\);/.test(closet));
    assert(/otherColors: editOtherColors\.join\(','\),/.test(closet.slice(closet.indexOf('function readEditForm'))), 'part of "did anything change?"');
    const patch = closet.slice(closet.indexOf('async function saveEditModal'), closet.indexOf('async function deleteEditingItem'));
    assert(/\.\.\.otherColorsPatch\(existing, editOtherColors, document\.getElementById\('modal-color'\)\.value\)/.test(patch));
    assert(!/otherColors: editOtherColors/.test(patch), 'never writes the field directly');
});
check('the editor follows the name and the main color, offers at most three extra colors, and clears its state on close', () => {
    assert(/getElementById\('modal-name'\)\.addEventListener\('input'[\s\S]*?applyColorsFromName\(item\.otherColors\)/.test(closet));
    assert(/getElementById\('modal-color'\)\.addEventListener\('input'/.test(closet));
    assert(/if \(editOtherColors\.length >= OTHER_COLORS_MAX\) return;/.test(closet));
    assert(/function closeEditModal\(\) \{\s*editOtherColors = \[\];\s*colorsTouched = false;\s*colorsFromName = false;/.test(closet));
});
check('closet cards show a dot for each other color, from validated colors only', () => {
    assert(/\$\{otherColorDots\(item\)\}/.test(closet));
    const fn = closet.slice(closet.indexOf('function otherColorDots'), closet.indexOf('function updateTagQueueUI'));
    assert(/cleanOtherColors\(item\.otherColors, item\.color\)/.test(fn));
});
check('Help me choose shows the color check line, amber for a clash or an incomplete check', () => {
    const src = read('js/help-choose.js');
    assert(/s\.color && s\.color\.text/.test(src) && /s\.color\.status === 'clash' \? ' is-competing'/.test(src) && /'incomplete' \? ' is-incomplete'/.test(src));
});
check('free and on the device', () => {
    assert(!/fetch\(|XMLHttpRequest/.test(read('js/colors.js').replace(/fetch\(.*detectDominantColor.*/g, '')));
});

done();
