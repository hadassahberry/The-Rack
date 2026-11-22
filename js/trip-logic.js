// Trips: the pure rules (no page, no network, no database), tested on their own in tests/trips.test.js.
// js/trips.js is the page side. What a trip is, in short:
//
//   - A trip is a destination plus first and last day. Its DAYS are ordinary days of the Planner: you plan them in the
//     Planner and with Help me choose exactly as any other day. The trip only says which days are away and where.
//   - Weather on a trip day comes from the DESTINATION, never from the home location (the home location is not even read).
//     Where the destination forecast doesn't reach, the day says "Forecast not available yet." and no weather is used or
//     shown; nothing is estimated, because there is no real source for an estimate here.
//   - The packing checklist is worked out from the outfits planned on the trip's days, one entry per piece (by piece id), each
//     with the dates that use it. It is computed fresh from the planner every time, so it can never drift out of step; only
//     which pieces are ticked is saved (trip.packed, by piece id).

const TRIP_MAX_DAYS = 60;                 // longest trip
const TRIP_MAX_AHEAD_DAYS = 730;          // a start date further away than this is almost certainly a typo in the year
const TRIP_CATEGORY_ORDER = ['outerwear', 'tops', 'dresses', 'bottoms', 'shoes', 'accessories'];   // head to toe, like everywhere else
const TRIP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRIP_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- dates ('YYYY-MM-DD', real calendar dates only) ----
function isIsoDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const tripUtc = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
function tripAddDays(key, n) { return new Date(tripUtc(key) + n * 86400000).toISOString().slice(0, 10); }
function tripDaysBetween(a, b) { return Math.round((tripUtc(b) - tripUtc(a)) / 86400000); }       // b - a, in days
// every date of a trip, first to last, inclusive ([] when the dates are not valid or backwards)
function tripDates(start, end) {
    if (!isIsoDate(start) || !isIsoDate(end) || end < start) return [];
    const out = [];
    for (let d = start, n = 0; d <= end && n <= TRIP_MAX_DAYS * 2; d = tripAddDays(d, 1), n++) out.push(d);
    return out;
}
// "Nov 24" and "Mon, Nov 24"
function tripShortDate(key) { const [, m, d] = key.split('-').map(Number); return `${TRIP_MONTHS[m - 1]} ${d}`; }
function tripWeekdayDate(key) { return `${TRIP_WEEKDAYS[new Date(tripUtc(key)).getUTCDay()]}, ${tripShortDate(key)}`; }
// "Nov 24 to Nov 30" (with the year when it isn't the year of `todayKey`)
function tripRangeLabel(start, end, todayKey) {
    const yr = (k) => (todayKey && k.slice(0, 4) !== todayKey.slice(0, 4) ? `, ${k.slice(0, 4)}` : '');
    return start === end ? `${tripShortDate(start)}${yr(start)}` : `${tripShortDate(start)}${yr(start)} to ${tripShortDate(end)}${yr(end)}`;
}
// Dates written compactly, runs of consecutive days joined: ["2026-11-24","2026-11-25","2026-11-26","2026-11-29"] -> "Nov 24–26, Nov 29"
function describeTripDates(dates) {
    const sorted = [...new Set(dates)].sort();
    const runs = [];
    sorted.forEach(d => {
        const last = runs[runs.length - 1];
        if (last && tripDaysBetween(last[last.length - 1], d) === 1) last.push(d); else runs.push([d]);
    });
    return runs.map(run => {
        if (run.length === 1) return tripShortDate(run[0]);
        const a = run[0], b = run[run.length - 1];
        return a.slice(5, 7) === b.slice(5, 7) ? `${tripShortDate(a)}–${Number(b.slice(8))}` : `${tripShortDate(a)}–${tripShortDate(b)}`;
    }).join(', ');
}

// ---- destinations ----
const geoClean = (v) => (typeof v === 'string' ? v.trim() : '');
// The place search's answer -> places. Anything without real coordinates is dropped (it could not give a forecast).
function normalizeGeoResults(json) {
    const list = (json && Array.isArray(json.results) ? json.results : []).filter(r => r && typeof r === 'object');
    return list.map(r => ({
        id: r && r.id,
        name: geoClean(r && r.name), admin1: geoClean(r && r.admin1), admin2: geoClean(r && r.admin2),
        country: geoClean(r && r.country), countryCode: geoClean(r && r.country_code).toUpperCase(),
        latitude: typeof r.latitude === 'number' ? r.latitude : NaN, longitude: typeof r.longitude === 'number' ? r.longitude : NaN,       // a missing coordinate is missing, not 0
        timezone: geoClean(r && r.timezone),
        population: Number.isFinite(Number(r && r.population)) && Number(r.population) > 0 ? Number(r.population) : 0
    })).filter(p => p.name && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
        && p.latitude >= -90 && p.latitude <= 90 && p.longitude >= -180 && p.longitude <= 180);
}
const labelParts = (p, withAdmin2) => [p.name, withAdmin2 ? p.admin2 : '', p.admin1, p.country].filter((x, i, a) => x && a.indexOf(x) === i);
// Gives every place a label that is different from every other place in the same list, so two matches for one name
// can always be told apart: "Paris, Île-de-France, France" / "Paris, Texas, United States". If the region is not enough
// the county / district is added, and if even that matches, the coordinates are.
function disambiguatePlaces(places) {
    const withLabels = places.map(p => ({ ...p, label: labelParts(p, false).join(', ') }));
    const dup = (arr) => arr.map(p => p.label).filter((l, i, a) => a.indexOf(l) !== i);
    let clash = new Set(dup(withLabels));
    withLabels.forEach(p => { if (clash.has(p.label)) p.label = labelParts(p, true).join(', '); });
    clash = new Set(dup(withLabels));
    withLabels.forEach(p => { if (clash.has(p.label)) p.label += ` (${Math.abs(p.latitude).toFixed(2)}°${p.latitude < 0 ? 'S' : 'N'}, ${Math.abs(p.longitude).toFixed(2)}°${p.longitude < 0 ? 'W' : 'E'})`; });
    return withLabels;
}
// What is stored on a trip for its destination: only what is needed (a name to show, and where to ask for the forecast).
function destinationFromPlace(place) {
    return { label: place.label, name: place.name, admin1: place.admin1 || '', country: place.country || '', countryCode: place.countryCode || '', latitude: place.latitude, longitude: place.longitude, timezone: place.timezone || '' };
}
const validDestination = (d) => !!d && typeof d === 'object' && geoClean(d.name) !== '' && Number.isFinite(d.latitude) && Number.isFinite(d.longitude)
    && d.latitude >= -90 && d.latitude <= 90 && d.longitude >= -180 && d.longitude <= 180;

// ---- trips ----
// A trip read back from the database, or null if it isn't usable. Unknown or missing optional parts are tolerated.
function normalizeTrip(id, data) {
    if (!data || typeof data !== 'object') return null;
    if (!validDestination(data.destination) || !isIsoDate(data.start) || !isIsoDate(data.end) || data.end < data.start) return null;
    const d = data.destination;
    return {
        id: String(id),
        name: geoClean(data.name).slice(0, 60),
        destination: { label: geoClean(d.label) || geoClean(d.name), name: geoClean(d.name), admin1: geoClean(d.admin1), country: geoClean(d.country), countryCode: geoClean(d.countryCode), latitude: d.latitude, longitude: d.longitude, timezone: geoClean(d.timezone) },
        start: data.start, end: data.end,
        packed: data.packed && typeof data.packed === 'object' ? Object.fromEntries(Object.entries(data.packed).filter(([, v]) => v === true || v === false)) : {},
        createdAt: Number.isFinite(data.createdAt) ? data.createdAt : 0
    };
}
// The place a trip day's Jewish-calendar data (holidays and candle lighting) is for: the destination, in the shape the holiday code
// reads (coordinates, time zone, and the country so Israel gets its own schedule). A destination saved without a time zone has no
// usable location for Hebcal, so such a day shows no candle-lighting time rather than borrowing the home one.
function tripLocation(trip) {
    const d = trip.destination;
    return { city: d.name, region: d.admin1 || '', country: d.countryCode || undefined, lat: d.latitude, lon: d.longitude, tzid: d.timezone || undefined, source: 'trip' };
}
const tripTitle = (trip) => trip.name || `Trip to ${trip.destination.name}`;
function tripOnDate(trips, dateKey) {
    return (trips || []).find(t => t.start <= dateKey && dateKey <= t.end) || null;
}

// What is wrong with a trip that is about to be saved: { ok, errors: { destination?, start?, end?, dates? }, messages: [...] }.
// existingTrips: the other trips (for overlap); ignoreId: the trip being edited; allowPast: editing a trip that already ended.
function validateTrip({ destination, start, end, todayKey, existingTrips = [], ignoreId = null, allowPast = false }) {
    const errors = {};
    if (!validDestination(destination)) errors.destination = 'Search for the destination and choose the right place from the list.';
    const startOk = isIsoDate(start), endOk = isIsoDate(end);
    if (!start) errors.start = 'Enter the first day of the trip.';
    else if (!startOk) errors.start = 'The first day isn’t a real date.';
    if (!end) errors.end = 'Enter the last day of the trip.';
    else if (!endOk) errors.end = 'The last day isn’t a real date.';
    if (startOk && endOk) {
        if (end < start) errors.dates = 'The last day can’t be before the first day.';
        else if (tripDaysBetween(start, end) + 1 > TRIP_MAX_DAYS) errors.dates = `A trip can be at most ${TRIP_MAX_DAYS} days long.`;
        else if (!allowPast && todayKey && end < todayKey) errors.dates = 'That trip is already over. Choose dates from today on.';
        else if (!allowPast && todayKey && tripDaysBetween(todayKey, start) > TRIP_MAX_AHEAD_DAYS) errors.dates = 'The first day is more than two years away. Check the year.';
        if (!errors.dates) {
            const clash = existingTrips.find(t => t.id !== ignoreId && t.start <= end && start <= t.end);
            if (clash) errors.dates = `These dates overlap your trip “${tripTitle(clash)}” (${tripRangeLabel(clash.start, clash.end, todayKey)}). Trips can’t overlap, because each day’s weather comes from one place.`;
        }
    }
    const messages = ['destination', 'start', 'end', 'dates'].map(k => errors[k]).filter(Boolean);
    return { ok: messages.length === 0, errors, messages };
}

// ---- the weather of a trip ----
// Open-Meteo's daily answer -> { 'YYYY-MM-DD': { high, low, code } } in °F (like the home forecast). Throws if it is not what is expected.
function parseTripForecast(json) {
    if (!json || !json.daily || !Array.isArray(json.daily.time)) throw new Error('Weather response was not what was expected');
    const map = {};
    json.daily.time.forEach((date, i) => {
        const hi = json.daily.temperature_2m_max[i], lo = json.daily.temperature_2m_min[i], code = json.daily.weathercode[i];
        // a missing temperature is a missing day, never a 0
        if (isIsoDate(date) && typeof hi === 'number' && typeof lo === 'number' && Number.isFinite(hi) && Number.isFinite(lo)) map[date] = { high: Math.round(hi), low: Math.round(lo), code };
    });
    return map;
}

// Why a trip day has (or hasn't got) weather. forecastMap is THIS trip's destination forecast only.
//   available  there is a destination forecast for the day
//   off        weather is switched off in Settings (nothing is requested, nothing shown)
//   past       a day before today
//   beyond     after where the destination forecast reaches: "Forecast not available yet." (not an error, and never estimated)
//   loading    inside the range, nothing yet, still being fetched
//   failed     inside the range, nothing, the request failed
//   missing    inside the range, the request worked, but nothing for that day
// status: 'idle' | 'loading' | 'ok' | 'failed' (this trip's last request).
function tripWeatherAvailability({ dateKey, todayKey, forecastMap = {}, status = 'idle', weatherEnabled = true, destinationName = 'the destination' }) {
    if (!weatherEnabled) return { kind: 'off', text: 'Weather is switched off in Settings.' };
    if (forecastMap[dateKey]) return { kind: 'available', text: '', stale: status === 'failed' };
    if (dateKey < todayKey) return { kind: 'past', text: 'No forecast for past dates.' };
    const keys = Object.keys(forecastMap).sort();
    const last = keys.length ? keys[keys.length - 1] : null;
    // with no answer yet, a day more than 16 days ahead is beyond any forecast whatever the destination's time zone is
    const beyond = last ? dateKey > last : tripDaysBetween(todayKey, dateKey) > 16;
    if (beyond) return { kind: 'beyond', text: 'Forecast not available yet.', detail: last ? `The forecast for ${destinationName} reaches ${tripShortDate(last)}.` : '' };
    if (status === 'failed') return { kind: 'failed', text: `Couldn’t load the forecast for ${destinationName}. Check your connection and try again.` };
    if (status === 'loading' || status === 'idle') return { kind: 'loading', text: 'Loading the forecast…' };
    return { kind: 'missing', text: 'No forecast was provided for this day.' };
}

// Which weather a day uses. A day of a trip uses ONLY that trip's destination forecast, even when it is empty:
// the home forecast is never a fallback. Every other day uses the home forecast, as always.
function weatherSourceFor({ dateKey, trips, tripForecasts = {}, homeMap = {} }) {
    const trip = tripOnDate(trips, dateKey);
    if (trip) return { source: 'trip', trip, map: tripForecasts[trip.id] || {} };
    return { source: 'home', trip: null, map: homeMap };
}

// ---- the packing checklist ----
// One entry per piece (by id), however many outfits and days use it, with the dates that use it.
//   outfitsByDate: { 'YYYY-MM-DD': [{ id, itemIds }] }   closet: [{ id, name, category }]   packed: { pieceId: true | false }
// Only days of the trip count. A piece that is no longer in the closet has nothing to pack and is left out.
// Returns { items, groups, total, packed, byId } with items in head-to-toe order and each group a category's items.
function buildPackingList({ trip, outfitsByDate = {}, closet = [], packed = null }) {
    const state = packed || (trip && trip.packed) || {};
    const closetById = new Map((closet || []).map(i => [i.id, i]));
    const datesOf = new Map();                                   // piece id -> Set of dates (a Set, so one piece in two outfits on one day is one date)
    tripDates(trip.start, trip.end).forEach(date => {
        ((outfitsByDate || {})[date] || []).forEach(o => (o.itemIds || []).forEach(id => {
            if (!closetById.has(id)) return;
            if (!datesOf.has(id)) datesOf.set(id, new Set());
            datesOf.get(id).add(date);
        }));
    });
    const rank = (c) => { const i = TRIP_CATEGORY_ORDER.indexOf(c); return i < 0 ? TRIP_CATEGORY_ORDER.length : i; };
    const items = [...datesOf.entries()].map(([id, set]) => {
        const piece = closetById.get(id);
        const dates = [...set].sort();
        return { id, name: piece.name || 'Piece', category: piece.category, dates, datesText: describeTripDates(dates), checked: state[id] === true };
    }).sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
    const groups = [];
    items.forEach(i => {
        let g = groups.find(x => x.category === i.category);
        if (!g) { g = { category: i.category, items: [] }; groups.push(g); }
        g.items.push(i);
    });
    return { items, groups, total: items.length, packed: items.filter(i => i.checked).length };
}

// How many of a trip's days have outfits (with pieces) planned right now, and the sentence for the notice shown after a trip is
// added or changed over days that already had plans. It is worked out from the trip and the CURRENT plans every time it is
// drawn, so it disappears when the plans are removed; '' when there is nothing to say.
function tripPlansNotice(trip, outfitsByDate = {}) {
    if (!trip) return '';
    const days = tripDates(trip.start, trip.end).filter(d => ((outfitsByDate || {})[d] || []).some(o => (o.itemIds || []).length > 0)).length;
    if (days === 0) return '';
    return `${days === 1 ? '1 day of this trip has' : days + ' days of this trip have'} outfits planned in the Planner. Those pieces are on the packing list.`;
}

// The day-by-day view: what is planned on each trip date (by name, head to toe), so the person can see which days still have nothing.
function tripDaySummaries({ trip, outfitsByDate = {}, closet = [] }) {
    const closetById = new Map((closet || []).map(i => [i.id, i]));
    const rank = (c) => { const i = TRIP_CATEGORY_ORDER.indexOf(c); return i < 0 ? TRIP_CATEGORY_ORDER.length : i; };
    return tripDates(trip.start, trip.end).map(date => {
        const outfits = ((outfitsByDate || {})[date] || []).map(o => ({
            label: o.label || '',
            pieces: [...new Set(o.itemIds || [])].map(id => closetById.get(id)).filter(Boolean).sort((a, b) => rank(a.category) - rank(b.category)).map(p => p.name || 'Piece')
        })).filter(o => o.pieces.length > 0);
        return { date, label: tripWeekdayDate(date), outfits };
    });
}

if (typeof module !== 'undefined') {
    module.exports = {
        TRIP_MAX_DAYS, TRIP_MAX_AHEAD_DAYS, TRIP_CATEGORY_ORDER,
        isIsoDate, tripAddDays, tripDaysBetween, tripDates, tripShortDate, tripWeekdayDate, tripRangeLabel, describeTripDates,
        normalizeGeoResults, disambiguatePlaces, destinationFromPlace, validDestination,
        normalizeTrip, tripTitle, tripOnDate, tripLocation, validateTrip,
        parseTripForecast, tripWeatherAvailability, weatherSourceFor, buildPackingList, tripDaySummaries, tripPlansNotice
    };
}
