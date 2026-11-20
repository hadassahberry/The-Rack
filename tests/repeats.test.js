// js/repeats.js: "you already wore this to that activity" warnings.
const { check, done, assert } = require('./_harness');
const R = require('../js/repeats.js');

const prefs = { repeatWarnings: true, repeatLookBack: 3, repeatCategories: ['tops', 'bottoms'] };
const plans = {
    '2026-11-01': [{ id: 'a', label: 'Class', itemIds: ['t1', 'b1', 's1'] }],
    '2026-11-05': [{ id: 'b', label: 'class', itemIds: ['t1', 'b2'] }],
    '2026-11-08': [{ id: 'c', label: 'Dinner', itemIds: ['t1'] }],
    '2026-11-12': [{ id: 'd', label: 'Class', itemIds: [] }]
};
const labelOf = (k, o) => o.label;
const ctxFor = (over = {}) => R.repeatContext({ dateKey: '2026-11-10', label: 'Class', outfitsByDate: plans, labelOf, prefs, ...over });
const category = (id) => ({ t1: 'tops', b1: 'bottoms', b2: 'bottoms', s1: 'shoes' }[id]);

check('an activity is the same ignoring spaces and capitals', () => {
    assert.strictEqual(R.normalizeActivity('  Class  '), 'class');
    assert.strictEqual(R.normalizeActivity('GIRLS   night'), 'girls night');
    assert.strictEqual(R.normalizeActivity(null), '');
});
check('whole days between dates, either way round', () => {
    assert.strictEqual(R.daysBetween('2026-11-01', '2026-11-08'), 7);
    assert.strictEqual(R.daysBetween('2026-11-08', '2026-11-01'), -7);
    assert.strictEqual(R.daysBetween('2026-03-07', '2026-03-09'), 2, 'across a clock change');
    assert.strictEqual(R.daysBetween('2026-12-31', '2027-01-01'), 1);
});
check('"how long ago" in plain words', () => {
    const past = [1, 2, 5, 13, 14, 30, 59, 60, 100].map(n => R.describeWhen(-n));
    assert.deepStrictEqual(past, ['yesterday', '2 days ago', '5 days ago', '13 days ago', '2 weeks ago', '4 weeks ago', '8 weeks ago', '2 months ago', '3 months ago']);
    assert.deepStrictEqual([1, 3, 14, 21, 90].map(n => R.describeWhen(n)), ['tomorrow', 'in 3 days', 'in 2 weeks', 'in 3 weeks', 'in 3 months']);
});

check('the closest other times that activity was planned, ignoring the same day and empty outfits', () => {
    const c = ctxFor();
    assert.deepStrictEqual(c.occurrences.map(o => [o.dateKey, o.daysAway]), [['2026-11-05', -5], ['2026-11-01', -9]]);
    assert.strictEqual(c.label, 'Class');
    assert.deepStrictEqual([...c.tracked], ['tops', 'bottoms']);
});
check('only the last N times are kept', () => {
    const c = ctxFor({ prefs: { ...prefs, repeatLookBack: 1 } });
    assert.deepStrictEqual(c.occurrences.map(o => o.dateKey), ['2026-11-05']);
    assert.strictEqual(ctxFor({ prefs: { ...prefs, repeatLookBack: -2 } }).occurrences.length, 1, 'never fewer than one');
    assert.strictEqual(ctxFor({ prefs: { ...prefs, repeatLookBack: 0 } }).occurrences.length, 2, 'an unset or zero look-back means the default of 3');
});
check('planning ahead counts too: a later day is a "last time" as well', () => {
    const c = ctxFor({ dateKey: '2026-10-28' });
    assert(c.occurrences.some(o => o.daysAway > 0));
});
check('nothing to warn about when it is off, has no activity, or no category is chosen', () => {
    assert.strictEqual(ctxFor({ prefs: { ...prefs, repeatWarnings: false } }), null);
    assert.strictEqual(ctxFor({ label: '' }), null);
    assert.strictEqual(ctxFor({ label: '   ' }), null);
    assert.strictEqual(ctxFor({ prefs: { ...prefs, repeatCategories: [] } }), null);
});
check('a piece is flagged only in the categories the person chose', () => {
    const c = ctxFor();
    assert.strictEqual(R.itemRepeat(c, 't1', 'tops').dateKey, '2026-11-05');
    assert.strictEqual(R.itemRepeat(c, 's1', 'shoes'), null, 'shoes are not tracked');
    assert.strictEqual(R.itemRepeat(c, 'zz', 'tops'), null, 'never worn to this activity');
    assert.strictEqual(R.itemRepeat(null, 't1', 'tops'), null);
});
check('the same whole outfit is a stronger flag, and needs at least two counted pieces', () => {
    const c = ctxFor();
    assert.strictEqual(R.sameOutfitRepeat(c, ['t1', 'b2', 's1'], category).dateKey, '2026-11-05', 'shoes do not count towards "same"');
    assert.strictEqual(R.sameOutfitRepeat(c, ['t1', 'b1'], category).dateKey, '2026-11-01');
    assert.strictEqual(R.sameOutfitRepeat(c, ['t1', 'b1', 'b2'], category), null, 'a different combination');
    assert.strictEqual(R.sameOutfitRepeat(c, ['t1'], category), null, 'one piece is the soft flag only');
    assert.strictEqual(R.sameOutfitRepeat(null, ['t1', 'b1'], category), null);
});

done();
