// The pattern suggested from an item's name (js/category-guess.js) and how the item editor uses it (js/closet.js): pre-filled and
// labeled as a suggestion, never saved by itself, never replacing a saved or chosen pattern, never guessing strength.
// Plain Node, no packages: node tests/pattern-guess.test.js
const { check, done, assert, read, vm } = require('./_harness');
const { guessPattern, patternSuggestionFor, PATTERN_WORDS, PATTERN_CHOICES } = require('../js/category-guess.js');
const { SUGGEST_PATTERNS } = require('../js/outfit-suggest.js');

const g = (name) => { const r = guessPattern(name); return r ? r.pattern : null; };

// ================= the guess =================
check('the words that name a pattern pre-fill it: plaid, striped, floral, houndstooth and similar', () => {
    const cases = {
        'Navy striped tee': 'striped', 'Pinstripe trousers': 'striped', 'Breton top': 'striped', 'Stripes sweater': 'striped',
        'Red plaid skirt': 'plaid', 'Tartan scarf': 'plaid', 'Buffalo Plaid shirt': 'plaid',
        'Floral midi dress': 'floral', 'Ditsy flowers blouse': 'floral', 'Botanical top': 'floral',
        'Houndstooth blazer': 'other', 'Polka dot dress': 'other', 'Paisley scarf': 'other', 'Gingham shirt': 'other', 'Checkered pants': 'other',
        'Leopard print skirt': 'other', 'Camo jacket': 'other', 'Tie dye hoodie': 'other', 'Argyle sweater': 'other', 'Printed tee': 'other', 'Patterned scarf': 'other',
        'Solid black tee': 'solid'
    };
    for (const [name, want] of Object.entries(cases)) assert.strictEqual(g(name), want, name);
});
check('it reads file-style names: case, hyphens, underscores, extra spaces, an extension', () => {
    for (const name of ['NAVY_STRIPED_TEE.jpg', 'navy-striped-tee', '  Navy   STRIPED   tee ', 'Navy Pin-Striped Tee', 'Navy_Striped.Tee']) assert(['striped'].includes(g(name)), name);
    assert.strictEqual(g('pin-striped shirt'), 'striped');
    assert.strictEqual(g('tie_dye tee'), 'other');
});
check('the word that said it is reported (so the note can quote it)', () => {
    assert.deepStrictEqual(guessPattern('Navy striped tee'), { pattern: 'striped', word: 'striped' });
    assert.deepStrictEqual(guessPattern('Black houndstooth coat'), { pattern: 'other', word: 'houndstooth' });
});
check('no pattern word: no guess', () => {
    for (const name of ['Navy tee', 'Black skirt', 'White sneakers', '', '   ', null, undefined, 12, {}]) assert.strictEqual(guessPattern(name), null, String(name));
});
check('words that only sound like patterns are left alone', () => {
    for (const name of ['Flowy summer dress', 'Rose pink top', 'Checkout tote', 'Stripey?'.slice(0, 0) + 'Spotless white tee', 'Dotty Smith cardigan'.replace('Dotty', 'Dottie'), 'Plaidless tee', 'Floral'.slice(0, 0) + 'Florence top', 'Printer paper tote']) assert.strictEqual(g(name), null, name);
});
check('two different pattern words: the name does not settle it, so no guess; the same pattern twice is fine', () => {
    assert.strictEqual(g('Striped floral top'), null);
    assert.strictEqual(g('Solid black with plaid trim'), null);
    assert.strictEqual(g('Plaid tartan skirt'), 'plaid');
    assert.strictEqual(g('Striped pinstripe suit'), 'striped');
    assert.strictEqual(g('Polka dot printed dress'), 'other');
});
check('every guess is a value the Pattern field can hold, and no word is listed for two patterns', () => {
    assert.deepStrictEqual([...PATTERN_CHOICES].sort(), [...SUGGEST_PATTERNS].sort(), 'the same five choices as the editor and Help me choose');
    const seen = new Map();
    Object.entries(PATTERN_WORDS).forEach(([pattern, words]) => words.forEach(w => { assert(PATTERN_CHOICES.includes(pattern)); assert(!seen.has(w), w + ' is listed twice'); seen.set(w, pattern); }));
});
check('only a pattern is ever suggested: nothing about strength (bold or subtle) comes out of a name', () => {
    for (const name of ['Bold striped tee', 'Subtle plaid skirt', 'Loud floral dress']) {
        const r = patternSuggestionFor(name, '');
        assert.deepStrictEqual(Object.keys(r).sort(), ['kind', 'pattern', 'text', 'word']);
        assert(!/strength|bold|subtle/i.test(JSON.stringify(r.pattern) + r.kind));
    }
    assert.strictEqual(g('Bold striped tee'), 'striped');
});

// ================= what the editor's Pattern field starts as =================
check('nothing saved: the name pre-fills it, labeled as a suggestion that needs checking', () => {
    const s = patternSuggestionFor('Navy striped tee', undefined);
    assert.deepStrictEqual([s.pattern, s.kind, s.word], ['striped', 'guess', 'striped']);
    assert.strictEqual(s.text, 'Suggested “Striped” from the name (“striped”). Please check it.');
    assert.strictEqual(patternSuggestionFor('Navy striped tee').kind, 'guess', 'no second argument: never set');
    // only an ABSENT field is "never set": anything present (including null, "unknown" and an empty string) is a decision already made
    for (const saved of [null, '', 'unknown', 'Unknown', 'mystery', 5]) assert.deepStrictEqual(patternSuggestionFor('Navy striped tee', saved), { pattern: '', kind: 'decided', word: '', text: '' }, String(saved));
});
check('a pattern that is already saved always wins, even when the name says something else', () => {
    for (const saved of ['solid', 'striped', 'plaid', 'floral', 'other', ' Plaid ']) {
        const s = patternSuggestionFor('Navy striped tee', saved);
        assert.strictEqual(s.kind, 'saved');
        assert.strictEqual(s.pattern, saved.trim().toLowerCase());
        assert.strictEqual(s.text, '');
    }
});
check('no pattern word and nothing saved: the field stays Unknown, with no note', () => {
    assert.deepStrictEqual(patternSuggestionFor('Navy tee', undefined), { pattern: '', kind: 'none', word: '', text: '' });
});

// ================= the editor =================
// The two small functions that drive the editor are run for real against stand-in form fields.
function makeEditor() {
    const mk = () => { const c = new Set(['hidden']); return { value: '', textContent: '', classList: { toggle: (k, f) => { if (f) c.add(k); else c.delete(k); }, contains: (k) => c.has(k) } }; };
    const els = { 'modal-name': mk(), 'modal-pattern': mk(), 'modal-pattern-note': mk() };
    const src = read('js/closet.js');
    const from = src.indexOf('function applyPatternFromName'), to = src.indexOf('function closeEditModal');
    assert(from > 0 && to > from);
    const guess = require('../js/category-guess.js');
    const ctx = vm.createContext({ document: { getElementById: (id) => els[id] }, patternSuggestionFor: guess.patternSuggestionFor, console });
    vm.runInContext('let patternTouched = false, patternFromName = false;\n' + src.slice(from, to) + '\nthis.api = { apply: applyPatternFromName, touch: () => { patternTouched = true; patternFromName = false; showPatternNote(""); }, reset: () => { patternTouched = false; patternFromName = false; } };', ctx);
    const view = () => ({ pattern: els['modal-pattern'].value, note: els['modal-pattern-note'].textContent, noteHidden: els['modal-pattern-note'].classList.contains('hidden'), flagged: els['modal-pattern'].classList.contains('is-unconfirmed') });
    const type = (name, saved) => { els['modal-name'].value = name; ctx.api.apply(saved); };
    return { els, api: ctx.api, view, type };
}
check('opening a piece with no pattern whose name says one: pre-filled, with the suggestion note', () => {
    const e = makeEditor();
    e.type('Navy striped tee', undefined);
    assert.deepStrictEqual(e.view(), { pattern: 'striped', note: 'Suggested “Striped” from the name (“striped”). Please check it.', noteHidden: false, flagged: true });
});
check('typing a new name changes the suggestion; a name with no pattern word takes it back to Unknown', () => {
    const e = makeEditor();
    e.type('Navy striped tee', undefined);
    e.type('Navy floral tee', undefined);
    assert.strictEqual(e.view().pattern, 'floral');
    e.type('Navy tee', undefined);
    assert.deepStrictEqual(e.view(), { pattern: '', note: '', noteHidden: true, flagged: false });
    e.type('Navy houndstooth tee', undefined);
    assert.strictEqual(e.view().pattern, 'other');
    e.type('Navy striped floral tee', undefined);
    assert.strictEqual(e.view().pattern, '', 'two different words: no suggestion, and the old one is taken back');
});
check('once the owner chooses a pattern, the name stops suggesting: their choice is never replaced', () => {
    const e = makeEditor();
    e.type('Navy striped tee', undefined);
    e.els['modal-pattern'].value = 'solid'; e.api.touch();
    assert.deepStrictEqual(e.view(), { pattern: 'solid', note: '', noteHidden: true, flagged: false });
    e.type('Navy floral tee', undefined);
    assert.strictEqual(e.view().pattern, 'solid');
    e.type('Navy tee', undefined);
    assert.strictEqual(e.view().pattern, 'solid', 'and it is not taken back either');
});
check('choosing Unknown yourself is a choice too: the name does not fill it back in', () => {
    const e = makeEditor();
    e.type('Navy striped tee', undefined);
    e.els['modal-pattern'].value = ''; e.api.touch();
    e.type('Navy striped tee 2', undefined);
    assert.strictEqual(e.view().pattern, '');
});
check('a piece with a pattern already saved is never changed by its name, and gets no note', () => {
    const e = makeEditor();
    e.els['modal-pattern'].value = 'plaid';                  // what opening the editor puts there from the saved piece
    e.type('Navy striped tee', 'plaid');
    assert.deepStrictEqual(e.view(), { pattern: 'plaid', note: '', noteHidden: true, flagged: false });
    e.type('Navy floral tee', 'plaid');
    assert.strictEqual(e.view().pattern, 'plaid');
});
check('a piece with no pattern word and nothing saved is left Unknown (never made solid)', () => {
    const e = makeEditor();
    e.type('Navy tee', undefined);
    assert.deepStrictEqual(e.view(), { pattern: '', note: '', noteHidden: true, flagged: false });
});
check('opening another piece starts fresh: nothing carries over from the last one', () => {
    const e = makeEditor();
    e.type('Navy striped tee', undefined);
    e.els['modal-pattern'].value = 'solid'; e.api.touch();
    e.api.reset(); e.els['modal-pattern'].value = '';
    e.type('Red plaid skirt', undefined);
    assert.strictEqual(e.view().pattern, 'plaid');
});

// ================= wiring =================
const html = read('index.html'), closet = read('js/closet.js');
check('the editor has a place for the suggestion note, tied to the Pattern field', () => {
    assert(/<p id="modal-pattern-note" class="category-note hidden" role="status"><\/p>/.test(html));
    assert(/<select id="modal-pattern" aria-describedby="modal-pattern-note modal-pattern-hint">/.test(html));
});
check('the editor follows the name as it is typed, and a choice in the field ends the suggestions', () => {
    assert(/getElementById\('modal-name'\)\.addEventListener\('input', \(\) => \{\s*const item = liveCloset\.find\(i => i\.id === currentEditingItemId\);\s*if \(item\) \{ applyPatternFromName\(item\.pattern\);/.test(closet));
    assert(/getElementById\('modal-pattern'\)\.addEventListener\('change', \(\) => \{ patternTouched = true; patternFromName = false; showPatternNote\(''\); \}\);/.test(closet));
    assert(/initPatternField\(item\);/.test(closet.slice(closet.indexOf('function openEditModal'), closet.indexOf('function showCategoryNote'))), 'also when the window opens');
    assert(/function initPatternField\(item\) \{[\s\S]*?applyPatternFromName\(item\.pattern\);/.test(closet));
});
check('nothing is saved by the suggestion itself: adding a photo never sets a pattern, and saving goes through the same patch as before', () => {
    const add = closet.slice(closet.indexOf('async function addImageFiles'), closet.indexOf('// Closes a popup when the dark backdrop'));
    assert(!/pattern/i.test(add), 'a new piece is created without a pattern; the suggestion appears in the editor');
    const patch = closet.slice(closet.indexOf('async function saveEditModal'), closet.indexOf('async function deleteEditingItem'));
    assert(/\.\.\.patternFormPatch\(existing\)/.test(patch));
    assert(/function patternFormPatch\(existing\) \{\s*return patternPatch\(existing, document\.getElementById\('modal-pattern'\)\.value, patternTouched\);/.test(closet));
    assert(!/patternSuggestionFor|guessPattern/.test(patch), 'the save reads the form, which is what the owner confirmed');
});
check('strength is never touched by the name', () => {
    const fn = closet.slice(closet.indexOf('function applyPatternFromName'), closet.indexOf('function closeEditModal'));
    assert(!/strength/i.test(fn));
});
check('the guess is free and on the device', () => {
    assert(!/fetch\(|XMLHttpRequest/.test(read('js/category-guess.js')));
});

done();
