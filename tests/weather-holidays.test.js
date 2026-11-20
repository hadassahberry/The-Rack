// js/weather.js (temperature units and weather words) and js/holidays.js (Hebcal titles, candle-lighting times and the
// Israel / outside-Israel schedules), run in a sandbox with no page, no storage and no network.
const { check, done, assert, loadScript } = require('./_harness');

function weather({ tempUnit = 'auto', location = null, language = 'en-US' } = {}) {
    const s = loadScript('js/weather.js', {
        Store: { getPrefs: () => ({ tempUnit }), getCache: () => null, saveCache() {}, saveLocation() {} },
        Location: { get: () => location },
        navigator: { language }, Intl, document: { dispatchEvent() {} }, Event: function () {}
    }, ['weatherInfo', 'usesFahrenheit', 'currentTempUnit', 'formatTemp', 'countryOfLocation', 'FAHRENHEIT_COUNTRIES', 'Weather']);
    return s;
}

check('every forecast code has an icon and plain words; an unknown one is honest about it', () => {
    const w = weather();
    assert.strictEqual(w.weatherInfo(0).label, 'clear and sunny');
    assert.strictEqual(w.weatherInfo(63).label, 'rainy');
    assert.strictEqual(w.weatherInfo(73).label, 'snowy');
    assert.strictEqual(w.weatherInfo(95).label, 'stormy');
    assert.strictEqual(w.weatherInfo(12345).label, 'unknown conditions');
    assert.strictEqual(w.weatherInfo(undefined).label, 'unknown conditions');
    [0, 1, 2, 3, 45, 51, 61, 65, 71, 80, 82, 95].forEach(code => assert(w.weatherInfo(code).icon.length > 0, 'icon for ' + code));
});
check('Fahrenheit only in the countries that use it; the location decides, then the device language', () => {
    const w = weather();
    assert.strictEqual(w.usesFahrenheit({ country: 'US' }), true);
    assert.strictEqual(w.usesFahrenheit({ country: 'us' }), true);
    assert.strictEqual(w.usesFahrenheit({ country: 'BS' }), true);
    assert.strictEqual(w.usesFahrenheit({ country: 'GB' }), false);
    assert.strictEqual(w.usesFahrenheit({ country: 'IL' }), false);
    assert.strictEqual(w.usesFahrenheit({ country: 'CA' }), false);
    assert.strictEqual(weather({ language: 'en-GB' }).usesFahrenheit(null), false, 'no location: the device language');
    assert.strictEqual(weather({ language: 'en-US' }).usesFahrenheit(null), true);
    assert.strictEqual(weather({ language: 'xx' }).usesFahrenheit(null), true, 'nothing to go on: Fahrenheit');
});
check('the Settings choice overrides "automatic"', () => {
    assert.strictEqual(weather({ tempUnit: 'C', location: { country: 'US' } }).currentTempUnit(), 'C');
    assert.strictEqual(weather({ tempUnit: 'F', location: { country: 'GB' } }).currentTempUnit(), 'F');
    assert.strictEqual(weather({ tempUnit: 'auto', location: { country: 'GB' } }).currentTempUnit(), 'C');
    assert.strictEqual(weather({ tempUnit: 'auto', location: { country: 'US' } }).currentTempUnit(), 'F');
});
check('forecasts are stored in Fahrenheit and converted for showing', () => {
    const f = weather({ tempUnit: 'F' }), c = weather({ tempUnit: 'C' });
    assert.strictEqual(f.formatTemp(68), '68°');
    assert.strictEqual(f.formatTemp(68, true), '68°F');
    assert.strictEqual(c.formatTemp(68), '20°');
    assert.strictEqual(c.formatTemp(32, true), '0°C');
    assert.strictEqual(c.formatTemp(212), '100°');
    assert.strictEqual(c.formatTemp(-4), '-20°');
    assert.strictEqual(f.formatTemp(67.6), '68°');
});

// ---- holidays ----
const holidays = loadScript('js/holidays.js', { Store: { getCache: () => null, saveCache() {} }, Location: { get: () => null } },
    ['normalizeHolidayTitle', 'formatCandleTime', 'isIsraelLocation', 'holidaysCacheKey', 'CANDLE_LIGHTING_MINUTES']);

check('holiday titles lose the Hebrew year, and the first day of Rosh Hashana is named', () => {
    assert.strictEqual(holidays.normalizeHolidayTitle('Rosh Hashana 5787'), 'Rosh Hashana I');
    assert.strictEqual(holidays.normalizeHolidayTitle('Rosh Hashana II'), 'Rosh Hashana II');
    assert.strictEqual(holidays.normalizeHolidayTitle('Pesach I'), 'Pesach I');
    assert.strictEqual(holidays.normalizeHolidayTitle('Chanukah: 3 Candles'), 'Chanukah: 3 Candles');
});
check('candle-lighting times are read from the wall-clock time in the text, never re-interpreted in this device\'s time zone', () => {
    assert.strictEqual(holidays.formatCandleTime('2026-09-04T19:05:00-04:00'), '7:05 PM');
    assert.strictEqual(holidays.formatCandleTime('2026-12-04T16:02:00+02:00'), '4:02 PM');
    assert.strictEqual(holidays.formatCandleTime('2026-09-04T00:05:00+03:00'), '12:05 AM');
    assert.strictEqual(holidays.formatCandleTime('2026-09-04T12:00:00Z'), '12:00 PM');
    assert.strictEqual(holidays.formatCandleTime('not a time'), null);
});
check('candle lighting is 18 minutes before sunset, everywhere', () => {
    assert.strictEqual(holidays.CANDLE_LIGHTING_MINUTES, 18);
});
check('Israel is recognised by country or time zone, and gets its own cached schedule', () => {
    assert.strictEqual(holidays.isIsraelLocation({ country: 'IL' }), true);
    assert.strictEqual(holidays.isIsraelLocation({ tzid: 'Asia/Jerusalem' }), true);
    assert.strictEqual(holidays.isIsraelLocation({ tzid: 'Asia/Tel_Aviv' }), true);
    assert.strictEqual(holidays.isIsraelLocation({ country: 'US', tzid: 'America/New_York' }), false);
    assert.strictEqual(holidays.isIsraelLocation(null), false);
    const outside = holidays.holidaysCacheKey(2026, 11, { lat: 40.7, lon: -74, tzid: 'America/New_York' });
    const inside = holidays.holidaysCacheKey(2026, 11, { lat: 31.7, lon: 35.2, tzid: 'Asia/Jerusalem' });
    assert.strictEqual(outside, 'holidays_2026-11_40.7_-74');
    assert.strictEqual(inside, 'holidays_2026-11_31.7_35.2_il');
});

done();
