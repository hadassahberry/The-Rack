// js/calendar-access.js: keyboard and screen-reader support for the calendar's days.
const { check, done, assert } = require('./_harness');
const C = require('../js/calendar-access.js');

const nm = (o) => C.dayAccessibleName({ date: new Date(2026, 10, 6), isToday: false, isSelected: false, outfits: [], holidayNames: [], ...o });
const target = (key, dateKey, viewMode = 'month', weekStart = 0) => C.calendarKeyTarget({ key, dateKey, viewMode, weekStart });

// ---- the spoken name of a day ----
check('a day always says its full date, with the year', () => {
    assert.strictEqual(nm({}), 'Friday, November 6, 2026.');
    assert(/2027\.$/.test(C.dayAccessibleName({ date: new Date(2027, 2, 14) })));
    assert.strictEqual(C.dayAccessibleName({ date: new Date(2026, 0, 1) }), 'Thursday, January 1, 2026.', 'missing lists are fine');
});
check('today and selected are said', () => {
    assert.strictEqual(nm({ isToday: true, isSelected: true }), 'Friday, November 6, 2026. Today. Selected.');
});
check('planned outfits: how many, and their activities (each said once, at most three)', () => {
    assert.strictEqual(nm({ outfits: [{ label: 'Class', itemIds: ['a'] }] }), 'Friday, November 6, 2026. 1 outfit planned: Class.');
    assert.strictEqual(nm({ outfits: [{ label: '', itemIds: ['a'] }] }), 'Friday, November 6, 2026. 1 outfit planned.');
    assert.strictEqual(nm({ outfits: [{ label: 'Class', itemIds: ['a'] }, { label: 'Dinner', itemIds: ['b'] }] }), 'Friday, November 6, 2026. 2 outfits planned: Class, Dinner.');
    assert.strictEqual(nm({ outfits: [{ label: 'Class', itemIds: ['a'] }, { label: 'Class', itemIds: ['b'] }] }), 'Friday, November 6, 2026. 2 outfits planned: Class.');
    assert.strictEqual(nm({ outfits: ['A', 'B', 'C', 'D', 'E'].map(l => ({ label: l, itemIds: ['x'] })) }), 'Friday, November 6, 2026. 5 outfits planned: A, B, C, and 2 more.');
});
check('an outfit with no pieces yet is still said, and says so', () => {
    assert.strictEqual(nm({ outfits: [{ label: 'Class', itemIds: [] }] }), 'Friday, November 6, 2026. 1 outfit planned, no pieces yet: Class.');
    assert.strictEqual(nm({ outfits: [{ label: '', itemIds: [] }] }), 'Friday, November 6, 2026. 1 outfit planned, no pieces yet.');
    assert.strictEqual(nm({ outfits: [{ label: 'Class', itemIds: [] }, { label: 'Dinner', itemIds: ['a'] }] }), 'Friday, November 6, 2026. 2 outfits planned: Class, Dinner. 1 has no pieces yet.');
    assert.strictEqual(nm({ outfits: [{ label: 'A', itemIds: [] }, { label: 'B', itemIds: [] }] }), 'Friday, November 6, 2026. 2 outfits planned, no pieces yet: A, B.');
});
check('an empty day never says "nothing planned"', () => {
    assert(!/nothing|no outfit/i.test(nm({})));
});
check('holidays are real ones, said briefly', () => {
    assert.strictEqual(nm({ holidayNames: ['Veterans Day'] }), 'Friday, November 6, 2026. Holiday: Veterans Day.');
    assert.strictEqual(nm({ holidayNames: ['A', 'B'] }), 'Friday, November 6, 2026. Holidays: A, B.');
    assert.strictEqual(nm({ holidayNames: ['A', 'B', 'C', 'D', 'E'] }), 'Friday, November 6, 2026. Holidays: A, B, C, and 2 more.');
    assert.strictEqual(nm({ holidayNames: ['A', 'A', ''] }), 'Friday, November 6, 2026. Holiday: A.');
});
check('the Hijri date, when on, is said in full (with the year) after the holidays', () => {
    assert.strictEqual(nm({ hijriDate: '30 Jumada al-ula 1448 AH' }), 'Friday, November 6, 2026. Hijri date: 30 Jumada al-ula 1448 AH.');
    assert.strictEqual(nm({ hijriDate: '' }), 'Friday, November 6, 2026.');
    assert.strictEqual(nm({ hijriDate: '1 Safar 1448 AH', holidayNames: ['Veterans Day'] }), 'Friday, November 6, 2026. Holiday: Veterans Day. Hijri date: 1 Safar 1448 AH.');
});

// ---- keyboard movement ----
check('arrows move by a day or a week', () => {
    assert.strictEqual(target('ArrowLeft', '2026-11-01'), '2026-10-31');
    assert.strictEqual(target('ArrowRight', '2026-12-31'), '2027-01-01');
    assert.strictEqual(target('ArrowUp', '2026-11-12'), '2026-11-05');
    assert.strictEqual(target('ArrowDown', '2026-11-12'), '2026-11-19');
    assert.strictEqual(target('ArrowDown', '2026-02-26'), '2026-03-05');
});
check('Home and End go to the start and end of the week, for either week start', () => {
    assert.strictEqual(target('Home', '2026-11-12', 'month', 0), '2026-11-08');
    assert.strictEqual(target('End', '2026-11-12', 'month', 0), '2026-11-14');
    assert.strictEqual(target('Home', '2026-11-12', 'month', 1), '2026-11-09');
    assert.strictEqual(target('End', '2026-11-15', 'month', 1), '2026-11-15');
    assert.strictEqual(target('Home', '2026-11-08', 'month', 0), '2026-11-08', 'already at the start');
});
check('Page Up / Page Down move by the period on screen', () => {
    assert.strictEqual(target('PageDown', '2026-11-12', 'month'), '2026-12-12');
    assert.strictEqual(target('PageUp', '2026-03-31', 'month'), '2026-02-28', 'a 31st becomes the last day of a shorter month');
    assert.strictEqual(target('PageDown', '2026-01-31', 'month'), '2026-02-28');
    assert.strictEqual(target('PageDown', '2026-11-12', 'week'), '2026-11-19');
    assert.strictEqual(target('PageDown', '2026-11-12', '2weeks'), '2026-11-26');
    assert.strictEqual(C.caShiftPeriod('2026-12-31', 'month', 1), '2027-01-31');
});
check('keys the calendar does not use are left alone', () => {
    assert.strictEqual(target('x', '2026-11-12'), null);
    assert.strictEqual(target('Enter', '2026-11-12'), null);
    assert.strictEqual(target('Tab', '2026-11-12'), null);
});
check('what the view is built around so a day is showing', () => {
    assert.strictEqual(C.anchorToShow('month', '2026-11-20').toDateString(), 'Sun Nov 01 2026');
    assert.strictEqual(C.anchorToShow('week', '2026-11-20').toDateString(), 'Fri Nov 20 2026');
    assert.strictEqual(C.anchorToShow('2weeks', '2026-11-20').toDateString(), 'Fri Nov 20 2026');
});

// ---- the little markers on a phone's month cells ----
check('markers: fixed order, each a different shape', () => {
    assert.deepStrictEqual(C.dayMarkers({}), []);
    assert.deepStrictEqual(C.dayMarkers({ hasWeather: true, weatherIcon: '☀️' }), [{ kind: 'weather', glyph: '☀️' }]);
    assert.deepStrictEqual(C.dayMarkers({ hasWeather: true, weatherIcon: '' }), [], 'never an empty marker');
    assert.deepStrictEqual(C.dayMarkers({ hasHoliday: true }), [{ kind: 'holiday', glyph: '★' }]);
    assert.deepStrictEqual(C.dayMarkers({ hasCandles: true }), [{ kind: 'candle', glyph: '🕯' }]);
    assert.deepStrictEqual(C.dayMarkers({ hasEmptyOutfit: true }), [{ kind: 'plan', glyph: '◇' }]);
    const all = C.dayMarkers({ hasWeather: true, weatherIcon: '⛈️', hasHoliday: true, hasCandles: true, hasEmptyOutfit: true });
    assert.deepStrictEqual(all.map(m => m.kind), ['weather', 'holiday', 'candle', 'plan']);
    assert.strictEqual(new Set(all.map(m => m.glyph)).size, 4);
});
check('the key under the calendar explains only what is showing', () => {
    assert.strictEqual(C.markerKeyText(new Set()), '');
    assert.strictEqual(C.markerKeyText(new Set(['holiday'])), '★ holiday. Tap a day for details.');
    assert.strictEqual(C.markerKeyText(new Set(['candle', 'weather', 'holiday'])), 'weather icon = forecast · ★ holiday · 🕯 candle lighting. Tap a day for details.');
    assert.strictEqual(C.markerKeyText(['weather']), 'weather icon = forecast. Tap a day for details.');
    assert.strictEqual(C.markerKeyText(new Set(['plan'])), '◇ outfit planned, no pieces yet. Tap a day for details.');
});

// ---- a saved outfit's thumbnails are described in words ----
check('"Pieces: ..." for a saved outfit, shortened when long', () => {
    assert.strictEqual(C.outfitPiecesSummary(['Blue top', 'Black skirt']), 'Pieces: Blue top, Black skirt');
    assert.strictEqual(C.outfitPiecesSummary([]), '');
    assert.strictEqual(C.outfitPiecesSummary([' ', null]), '');
    assert.strictEqual(C.outfitPiecesSummary(['1', '2', '3', '4', '5', '6', '7', '8']), 'Pieces: 1, 2, 3, 4, 5, 6, and 2 more');
});

done();
