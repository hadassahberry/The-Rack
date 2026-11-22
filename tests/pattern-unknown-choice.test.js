// Regression: an Unknown the owner CHOSE must survive reopening, later saves, edits to unrelated fields and a reload, and must not be
// replaced by a name-based suggestion. (Bug: choose Unknown on an item named "...striped...", Save, reopen: the editor showed
// Striped as a suggestion again; saving that untouched stored Striped.) The cause: choosing Unknown on a never-set piece wrote nothing,
// and the suggestion code could not tell "never set" from "Unknown". Now an ABSENT field means never set; an explicit Unknown is
// written as null; anything present is a decision.
//
// The editor's own functions (js/closet.js: initPatternField, applyPatternFromName, patternFormPatch) run for real against stand-in
// form fields, and a stand-in database that merges what is saved and round-trips through JSON (as a reload does).
// Plain Node, no packages: node tests/pattern-unknown-choice.test.js
const { check, done, assert, read, vm } = require('./_harness');
const G = require('../js/category-guess.js');
const S = require('../js/outfit-suggest.js');

const J = (x) => JSON.parse(JSON.stringify(x));

function makeEditor(initialItems) {
    const mk = () => { const c = new Set(['hidden']); return { value: '', textContent: '', classList: { toggle: (k, f) => { if (f) c.add(k); else c.delete(k); }, contains: (k) => c.has(k) } }; };
    const els = { 'modal-name': mk(), 'modal-pattern': mk(), 'modal-pattern-note': mk() };
    const src = read('js/closet.js');
    const from = src.indexOf('function initPatternField'), to = src.indexOf('function closeEditModal');
    assert(from > 0 && to > from);
    // everything between those markers: initPatternField, patternFormPatch, applyPatternFromName, showPatternNote (and the colors helpers, unused here)
    const ctx = vm.createContext({
        document: { getElementById: (id) => els[id] }, console,
        normalizePattern: S.normalizePattern, patternPatch: S.patternPatch, patternSuggestionFor: G.patternSuggestionFor,
        cleanOtherColors: () => [], suggestOtherColors: () => [], nameOfColor: (x) => x,
        renderOtherColors() {}, showColorsNote() {}
    });
    vm.runInContext('let patternTouched = false, patternFromName = false, colorsTouched = false, colorsFromName = false, editOtherColors = [];\n' + src.slice(from, to) +
        '\nthis.api = { init: initPatternField, apply: applyPatternFromName, formPatch: patternFormPatch, touch: () => { patternTouched = true; patternFromName = false; showPatternNote(""); } };', ctx);

    let db = J(initialItems);                         // what is stored, by id
    let current = null;                               // the item the window is open on (as stored when it was opened)
    let snapshot = null;
    const form = () => ({ name: els['modal-name'].value, pattern: els['modal-pattern'].value });
    const ed = {
        stored: (id) => ('pattern' in db[id] ? J(db[id].pattern) : 'ABSENT'),              // what is in the database for the field
        item: (id) => db[id],
        open(id) { current = db[id]; els['modal-name'].value = current.name; ctx.api.init(current); snapshot = form(); },
        view: () => ({ select: els['modal-pattern'].value === '' ? 'Unknown' : els['modal-pattern'].value, note: els['modal-pattern-note'].classList.contains('hidden') ? '' : els['modal-pattern-note'].textContent }),
        dirty: () => JSON.stringify(form()) !== JSON.stringify(snapshot),
        choose(value) { els['modal-pattern'].value = value; ctx.api.touch(); },          // the Pattern dropdown's change handler
        typeName(name) { els['modal-name'].value = name; ctx.api.apply(current.pattern); }, // the name field's input handler
        // Save: the name and the pattern patch, merged into the stored item (what the database does with a merge write)
        save() { const patch = { name: els['modal-name'].value.trim() || current.name, ...ctx.api.formPatch(current) }; db[current.id] = { ...db[current.id], ...patch }; current = null; return patch; },
        cancel() { current = null; },                                                      // closes the window: nothing is written
        reload() { db = J(db); }                                                           // a fresh read from the server: undefined is gone, null stays
    };
    return ed;
}
const ITEM = (extra = {}) => ({ id: 'a', name: 'Navy striped tee', category: 'tops', color: '#1f2a52', ...extra });

// ================= the reported bug, step by step =================
check('REPORTED: choose Unknown on an item whose name says "striped", save, reopen, save untouched, reopen: Unknown survives', () => {
    const e = makeEditor({ a: ITEM() });
    e.open('a');
    assert.deepStrictEqual(e.view(), { select: 'striped', note: 'Suggested “Striped” from the name (“striped”). Please check it.' }, '1. a never-set item shows the labeled suggestion');
    e.choose('');                                                                           // 2. explicitly choose Unknown
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' });
    const patch = e.save();
    assert.strictEqual(patch.pattern, null, 'the choice is written (as null), not dropped');
    assert.strictEqual(e.stored('a'), null, 'stored: an explicit Unknown, not absent');
    e.open('a');                                                                            // 3. reopen
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' }, 'no suggestion comes back');
    e.save();                                                                               // 4. save without touching the field
    assert.strictEqual(e.stored('a'), null, 'still Unknown: nothing replaced it with Striped');
    e.open('a');                                                                            // 5. reopen
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' });
});
check('the explicit Unknown survives a reload (a fresh read from the server)', () => {
    const e = makeEditor({ a: ITEM() });
    e.open('a'); e.choose(''); e.save();
    e.reload();
    assert.strictEqual(e.stored('a'), null, 'null is kept by the round trip');
    e.open('a');
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' });
});
check('it survives saves after editing OTHER fields: a rename, even to a name with another pattern word', () => {
    const e = makeEditor({ a: ITEM() });
    e.open('a'); e.choose(''); e.save(); e.reload();
    e.open('a');
    e.typeName('Navy striped tee, size M');
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' }, 'typing does not bring the suggestion back');
    e.typeName('Navy floral plaid tee');
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' });
    const patch = e.save();
    assert.strictEqual('pattern' in patch, false, 'a save that did not touch the field does not write it');
    assert.strictEqual(e.item('a').name, 'Navy floral plaid tee', 'the other edit was saved');
    assert.strictEqual(e.stored('a'), null);
    e.reload(); e.open('a');
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' });
});
check('many opens and saves in a row never change it', () => {
    const e = makeEditor({ a: ITEM() });
    e.open('a'); e.choose(''); e.save();
    for (let i = 0; i < 5; i++) { e.reload(); e.open('a'); assert.strictEqual(e.view().select, 'Unknown'); e.save(); assert.strictEqual(e.stored('a'), null); }
});

// ================= never set vs decided =================
check('an Unknown that was already stored (null, or the word unknown) is a decision: no suggestion, and saves leave it exactly as it is', () => {
    for (const stored of [null, 'unknown', 'Unknown']) {
        const e = makeEditor({ a: ITEM({ pattern: stored }) });
        e.open('a');
        assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' }, String(stored));
        assert.strictEqual(e.dirty(), false);
        e.typeName('Navy striped tee 2');
        assert.strictEqual(e.view().note, '', 'typing');
        const patch = e.save();
        assert.strictEqual('pattern' in patch, false, 'untouched: not written');
        assert.strictEqual(e.stored('a'), stored, 'exactly as it was');
    }
});
check('a never-set item whose name says nothing: untouched saves leave the field absent (nothing is written)', () => {
    const e = makeEditor({ a: ITEM({ name: 'Navy tee' }) });
    e.open('a');
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' });
    e.save(); e.reload();
    assert.strictEqual(e.stored('a'), 'ABSENT');
});
check('a never-set item can still be suggested: typing a pattern word shows the labeled suggestion, which follows the name', () => {
    const e = makeEditor({ a: ITEM({ name: 'Navy tee' }) });
    e.open('a');
    e.typeName('Navy plaid tee');
    assert.deepStrictEqual(e.view(), { select: 'plaid', note: 'Suggested “Plaid” from the name (“plaid”). Please check it.' });
    e.typeName('Navy floral tee');
    assert.strictEqual(e.view().select, 'floral');
    e.typeName('Navy tee');
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' }, 'taken back when the name no longer says one');
});
check('a never-set item saved with the suggestion showing keeps the suggestion, as before (it was visible and could have been changed)', () => {
    const e = makeEditor({ a: ITEM() });
    e.open('a');
    const patch = e.save();
    assert.strictEqual(patch.pattern, 'striped');
    assert.strictEqual(e.stored('a'), 'striped');
    e.open('a');
    assert.deepStrictEqual(e.view(), { select: 'striped', note: '' }, 'now a saved pattern: no longer labeled a suggestion');
});

// ================= manual and saved choices stay protected =================
check('a pattern the owner chose is never replaced by the name, and is saved', () => {
    const e = makeEditor({ a: ITEM() });
    e.open('a'); e.choose('solid');
    e.typeName('Navy floral tee');
    assert.deepStrictEqual(e.view(), { select: 'solid', note: '' });
    assert.strictEqual(e.save().pattern, 'solid');
    e.reload(); e.open('a'); e.typeName('Navy plaid tee');
    assert.deepStrictEqual(e.view(), { select: 'solid', note: '' }, 'saved choices win over any name');
    e.save();
    assert.strictEqual(e.stored('a'), 'solid');
});
check('a saved pattern is protected on reopen and on later saves, whatever the name says', () => {
    const e = makeEditor({ a: ITEM({ pattern: 'plaid' }) });
    e.open('a');
    assert.deepStrictEqual(e.view(), { select: 'plaid', note: '' });
    e.typeName('Navy striped tee');
    assert.strictEqual(e.view().select, 'plaid');
    assert.strictEqual('pattern' in e.save(), true, 'a known pattern is written back unchanged');
    assert.strictEqual(e.stored('a'), 'plaid');
});
check('choosing Unknown on a SAVED pattern clears it (null), and it then stays Unknown', () => {
    const e = makeEditor({ a: ITEM({ pattern: 'plaid' }) });
    e.open('a'); e.choose(''); e.save();
    assert.strictEqual(e.stored('a'), null);
    e.reload(); e.open('a');
    assert.deepStrictEqual(e.view(), { select: 'Unknown', note: '' }, 'the name ("striped") does not bring a suggestion back');
    e.save();
    assert.strictEqual(e.stored('a'), null);
});
check('choosing a pattern and then Unknown again in the same window is an explicit Unknown', () => {
    const e = makeEditor({ a: ITEM({ name: 'Navy tee' }) });
    e.open('a'); e.choose('floral'); e.choose('');
    assert.strictEqual(e.save().pattern, null);
    assert.strictEqual(e.stored('a'), null);
});

// ================= cancel writes nothing; a suggestion is not a change =================
check('a suggestion alone is not an unsaved change: closing right after opening has nothing to discard', () => {
    const e = makeEditor({ a: ITEM() });
    e.open('a');
    assert.strictEqual(e.view().select, 'striped');
    assert.strictEqual(e.dirty(), false);
    const src = read('js/closet.js');
    const open = src.slice(src.indexOf('function openEditModal'), src.indexOf('// The line under the Category field'));
    assert(open.indexOf('initPatternField(item);') > 0 && open.indexOf('initPatternField(item);') < open.indexOf('editSnapshot = readEditForm();'), 'the suggestion is part of what the window opened with');
});
check('choosing Unknown is a change (so closing asks first), and cancelling writes nothing at all', () => {
    const e = makeEditor({ a: ITEM() });
    e.open('a');
    e.choose('');
    assert.strictEqual(e.dirty(), true);
    e.cancel();
    assert.strictEqual(e.stored('a'), 'ABSENT', 'cancel: nothing stored');
    e.open('a');
    assert.deepStrictEqual(e.view(), { select: 'striped', note: 'Suggested “Striped” from the name (“striped”). Please check it.' }, 'and the item is exactly as it was');
});
check('cancelling after typing a name writes nothing either', () => {
    const e = makeEditor({ a: ITEM({ name: 'Navy tee' }) });
    e.open('a'); e.typeName('Navy plaid tee'); e.cancel();
    assert.strictEqual(e.stored('a'), 'ABSENT');
    assert.strictEqual(e.item('a').name, 'Navy tee');
});

// ================= the rest of what must keep working =================
check('strength is never inferred or written by any of this', () => {
    const e = makeEditor({ a: ITEM() });
    e.open('a'); e.choose(''); const first = e.save();
    e.open('a'); const second = e.save();
    for (const patch of [first, second]) assert.strictEqual('patternStrength' in patch, false);
    assert.strictEqual('patternStrength' in e.item('a'), false);
    assert.strictEqual(S.describePiece(ITEM({ pattern: null })).strength, 'unknown');
    assert.deepStrictEqual(G.guessPattern('Bold striped tee'), { pattern: 'striped', word: 'striped' });
    assert(!/strength/i.test(read('js/closet.js').slice(read('js/closet.js').indexOf('function initPatternField'), read('js/closet.js').indexOf('function closeEditModal'))));
});
check('patternPatch: the full table, with and without an explicit choice', () => {
    const p = (existing, selected, explicit) => J(S.patternPatch(existing, selected, explicit));
    // never set (absent)
    assert.deepStrictEqual(p({}, '', false), {});
    assert.deepStrictEqual(p({}, '', undefined), {});
    assert.deepStrictEqual(p(undefined, '', false), {});
    assert.deepStrictEqual(p({}, '', true), { pattern: null }, 'an explicit Unknown is recorded');
    assert.deepStrictEqual(p(undefined, '', true), { pattern: null });
    // already decided Unknown: left exactly as it is
    for (const stored of [null, 'unknown', 'mystery']) { assert.deepStrictEqual(p({ pattern: stored }, '', false), {}); assert.deepStrictEqual(p({ pattern: stored }, '', true), {}); }
    // a saved pattern
    assert.deepStrictEqual(p({ pattern: 'striped' }, '', false), { pattern: null });
    assert.deepStrictEqual(p({ pattern: 'striped' }, '', true), { pattern: null });
    // choosing a pattern always saves it
    for (const v of S.SUGGEST_PATTERNS) { assert.deepStrictEqual(p({}, v, false), { pattern: v }); assert.deepStrictEqual(p({ pattern: null }, v, true), { pattern: v }); }
    // not a choice: never saved
    for (const bad of ['unknown', 'checkered', undefined, null, 5]) assert.deepStrictEqual(p({}, bad, false), {});
});
check('soft scoring is untouched: an explicit Unknown (null) scores exactly like a never-set piece, and competing bold patterns still only rank lower', () => {
    const run = (items) => S.suggestOutfits({ items, dateKey: '2026-11-22', weather: null, texts: [], worn: [], weekendPlanned: [] });
    const P = (id, cat, extra = {}) => ({ id, name: id, category: cat, color: '#222222', occasion: 'casual', season: 'all-season', tagged: true, ...extra });
    const never = run([P('t', 'tops'), P('b', 'bottoms')]), decided = run([P('t', 'tops', { pattern: null }), P('b', 'bottoms', { pattern: null })]);
    assert.deepStrictEqual(J(never), J(decided));
    const bold = run([P('t', 'tops', { pattern: 'striped', patternStrength: 'bold', color: '#c62828' }), P('b', 'bottoms', { pattern: 'plaid', patternStrength: 'bold', color: '#1f2a52' })]);
    assert.strictEqual(bold.suggestions.length, 1, 'not blocked');
    assert.strictEqual(bold.suggestions[0].pattern.competing.length, 1);
});
check('the stored value is never "striped" unless the owner saved the suggestion: a never-set item that is only opened and closed stays absent', () => {
    const e = makeEditor({ a: ITEM() });
    for (let i = 0; i < 3; i++) { e.open('a'); e.cancel(); e.reload(); }
    assert.strictEqual(e.stored('a'), 'ABSENT');
});

done();
