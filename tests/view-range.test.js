// js/view-range.js: switching between Week / 2 weeks / Month, the "where am I" line, and the Previous / Next arrows.
const { check, done, assert, same } = require('./_harness');
const V = require('../js/view-range.js');

const D = (s) => V.vrParse(s);
const k = (d) => V.vrKey(d);
const range = (startKey, n) => { const s = D(startKey); return Array.from({ length: n }, (_, i) => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i)); };
const today = D('2026-11-11');
const say = (mode, start, n) => V.describeViewRange(mode, range(start, n), today);

check('keys and parsing round-trip', () => {
    assert.strictEqual(k(D('2026-02-03')), '2026-02-03');
    assert.strictEqual(k(new Date(2026, 0, 5)), '2026-01-05');
});

// ---- switching views keeps what you are looking at ----
const pick = (o) => k(V.pickSwitchAnchor({ fromMode: 'month', toMode: 'week', todayKey: '2026-11-11', selectedKey: null, anchorDate: D('2026-11-01'), dates: range('2026-11-01', 30), ...o }));
check('a selected day you can see is kept', () => {
    assert.strictEqual(pick({ selectedKey: '2026-11-20' }), '2026-11-20');
});
check('otherwise today, if you can see it', () => {
    assert.strictEqual(pick({ selectedKey: '2026-12-25' }), '2026-11-11');
});
check('otherwise what you are looking at', () => {
    const far = range('2027-03-01', 28);
    assert.strictEqual(pick({ dates: far, anchorDate: D('2027-03-01'), selectedKey: null, todayKey: '2026-11-11', fromMode: 'month' }), '2027-03-01');
    assert.strictEqual(k(V.pickSwitchAnchor({ fromMode: 'week', toMode: 'month', dates: range('2027-03-07', 7), anchorDate: D('2027-03-07'), selectedKey: null, todayKey: '2026-11-11' })), '2027-03-10');
    assert.strictEqual(k(V.pickSwitchAnchor({ fromMode: 'week', toMode: '2weeks', dates: range('2027-03-07', 7), anchorDate: D('2027-03-07'), selectedKey: null, todayKey: '2026-11-11' })), '2027-03-07');
});

// ---- the words under the title ----
check('week view', () => {
    assert.strictEqual(say('week', '2026-11-08', 7), 'This week');
    assert.strictEqual(say('week', '2026-11-15', 7), 'Next week');
    assert.strictEqual(say('week', '2026-11-22', 7), 'In 2 weeks');
    assert.strictEqual(say('week', '2026-11-01', 7), 'Last week');
    assert.strictEqual(say('week', '2026-10-18', 7), '3 weeks ago');
});
check('2-week view', () => {
    assert.strictEqual(say('2weeks', '2026-11-08', 14), 'Includes today');
    assert.strictEqual(say('2weeks', '2026-11-15', 14), 'Starts next week');
    assert.strictEqual(say('2weeks', '2026-11-29', 14), 'Starts in 3 weeks');
    assert.strictEqual(say('2weeks', '2026-10-25', 14), 'Ended last week');
    assert.strictEqual(say('2weeks', '2026-10-08', 14), 'Ended 3 weeks ago');
});
check('month view (the month its middle cell belongs to)', () => {
    assert.strictEqual(say('month', '2026-11-01', 35), 'This month');
    assert.strictEqual(say('month', '2026-11-29', 35), 'Next month');
    assert.strictEqual(say('month', '2026-09-27', 35), 'Last month');
    assert.strictEqual(say('month', '2026-12-28', 35), '2 months from now');
    assert.strictEqual(say('month', '2026-06-28', 35), '4 months ago');
    assert.strictEqual(V.describeViewRange('month', range('2026-12-27', 42), today), '2 months from now');
});

// ---- the arrows ----
check('single week and month are as they always were', () => {
    assert.deepStrictEqual([k(V.stepAnchor('week', D('2026-11-11'), 1)), k(V.stepAnchor('week', D('2026-11-11'), -1))], ['2026-11-18', '2026-11-04']);
    assert.deepStrictEqual([k(V.stepAnchor('month', D('2026-11-11'), 1)), k(V.stepAnchor('month', D('2026-11-11'), -1))], ['2026-12-01', '2026-10-01']);
    assert.deepStrictEqual([k(V.stepAnchor('month', D('2026-12-15'), 1)), k(V.stepAnchor('month', D('2027-01-15'), -1))], ['2027-01-01', '2026-12-01']);
});

// the same range rule the calendar uses (js/calendar.js visibleDates): from the first day of the anchor's week
const rangeOf = (mode, anchor, weekStart) => {
    const count = mode === 'week' ? 7 : 14, into = (anchor.getDay() - weekStart + 7) % 7;
    return Array.from({ length: count }, (_, i) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - into + i));
};
const keys = (arr) => arr.map(k);
const daysBetween = (x, y) => Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86400000);

check('2 weeks moves by ONE week, keeping one week on screen (both week starts, many start dates)', () => {
    for (const [ws, name] of [[0, 'Sunday'], [1, 'Monday']]) {
        for (const startKey of ['2026-11-04', '2026-11-08', '2026-11-09', '2026-12-30', '2026-01-02', '2024-02-28', '2026-03-08', '2026-11-01']) {
            const a = D(startKey);
            const now = rangeOf('2weeks', a, ws);
            const next = rangeOf('2weeks', V.stepAnchor('2weeks', a, 1), ws);
            const prev = rangeOf('2weeks', V.stepAnchor('2weeks', a, -1), ws);
            const label = `${name} ${startKey}`;
            assert.deepStrictEqual(keys(next.slice(0, 7)), keys(now.slice(7)), label + ': Next shows B + C');
            assert.deepStrictEqual(keys(prev.slice(7)), keys(now.slice(0, 7)), label + ': Previous shows (week before A) + A');
            assert.strictEqual([next.length, prev.length, next[0].getDay() === ws, prev[0].getDay() === ws, daysBetween(now[0], next[0]), daysBetween(prev[0], now[0])].join(), '14,14,true,true,7,7', label);
            const back = V.stepAnchor('2weeks', V.stepAnchor('2weeks', a, 1), -1);
            assert.deepStrictEqual(keys(rangeOf('2weeks', back, ws)), keys(now), label + ': Next then Previous returns');
            const fwd = V.stepAnchor('2weeks', V.stepAnchor('2weeks', V.stepAnchor('2weeks', a, 1), 1), 1);
            assert.strictEqual(daysBetween(now[0], rangeOf('2weeks', fwd, ws)[0]), 21, label + ': three clicks = three weeks');
        }
    }
});
check('month, year, leap-day and clock-change boundaries', () => {
    assert.strictEqual(k(V.stepAnchor('2weeks', D('2026-12-28'), 1)), '2027-01-04');
    assert.strictEqual(k(V.stepAnchor('2weeks', D('2027-01-02'), -1)), '2026-12-26');
    assert.strictEqual(k(V.stepAnchor('2weeks', D('2026-02-26'), 1)), '2026-03-05');
    assert.strictEqual(k(V.stepAnchor('2weeks', D('2026-10-28'), 1)), '2026-11-04');
    assert.strictEqual(k(V.stepAnchor('2weeks', D('2026-03-04'), 1)), '2026-03-11');
    assert.strictEqual(k(V.stepAnchor('2weeks', D('2028-02-24'), 1)), '2028-03-02');
});
check('the page really uses it (and the arrows say "week" for the 2-week view)', () => {
    const { read } = require('./_harness');
    const cal = read('js/calendar.js');
    assert(/stepAnchor\(viewMode, anchorDate, direction\)/.test(cal), 'stepView must use stepAnchor');
    assert(/const unit = viewMode === 'month' \? 'month' : 'week'/.test(cal));
});

done();
