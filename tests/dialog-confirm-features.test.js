// js/dialog.js (Tab trapping), js/confirm.js (what deleting a piece touches, and the words for it) and
// js/features.js (switches for features that need setup first).
const { check, done, assert, loadScript } = require('./_harness');
const { trapTarget } = require('../js/dialog.js');
const Confirm = require('../js/confirm.js');
const { RACK_FEATURES, featureEnabled } = require('../js/features.js');

// ---- keyboard focus inside a window ----
check('Tab on the last control goes to the first; Shift+Tab on the first goes to the last', () => {
    assert.strictEqual(trapTarget({ count: 3, index: 2, shift: false }), 0);
    assert.strictEqual(trapTarget({ count: 3, index: 0, shift: true }), 2);
    assert.strictEqual(trapTarget({ count: 1, index: 0, shift: false }), 0);
    assert.strictEqual(trapTarget({ count: 1, index: 0, shift: true }), 0);
});
check('in the middle the browser does what it normally does', () => {
    assert.strictEqual(trapTarget({ count: 3, index: 1, shift: false }), null);
    assert.strictEqual(trapTarget({ count: 3, index: 1, shift: true }), null);
    assert.strictEqual(trapTarget({ count: 3, index: 0, shift: false }), null);
    assert.strictEqual(trapTarget({ count: 3, index: 2, shift: true }), null);
});
check('focus that strayed outside comes back in; a window with nothing focusable keeps focus itself', () => {
    assert.strictEqual(trapTarget({ count: 3, index: -1, shift: false }), 0);
    assert.strictEqual(trapTarget({ count: 3, index: -1, shift: true }), 2);
    assert.strictEqual(trapTarget({ count: 0, index: -1, shift: false }), 'container');
    assert.strictEqual(trapTarget({ count: 0, index: -1, shift: true }), 'container');
});
check('the window code is wired the way its comments promise (the page behind is made inert, focus returns)', () => {
    const { read } = require('./_harness');
    const src = read('js/dialog.js');
    assert(/inert/.test(src), 'the page behind must be inert');
    assert(/returnTo/.test(src) && /trigger/.test(src), 'focus returns to the trigger or a fallback');
    assert(/e !== document\.body/.test(src), 'body is never a place to return focus to');
    assert(/keydown/.test(src) && /'Tab'/.test(src));
});

// ---- deleting a piece ----
check('plural words', () => {
    assert.strictEqual(Confirm.pluralize(1, 'day'), '1 day');
    assert.strictEqual(Confirm.pluralize(0, 'day'), '0 days');
    assert.strictEqual(Confirm.pluralize(3, 'saved outfit'), '3 saved outfits');
});
const schedule = {
    '2026-11-01': [{ id: 'a', label: '', itemIds: ['x'] }, { id: 'b', label: 'Class', itemIds: ['x', 'y'], worn: true }],
    '2026-11-02': [{ id: 'c', label: 'Dinner', itemIds: ['x'] }],
    '2026-11-03': [{ id: 'd', label: '', itemIds: ['y'] }]
};
const saved = [{ id: 's1', name: 'Only x', itemIds: ['x'] }, { id: 's2', name: 'x and y', itemIds: ['x', 'y'] }, { id: 's3', name: 'Just y', itemIds: ['y'] }];
check('what deleting a piece touches', () => {
    const impact = Confirm.itemDeletionImpact('x', schedule, saved);
    assert.deepStrictEqual([impact.days, impact.plannedOutfits, impact.plannedOutfitsRemoved, impact.wornDays], [2, 3, 1, 1]);
    assert.deepStrictEqual(impact.saved, [{ id: 's1', name: 'Only x', willBeDeleted: true }, { id: 's2', name: 'x and y', willBeDeleted: false }]);
});
check('a piece that is nowhere touches nothing', () => {
    const impact = Confirm.itemDeletionImpact('nope', schedule, saved);
    assert.deepStrictEqual([impact.days, impact.plannedOutfits, impact.plannedOutfitsRemoved, impact.wornDays, impact.saved.length], [0, 0, 0, 0, 0]);
    const empty = Confirm.itemDeletionImpact('x', undefined, undefined);
    assert.strictEqual(empty.days, 0);
});
check('the confirmation says exactly what will happen', () => {
    const impact = Confirm.itemDeletionImpact('x', schedule, saved);
    const text = Confirm.describeItemDeletion('Blue top', impact);
    assert.strictEqual(text.message, '“Blue top” will be removed from your closet.');
    assert(text.details.includes('It will be taken out of 2 planned days (3 planned outfits).'));
    assert(text.details.some(d => /1 planned outfit had only this piece and no activity, so it will be removed from the calendar\./.test(d)));
    assert(text.details.includes('It will also leave your wear history (1 day marked as worn).'));
    assert(text.details.some(d => /taken out of 1 saved outfit: “x and y”/.test(d)));
    assert(text.details.some(d => /This saved outfit has only this piece, so it will be deleted too: “Only x”/.test(d)));
    const none = Confirm.describeItemDeletion('Hat', Confirm.itemDeletionImpact('nope', schedule, saved));
    assert.deepStrictEqual(none.details, ['It isn’t planned on any day.', 'It isn’t in any saved outfit.']);
});
check('the confirmation window answers "no" by default (Cancel has focus, Esc and a click outside say no)', () => {
    const { read } = require('./_harness');
    const src = read('js/confirm.js');
    assert(/initialFocus: o\.cancelLabel \? cancel : ok/.test(src), 'Cancel has the focus first');
    assert(/e\.key === 'Escape'[\s\S]*finishConfirm\(false\)/.test(src));
    assert(/finishConfirm\(false\)/.test(src.split('pressedOnBackdrop && e.target === modal')[1] || ''), 'backdrop click means no');
});

// ---- feature switches ----
check('"Add from a link" is off until its server function is set up and approved', () => {
    assert.strictEqual(RACK_FEATURES.linkImport, false);
    assert.strictEqual(featureEnabled('linkImport'), false);
    assert.strictEqual(featureEnabled('somethingElse'), false);
});
check('the testing switch only shows the feature in this browser, and storage trouble never breaks the page', () => {
    const on = loadScript('js/features.js', { localStorage: { getItem: (k) => (k === 'rack_feature_linkImport' ? '1' : null) } }, ['featureEnabled']);
    assert.strictEqual(on.featureEnabled('linkImport'), true);
    assert.strictEqual(on.featureEnabled('other'), false);
    const broken = loadScript('js/features.js', { localStorage: { getItem() { throw new Error('blocked'); } } }, ['featureEnabled']);
    assert.strictEqual(broken.featureEnabled('linkImport'), false);
    const off = loadScript('js/features.js', { localStorage: { getItem: () => '0' } }, ['featureEnabled']);
    assert.strictEqual(off.featureEnabled('linkImport'), false);
});

done();
