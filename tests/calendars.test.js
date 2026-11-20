// js/calendars.js: Christian holidays, the Hijri calendar and public holidays, checked against dates published
// by the calendars themselves.
const { check, done, assert, same } = require('./_harness');
const C = require('../js/calendars.js');

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

check('Western Easter matches the published dates', () => {
    const want = { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2029: '2029-04-01', 2038: '2038-04-25' };
    for (const [y, d] of Object.entries(want)) assert.strictEqual(ymd(C.easterWestern(Number(y))), d, y);
});
check('Orthodox Easter matches the published dates', () => {
    const want = { 2024: '2024-05-05', 2025: '2025-04-20', 2026: '2026-04-12', 2027: '2027-05-02', 2029: '2029-04-08' };
    for (const [y, d] of Object.entries(want)) assert.strictEqual(ymd(C.easterOrthodox(Number(y))), d, y);
});
check('the First Sunday of Advent is the Sunday four weeks before Christmas', () => {
    const want = { 2025: '2025-11-30', 2026: '2026-11-29', 2027: '2027-11-28' };
    for (const [y, d] of Object.entries(want)) {
        const advent = C.adventStart(Number(y));
        assert.strictEqual(ymd(advent), d, y);
        assert.strictEqual(advent.getDay(), 0, 'a Sunday');
    }
    assert.strictEqual(C.adventStart(2022).getDay(), 0);                  // Christmas on a Sunday
});
check('Western holidays for 2026', () => {
    const m = C.christianHolidaysForYear(2026, 'western');
    assert.deepStrictEqual(m['2026-01-06'], ['Epiphany']);
    assert.deepStrictEqual(m['2026-02-18'], ['Ash Wednesday']);
    assert.deepStrictEqual(m['2026-03-29'], ['Palm Sunday']);
    assert.deepStrictEqual(m['2026-04-02'], ['Maundy Thursday']);
    assert.deepStrictEqual(m['2026-04-03'], ['Good Friday']);
    assert.deepStrictEqual(m['2026-04-05'], ['Easter Sunday']);
    assert.deepStrictEqual(m['2026-05-14'], ['Ascension Day']);
    assert.deepStrictEqual(m['2026-05-24'], ['Pentecost']);
    assert.deepStrictEqual(m['2026-11-29'], ['First Sunday of Advent']);
    assert.deepStrictEqual(m['2026-12-25'], ['Christmas Day']);
});
check('Orthodox holidays follow the Orthodox Easter and the Julian Christmas', () => {
    const m = C.christianHolidaysForYear(2026, 'orthodox');
    assert.deepStrictEqual(m['2026-04-12'], ['Easter (Pascha)']);
    assert.deepStrictEqual(m['2026-04-10'], ['Good Friday']);
    assert.deepStrictEqual(m['2026-01-07'], ['Christmas (Julian calendar)']);
    assert.deepStrictEqual(m['2026-04-05'], ['Palm Sunday'], 'the Western Easter date is only Palm Sunday here');
    assert.strictEqual(m['2026-02-18'], undefined, 'no Ash Wednesday');
    assert(m['2026-02-23'] && /Clean Monday/.test(m['2026-02-23'][0]));
});

check('the Hijri date comes from the browser\'s own calendar', () => {
    assert.strictEqual(C.hijriSupported(), true);
    const eid = C.hijriFor(new Date(2026, 4, 27));
    assert.deepStrictEqual([eid.day, eid.month, eid.year, eid.monthName, eid.holiday], [10, 12, 1447, 'Dhu al-Hijjah', 'Eid al-Adha']);
    const newYear = C.hijriFor(new Date(2026, 5, 16));
    assert.deepStrictEqual([newYear.day, newYear.month, newYear.year, newYear.holiday], [1, 1, 1448, 'Islamic New Year']);
    const ramadan = C.hijriFor(new Date(2026, 1, 18));
    assert.deepStrictEqual([ramadan.day, ramadan.monthName, ramadan.holiday], [1, 'Ramadan', 'Ramadan begins']);
});
check('a Hijri month is 29 or 30 days and days follow one another', () => {
    let prev = C.hijriFor(new Date(2026, 0, 1));
    let runs = 0;
    for (let i = 1; i < 400; i++) {
        const h = C.hijriFor(new Date(2026, 0, 1 + i));
        if (h.day === 1) { assert([29, 30].includes(prev.day), `month ended on day ${prev.day}`); runs++; }
        else assert.strictEqual(h.day, prev.day + 1);
        prev = h;
    }
    assert(runs >= 12);
});
check('a Hijri date is written by one rule: full, compact, short', () => {
    const mid = { day: 30, month: 5, year: 1448, monthName: 'Jumada al-ula' }, first = { day: 1, month: 6, year: 1448, monthName: 'Jumada al-thani' };
    assert.strictEqual(C.formatHijri(first, 'full'), '1 Jumada al-thani 1448 AH');
    assert.strictEqual(C.formatHijri(mid), '30 Jumada al-ula 1448 AH');
    assert.deepStrictEqual([C.formatHijri(mid, 'compact'), C.formatHijri(first, 'compact')], ['30 Jumada al-ula', '1 Jumada al-thani']);
    assert.deepStrictEqual([C.formatHijri(mid, 'short'), C.formatHijri(first, 'short')], ['30', '1 Jum II']);
    assert.deepStrictEqual([C.formatHijri(null), C.formatHijri(null, 'short')], ['', '']);
    assert.strictEqual(new Set(C.HIJRI_MONTHS_SHORT).size, 12, 'every short month name is different');
    assert(C.HIJRI_MONTHS_SHORT.every(n => n.length <= 6));
});

check('public holidays: only whole-country, public ones; bad rows are skipped', () => {
    const map = C.parsePublicHolidays([
        { date: '2026-01-01', name: 'New Year', global: true, types: ['Public'] },
        { date: '2026-02-02', name: 'Regional day', global: false, types: ['Public'] },
        { date: '2026-03-03', name: 'Observance', global: true, types: ['Observance'] },
        { date: '2026-01-01', name: 'Second name' },
        null, { name: 'no date' }, { date: '2026-05-05' }
    ]);
    assert.deepStrictEqual(map, { '2026-01-01': ['New Year', 'Second name'] });
    assert.deepStrictEqual(C.parsePublicHolidays(undefined), {});
    assert.deepStrictEqual(C.parsePublicHolidays('nope'), {});
});
check('the country comes from the saved location', () => {
    assert.strictEqual(C.publicHolidayCountry({ country: 'IL' }), 'IL');
    assert.strictEqual(C.publicHolidayCountry({ country: 'US' }), 'US');
});

check('what the extra calendars say about one day', () => {
    const on = { publicHolidays: false, christianHolidays: true, hijriCalendar: false, christianStyle: 'western' };
    assert.deepStrictEqual(C.extraCalendarNotes(new Date(2026, 11, 25), on, null).notes, [{ text: 'Christmas Day', kind: 'christian' }]);
    assert.deepStrictEqual(C.extraCalendarNotes(new Date(2026, 3, 3), on, null).notes, [{ text: 'Good Friday', kind: 'christian' }]);
    const off = C.extraCalendarNotes(new Date(2026, 3, 3), { publicHolidays: false, christianHolidays: false, hijriCalendar: false }, { country: 'US' });
    assert.deepStrictEqual([off.notes, off.hijri], [[], null], 'everything off = nothing at all');
    const hijri = C.extraCalendarNotes(new Date(2026, 4, 27), { publicHolidays: false, christianHolidays: false, hijriCalendar: true }, null);
    assert.deepStrictEqual([hijri.notes.map(x => x.kind + ':' + x.text), hijri.hijri.day], [['islamic:Eid al-Adha'], 10]);
    const orthodox = C.extraCalendarNotes(new Date(2026, 3, 12), { christianHolidays: true, christianStyle: 'orthodox' }, null);
    assert.deepStrictEqual(orthodox.notes.map(n => n.text), ['Easter (Pascha)']);
});

done();
