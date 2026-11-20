// js/apply-outfit.js: what applying a SAVED outfit to a day does (nothing is overwritten silently), its wording,
// and when the "Added..." notice and its Undo go out of date.
const { check, done, assert, same } = require('./_harness');
const P = require('../js/apply-outfit.js');

const saved = ['t1', 'b1'];
const out = (id, itemIds, extra = {}) => ({ id, label: '', itemIds, ...extra });

check('same pieces in any order are the same set; duplicates do not matter', () => {
    assert(P.sameItemSet(['a', 'b'], ['b', 'a']));
    assert(P.sameItemSet(['a', 'a', 'b'], ['b', 'a']));
    assert(!P.sameItemSet(['a'], ['a', 'b']));
    assert(!P.sameItemSet([], ['a']));
    assert(P.sameItemSet([], []));
});
check('an empty day: the saved outfit is created', () => {
    same(P.planApplySavedOutfit({ dayOutfits: [], activeId: null, savedItemIds: saved }), { action: 'create' });
    same(P.planApplySavedOutfit({ dayOutfits: undefined, activeId: null, savedItemIds: saved }), { action: 'create' });
});
check('the highlighted outfit has no pieces: they are filled in (its activity stays)', () => {
    const r = P.planApplySavedOutfit({ dayOutfits: [out('a', [], { label: 'Class' })], activeId: 'a', savedItemIds: saved });
    assert.strictEqual(r.action, 'fill');
    assert.strictEqual(r.outfitId, 'a');
});
check('the highlighted outfit has other pieces: they are replaced, and the old ones are remembered for Undo', () => {
    const r = P.planApplySavedOutfit({ dayOutfits: [out('a', ['x', 'y'])], activeId: 'a', savedItemIds: saved });
    assert.strictEqual(r.action, 'replace');
    assert.strictEqual(r.outfitId, 'a');
    same(r.previousItemIds, ['x', 'y']);
});
check('an outfit marked as worn is never touched: the saved one is added as another outfit', () => {
    const r = P.planApplySavedOutfit({ dayOutfits: [out('a', ['x'], { worn: true })], activeId: 'a', savedItemIds: saved });
    assert.strictEqual(r.action, 'add');
});
check('already planned (in the highlighted outfit or any other): nothing changes, no duplicate', () => {
    const active = P.planApplySavedOutfit({ dayOutfits: [out('a', ['b1', 't1'])], activeId: 'a', savedItemIds: saved });
    assert.strictEqual(active.action, 'already');
    assert.strictEqual(active.isActive, true);
    const other = P.planApplySavedOutfit({ dayOutfits: [out('a', ['x']), out('b', ['t1', 'b1'])], activeId: 'a', savedItemIds: saved });
    assert.strictEqual(other.action, 'already');
    assert.strictEqual(other.outfitId, 'b');
    assert.strictEqual(other.isActive, false);
});
check('no outfit is highlighted but the day has some: a new outfit is created', () => {
    const r = P.planApplySavedOutfit({ dayOutfits: [out('a', ['x'])], activeId: null, savedItemIds: saved });
    assert.strictEqual(r.action, 'create');
});

check('the sentences say exactly what happened', () => {
    const d = (plan, outfit) => P.describeApply(plan, 'Casual Friday', outfit);
    assert.strictEqual(d({ action: 'already', isActive: true }, { label: '' }), '“Casual Friday” is already planned here. Nothing changed.');
    assert.strictEqual(d({ action: 'already', isActive: false }, { label: 'Class' }), '“Casual Friday” is already planned here, in your “Class” outfit. Nothing changed.');
    assert.strictEqual(d({ action: 'already', isActive: false }, { label: '' }), '“Casual Friday” is already planned here, in another outfit on this day. Nothing changed.');
    assert.strictEqual(d({ action: 'create' }, null), 'Added “Casual Friday” to this day.');
    assert.strictEqual(d({ action: 'fill' }, { label: 'Class' }), 'Added “Casual Friday” to your “Class” outfit.');
    assert.strictEqual(d({ action: 'fill' }, { label: '' }), 'Added “Casual Friday” to your outfit.');
    assert.strictEqual(d({ action: 'replace' }, { label: 'Class' }), 'Replaced the pieces in your “Class” outfit with “Casual Friday”. Kept the “Class” activity.');
    assert.strictEqual(d({ action: 'replace' }, { label: '' }), 'Replaced the pieces in this outfit with “Casual Friday”.');
    assert.strictEqual(d({ action: 'add' }, { label: 'Class' }), 'Your “Class” outfit is marked as worn, so it was left unchanged. “Casual Friday” was added as another outfit.');
    assert.strictEqual(d({ action: 'nonsense' }, null), '');
});
check('the kept activity is whatever the person typed, not a fixed word', () => {
    assert.strictEqual(P.describeApply({ action: 'replace' }, 'Casual Friday', { label: 'Dinner with Sam' }),
        'Replaced the pieces in your “Dinner with Sam” outfit with “Casual Friday”. Kept the “Dinner with Sam” activity.');
});

check('a day\'s fingerprint changes with any change to the day', () => {
    const day = [out('a', ['x', 'y'], { label: 'Class' })];
    const sig = P.outfitsSignature(day);
    assert.strictEqual(sig, P.outfitsSignature(JSON.parse(JSON.stringify(day))));
    assert.notStrictEqual(sig, P.outfitsSignature([out('a', ['x', 'y'], { label: 'Dinner' })]), 'activity');
    assert.notStrictEqual(sig, P.outfitsSignature([out('a', ['y', 'x'], { label: 'Class' })]), 'piece order');
    assert.notStrictEqual(sig, P.outfitsSignature([out('a', ['x'], { label: 'Class' })]), 'a piece removed');
    assert.notStrictEqual(sig, P.outfitsSignature([...day, out('b', [])]), 'an outfit added');
    assert.notStrictEqual(sig, P.outfitsSignature([out('a', ['x', 'y'], { label: 'Class', worn: true })]), 'worn mark');
    assert.notStrictEqual(sig, P.outfitsSignature([out('a', ['x', 'y'], { label: 'Class', flagsOff: true })]), 'repeat-warning switch');
    assert.strictEqual(P.outfitsSignature(undefined), P.outfitsSignature([]));
});
check('the "Added..." notice (and its Undo) go away as soon as the day is different', () => {
    const day = [out('a', ['x'], { label: 'Class' })];
    const notice = { signature: P.outfitsSignature(day) };
    assert.strictEqual(P.applyNoticeIsCurrent(notice, day), true);
    assert.strictEqual(P.applyNoticeIsCurrent(notice, []), false, 'the outfit was removed');
    assert.strictEqual(P.applyNoticeIsCurrent(notice, [out('a', ['x', 'z'], { label: 'Class' })]), false, 'a piece was added');
    assert.strictEqual(P.applyNoticeIsCurrent(null, day), false);
    assert.strictEqual(P.applyNoticeIsCurrent(undefined, day), false);
});

done();
