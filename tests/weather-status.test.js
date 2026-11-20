// js/weather-status.js: why a day has (or has not got) a forecast. Nothing here invents weather; it only explains.
const { check, done, assert, same } = require('./_harness');
const W = require('../js/weather-status.js');

const TODAY = '2026-11-11';
const avail = (dateKey, over = {}) => W.weatherAvailability({ dateKey, todayKey: TODAY, hasForecast: false, status: 'ok', ...over });

check('the forecast covers today plus the next 15 days (16 in all)', () => {
    assert.strictEqual(W.FORECAST_DAYS, 16);
    assert.strictEqual(W.forecastLastDay('2026-11-11'), '2026-11-26');
    assert.strictEqual(W.forecastLastDay('2026-12-25'), '2027-01-09');       // across a year
    assert.strictEqual(W.forecastLastDay('2028-02-20'), '2028-03-06');       // across a leap day
});
check('short day labels', () => {
    assert.strictEqual(W.shortDayLabel('2026-02-03'), 'Feb 3');
    assert.strictEqual(W.shortDayLabel('2026-11-26'), 'Nov 26');
});
check('a past day never shows a forecast, even a saved one', () => {
    const r = avail('2026-11-10', { hasForecast: true });
    assert.strictEqual(r.kind, 'past');
    assert.strictEqual(r.text, 'No forecast for past dates.');
});
check('after the last covered day: "not available yet" (not an error), naming the last day', () => {
    const r = avail('2026-11-27');
    assert.strictEqual(r.kind, 'beyond');
    assert.strictEqual(r.text, 'Forecast not available yet. Forecasts are available from today through Nov 26.');
    assert.strictEqual(avail('2026-11-26').kind, 'missing', 'the last covered day is still inside the range');
});
check('inside the range with a forecast: available (flagged stale if the last refresh failed)', () => {
    same(avail('2026-11-12', { hasForecast: true }), { kind: 'available', text: '', stale: false });
    assert.strictEqual(avail('2026-11-12', { hasForecast: true, status: 'failed' }).stale, true);
    assert.strictEqual(avail(TODAY, { hasForecast: true }).kind, 'available', 'today is inside the range');
});
check('inside the range with none: loading, failed, or missing, each its own explanation', () => {
    assert.strictEqual(avail('2026-11-12', { status: 'loading' }).kind, 'loading');
    assert.strictEqual(avail('2026-11-12', { status: 'idle' }).kind, 'loading');
    const failed = avail('2026-11-12', { status: 'failed' });
    assert.strictEqual(failed.kind, 'failed');
    assert(/Couldn’t load the forecast/.test(failed.text));
    const missing = avail('2026-11-12', { status: 'ok' });
    assert.strictEqual(missing.kind, 'missing');
    assert.strictEqual(missing.text, 'No forecast was provided for this day.');
});
check('only a failed request is an error', () => {
    const kinds = ['past', 'beyond', 'loading', 'missing'];
    const seen = [avail('2026-11-10').kind, avail('2026-12-31').kind, avail('2026-11-12', { status: 'loading' }).kind, avail('2026-11-12').kind];
    same(seen, kinds);
});

check('how old a saved forecast is', () => {
    assert.strictEqual(W.describeAge(30 * 1000), 'a minute ago');
    assert.strictEqual(W.describeAge(5 * 60000), '5 minutes ago');
    assert.strictEqual(W.describeAge(3 * 3600000), '3 hours ago');
    assert.strictEqual(W.describeAge(26 * 3600000), 'yesterday');
    assert.strictEqual(W.describeAge(3 * 86400000), '3 days ago');
    assert.strictEqual(W.describeAge(-5), 'earlier');
    assert.strictEqual(W.describeAge(NaN), 'earlier');
});

check('the one line under the calendar: only when some visible day has none, and only one thing said', () => {
    const legend = (visibleKeys, over = {}) => W.weatherLegend({ visibleKeys, todayKey: TODAY, hasForecastFor: () => true, status: 'ok', ...over });
    assert.strictEqual(legend(['2026-11-12', '2026-11-13']), null, 'every day has a forecast: nothing to explain');
    same(legend(['2026-11-10', '2026-11-12']), { text: 'Forecasts are available from today through Nov 26.', retry: false });
    same(legend(['2026-11-12', '2026-12-20']), { text: 'Forecasts are available from today through Nov 26.', retry: false });
    same(legend(['2026-11-12'], { hasForecastFor: () => false, status: 'failed' }), { text: 'Couldn’t load the weather forecast.', retry: true });
    same(legend(['2026-11-12'], { hasForecastFor: () => false, status: 'loading' }), { text: 'Loading the weather forecast…', retry: false });
    // a failure outranks everything else on screen
    assert.strictEqual(legend(['2026-11-10', '2026-11-12'], { hasForecastFor: k => k !== '2026-11-12', status: 'failed' }).retry, true);
});

done();
