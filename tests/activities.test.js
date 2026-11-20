// js/activities.js: the person's own activity list for the Activity dropdown (nothing is built in).
const { check, done, assert, same } = require('./_harness');
const A = require('../js/activities.js');

const NOW = new Date(2026, 10, 12, 15, 30).getTime();          // Nov 12 2026, afternoon
const labels = (list) => list.map(a => a.label);

check('activities are matched ignoring spaces and capitals only', () => {
    assert.strictEqual(A.activityKey(' Class '), 'class');
    assert.strictEqual(A.activityKey('CLASS'), 'class');
    assert.strictEqual(A.activityKey('Girls   night'), 'girls night');
    assert.notStrictEqual(A.activityKey('Classes'), A.activityKey('Class'));
    assert.strictEqual(A.activityKey(null), '');
});
check('what is saved is tidy and at most 40 characters', () => {
    assert.strictEqual(A.cleanActivity('  Girls    night  '), 'Girls night');
    assert.strictEqual(A.cleanActivity('x'.repeat(60)).length, 40);
    assert.strictEqual(A.cleanActivity(null), '');
});
check('there are no built-in activities: no plans, no list', () => {
    same(A.activityList({}, NOW), []);
    same(A.activityList(null, NOW), []);
    same(A.activityList({ '2026-11-01': [{ id: 'a', label: '', itemIds: [] }, { id: 'b', itemIds: [] }] }, NOW), []);
});
check('the list is exactly what was saved on plans, most recently used first', () => {
    const plans = {
        '2026-11-01': [{ label: 'Class' }], '2026-11-05': [{ label: 'Shul' }], '2026-11-03': [{ label: 'Dinner' }]
    };
    assert.deepStrictEqual(labels(A.activityList(plans, NOW)), ['Shul', 'Dinner', 'Class']);
});
check('the time an activity was saved (labelAt) wins over the plan date', () => {
    const plans = {
        '2026-11-01': [{ label: 'Class', labelAt: new Date(2026, 10, 11, 9).getTime() }],
        '2026-11-08': [{ label: 'Shul' }]
    };
    assert.deepStrictEqual(labels(A.activityList(plans, NOW)), ['Class', 'Shul']);
});
check('planning ahead with an old activity does not pin it to the top', () => {
    const plans = { '2026-11-10': [{ label: 'Recent' }], '2026-12-25': [{ label: 'Far ahead' }] };
    // a plan for a far-off day counts as used no later than the START OF TODAY (it is not pinned to December)
    assert.deepStrictEqual(labels(A.activityList(plans, NOW)), ['Far ahead', 'Recent']);
    const todayStart = new Date(2026, 10, 12).getTime();
    const list = A.activityList(plans, NOW);
    assert.strictEqual(list[0].usedAt, todayStart);
});
check('the same activity with different spacing or capitals is one entry, spelled as last used', () => {
    const plans = { '2026-11-01': [{ label: 'class' }], '2026-11-04': [{ label: ' Class ' }] };
    const list = A.activityList(plans, NOW);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].label, 'Class');
});
check('ties go alphabetically so the order never changes', () => {
    const t = new Date(2026, 10, 2, 10).getTime();
    const plans = { '2026-11-02': [{ label: 'Zumba', labelAt: t }, { label: 'Art', labelAt: t }, { label: 'Math', labelAt: t }] };
    assert.deepStrictEqual(labels(A.activityList(plans, NOW)), ['Art', 'Math', 'Zumba']);
});
check('typing narrows the list: starts-with first, then contains; nothing typed shows everything', () => {
    const list = A.activityList({ '2026-11-01': [{ label: 'Yoga class' }], '2026-11-02': [{ label: 'Class' }], '2026-11-03': [{ label: 'Dinner' }] }, NOW);
    assert.deepStrictEqual(labels(A.filterActivities(list, 'cla')), ['Class', 'Yoga class']);
    assert.deepStrictEqual(labels(A.filterActivities(list, 'din')), ['Dinner']);
    assert.strictEqual(A.filterActivities(list, '').length, 3);
    assert.strictEqual(A.filterActivities(list, '   ').length, 3);
    assert.strictEqual(A.filterActivities(list, 'zzz').length, 0);
});
check('an existing activity is found regardless of spacing and capitals', () => {
    const list = A.activityList({ '2026-11-01': [{ label: 'Class' }] }, NOW);
    assert.strictEqual(A.findActivity(list, ' CLASS ').label, 'Class');
    assert.strictEqual(A.findActivity(list, 'Classes'), null);
    assert.strictEqual(A.findActivity(list, ''), null);
});
check('typed text is saved in the spelling already in use; blank means no activity', () => {
    const list = A.activityList({ '2026-11-01': [{ label: 'Class' }] }, NOW);
    assert.strictEqual(A.resolveActivity(list, 'class'), 'Class');
    assert.strictEqual(A.resolveActivity(list, '  yoga   time '), 'yoga time');
    assert.strictEqual(A.resolveActivity(list, '   '), '');
    assert.strictEqual(A.resolveActivity([], 'Anything'), 'Anything');
});

done();
