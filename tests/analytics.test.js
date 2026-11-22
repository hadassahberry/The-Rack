// js/analytics.js: Wear stats. Planning is not wearing: only outfits marked as worn count.
const { check, done, assert } = require('./_harness');
const { computeWearStats } = require('../js/analytics.js');

const closet = [{ id: 'a', name: 'A', category: 'tops' }, { id: 'b', name: 'B', category: 'bottoms' }, { id: 'c', name: 'C', category: 'tops' }];
const TODAY = '2026-11-11';
const stats = (schedule, items = closet) => computeWearStats(items, schedule, TODAY);
const perItem = (r) => Object.fromEntries(r.perItem.map(p => [p.item.id, [p.worn, p.planned]]));

check('an empty schedule counts nothing', () => {
    const r = stats({});
    assert.deepStrictEqual([r.totalItems, r.totalWears, r.plannedOutfits, r.topCategory, r.unmarkedPast.length], [3, 0, 0, null, 0]);
});
check('a worn outfit counts one wear for each of its pieces', () => {
    const r = stats({ '2026-11-09': [{ id: '1', itemIds: ['a', 'b'], worn: true }] });
    assert.strictEqual(r.totalWears, 2);
    assert.deepStrictEqual(perItem(r), { a: [1, 0], b: [1, 0], c: [0, 0] });
});
check('a plan nobody marked is not a wear: it is listed as "not marked yet"', () => {
    const r = stats({ '2026-11-08': [{ id: '2', itemIds: ['a'], worn: false }] });
    assert.strictEqual(r.totalWears, 0);
    assert.deepStrictEqual(r.unmarkedPast, [{ date: '2026-11-08', outfitId: '2' }]);
});
check('today counts as a day that can be worn; a future day never can', () => {
    const r = stats({ '2026-11-11': [{ id: '3', itemIds: ['a', 'c'], worn: true }], '2026-11-20': [{ id: '5', itemIds: ['b', 'c'], worn: true }] });
    assert.strictEqual(r.totalWears, 2, 'only today\'s outfit');
    assert.strictEqual(r.plannedOutfits, 1, 'the future one is "planned ahead", worn mark or not');
    assert.deepStrictEqual(perItem(r), { a: [1, 0], b: [0, 1], c: [1, 1] });
});
check('"planned ahead" counts only outfits that have at least one piece from the closet', () => {
    const r = stats({
        '2026-11-12': [{ id: '8', itemIds: ['b'] }],
        '2026-11-20': [{ id: '6', itemIds: ['a'] }, { id: '7', itemIds: [], label: 'Activity only' }, { id: '9', itemIds: ['deleted-piece'] }]
    });
    assert.strictEqual(r.plannedOutfits, 2, 'an outfit with only an activity, or only deleted pieces, is not counted');
});
check('pieces no longer in the closet are ignored', () => {
    const r = stats({ '2026-11-11': [{ id: '4', itemIds: ['zz'], worn: true }] });
    assert.strictEqual(r.totalWears, 0);
});
check('the same piece worn twice in one day is one wear for that day; on two days, two', () => {
    const oneDay = stats({ '2026-11-09': [{ id: '1', itemIds: ['a'], worn: true }, { id: '2', itemIds: ['a', 'b'], worn: true }] });
    assert.deepStrictEqual(perItem(oneDay).a, [1, 0]);
    const twoDays = stats({ '2026-11-09': [{ id: '1', itemIds: ['a'], worn: true }], '2026-11-10': [{ id: '2', itemIds: ['a'], worn: true }] });
    assert.deepStrictEqual(perItem(twoDays).a, [2, 0]);
});
check('the top category is the one worn most', () => {
    const r = stats({ '2026-11-09': [{ id: '1', itemIds: ['a', 'b'], worn: true }], '2026-11-10': [{ id: '2', itemIds: ['a', 'c'], worn: true }] });
    assert.strictEqual(r.topCategory, 'tops');
});
check('the total adds up across everything', () => {
    const r = stats({
        '2026-11-09': [{ id: '1', itemIds: ['a', 'b'], worn: true }],
        '2026-11-08': [{ id: '2', itemIds: ['a'], worn: false }],
        '2026-11-11': [{ id: '3', itemIds: ['a', 'c'], worn: true }, { id: '4', itemIds: ['zz'], worn: true }],
        '2026-11-20': [{ id: '5', itemIds: ['b', 'c'], worn: true }, { id: '6', itemIds: ['a'] }, { id: '7', itemIds: [], label: 'X' }],
        '2026-11-12': [{ id: '8', itemIds: ['b'] }]
    });
    assert.deepStrictEqual([r.totalWears, r.plannedOutfits, r.topCategory, r.unmarkedPast.length], [4, 3, 'tops', 1]);
    assert.deepStrictEqual(perItem(r), { a: [2, 1], b: [1, 2], c: [1, 1] });
});

// ---- the "past outfits not marked as worn" reminder ----
check('an outfit with no pieces is never in the reminder (an activity alone is not something you wore)', () => {
    const r = stats({
        '2026-11-05': [{ id: 'e1', itemIds: [], label: 'Dinner' }, { id: 'e2', itemIds: [] }, { id: 'ok', itemIds: ['a'] }],
        '2026-11-06': [{ id: 'e3', itemIds: [], label: 'Class', worn: false }]
    });
    assert.deepStrictEqual(r.unmarkedPast.map(x => x.outfitId), ['ok']);
    assert.strictEqual(r.totalWears, 0);
});
check('nor is an outfit whose pieces have all been deleted; a mix still counts the real ones', () => {
    const r = stats({ '2026-11-05': [{ id: 'gone', itemIds: ['deleted-1', 'deleted-2'] }, { id: 'mixed', itemIds: ['deleted-1', 'a'] }] });
    assert.deepStrictEqual(r.unmarkedPast.map(x => x.outfitId), ['mixed']);
});
check('only empty outfits in the past: no reminder at all', () => {
    assert.strictEqual(stats({ '2026-11-05': [{ id: 'e', itemIds: [], label: 'X' }] }).unmarkedPast.length, 0);
});

done();
