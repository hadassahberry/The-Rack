// Why a day has (or hasn't got) a weather forecast. Pure functions, no page access, so they
// can be tested on their own. Nothing here invents weather: it only explains.
//
// The forecast service covers today plus the next 15 days (FORECAST_DAYS = 16 days in all).
// For any date there are exactly these cases:
//   past       before today: no forecast is shown (an old forecast would be misleading, and we
//              don't have what the weather actually was)
//   beyond     after the last covered day: "not available yet" (that is not an error)
//   available  has a forecast
//   loading    inside the range, nothing yet, and the forecast is still being fetched
//   failed     inside the range, nothing, and the last request failed (this IS an error)
//   missing    inside the range, the request worked, but there is no entry for that day
// `status` is the state of the most recent request: 'idle' | 'loading' | 'ok' | 'failed'.

const FORECAST_DAYS = 16;
const WS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function wsParse(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function wsKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// The last date the forecast covers, given today ('YYYY-MM-DD').
function forecastLastDay(todayKey) {
    const t = wsParse(todayKey);
    return wsKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() + FORECAST_DAYS - 1));
}

// "Nov 22"
function shortDayLabel(key) {
    const d = wsParse(key);
    return `${WS_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// { kind, text, stale? } for one date. hasForecast: is there a forecast entry for it.
function weatherAvailability({ dateKey, todayKey, hasForecast, status }) {
    if (dateKey < todayKey) {
        return { kind: 'past', text: 'No forecast for past dates.' };
    }
    const last = forecastLastDay(todayKey);
    if (dateKey > last) {
        return { kind: 'beyond', text: `Forecast not available yet. Forecasts are available from today through ${shortDayLabel(last)}.` };
    }
    if (hasForecast) return { kind: 'available', text: '', stale: status === 'failed' };
    if (status === 'failed') return { kind: 'failed', text: 'Couldn’t load the forecast. Check your connection and try again.' };
    if (status === 'loading' || status === 'idle') return { kind: 'loading', text: 'Loading the forecast…' };
    return { kind: 'missing', text: 'No forecast was provided for this day.' };
}

// "3 hours ago" for the note under a forecast that couldn't be refreshed.
function describeAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'earlier';
    const min = Math.round(ms / 60000);
    if (min < 2) return 'a minute ago';
    if (min < 60) return `${min} minutes ago`;
    const h = Math.round(min / 60);
    if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
    const days = Math.round(h / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
}

// The one short line under the calendar, only when some day on screen has no forecast.
//   visibleKeys: every date on screen; hasForecastFor(key) -> bool
// Returns { text, retry } or null when there is nothing to explain.
function weatherLegend({ visibleKeys, todayKey, hasForecastFor, status }) {
    const kinds = new Set(visibleKeys.map(k => weatherAvailability({ dateKey: k, todayKey, hasForecast: hasForecastFor(k), status }).kind));
    if (kinds.has('failed')) return { text: 'Couldn’t load the weather forecast.', retry: true };
    if (kinds.has('loading')) return { text: 'Loading the weather forecast…', retry: false };
    if (kinds.has('past') || kinds.has('beyond') || kinds.has('missing')) {
        return {
            text: `Forecasts are available from today through ${shortDayLabel(forecastLastDay(todayKey))}.`,
            retry: false
        };
    }
    return null;
}

if (typeof module !== 'undefined') {
    module.exports = { FORECAST_DAYS, forecastLastDay, shortDayLabel, weatherAvailability, describeAge, weatherLegend };
}
