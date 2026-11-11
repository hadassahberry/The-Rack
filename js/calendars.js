// The optional calendars besides the Jewish one (js/holidays.js):
//   - Christian holidays  (worked out on the device, no internet needed)
//   - Islamic (Hijri) calendar  (the browser's built-in Intl calendar, no internet needed)
//   - Public holidays by country  (free Nager.Date service; only a country code is sent)
// Each is switched on in Settings and nothing is requested for one that is off.

// ---------------------------------------------------------------------------
// Small date helpers (local dates, no time-zone surprises)

function calKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// A local date `n` days after (year, month 1-12, day).
function calAddDays(year, month, day, n) {
    return new Date(year, month - 1, day + n);
}

// ---------------------------------------------------------------------------
// Christian holidays

// Western Easter (Catholic and Protestant): the standard Gregorian computus.
function easterWestern(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

// Orthodox Easter: the Julian computus, then +13 days to the Gregorian date
// (correct for 1900-2099).
function easterOrthodox(year) {
    const a = year % 4, b = year % 7, c = year % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31);
    const day = ((d + e + 114) % 31) + 1;
    return calAddDays(year, month, day, 13);
}

// First Sunday of Advent: four Sundays before Christmas.
function adventStart(year) {
    const christmasWeekday = new Date(year, 11, 25).getDay();     // 0 = Sunday
    const fourthSunday = 25 - (christmasWeekday === 0 ? 7 : christmasWeekday);
    return new Date(year, 11, fourthSunday - 21);
}

// { 'YYYY-MM-DD': ['Good Friday', ...] } for one year.
// style: 'western' | 'orthodox' (which Easter, and so which Lent / Pentecost).
function christianHolidaysForYear(year, style) {
    const map = {};
    const add = (date, name) => { (map[calKey(date)] = map[calKey(date)] || []).push(name); };
    const orthodox = style === 'orthodox';
    const easter = orthodox ? easterOrthodox(year) : easterWestern(year);
    const fromEaster = (n) => calAddDays(easter.getFullYear(), easter.getMonth() + 1, easter.getDate(), n);

    if (orthodox) {
        add(new Date(year, 0, 7), 'Christmas (Julian calendar)');
        add(new Date(year, 0, 19), 'Theophany (Julian calendar)');
        add(fromEaster(-48), 'Clean Monday (Great Lent begins)');
    } else {
        add(new Date(year, 0, 6), 'Epiphany');
        add(fromEaster(-46), 'Ash Wednesday');
        add(fromEaster(-3), 'Maundy Thursday');
    }
    add(fromEaster(-7), 'Palm Sunday');
    add(fromEaster(-2), 'Good Friday');
    add(easter, orthodox ? 'Easter (Pascha)' : 'Easter Sunday');
    add(fromEaster(39), 'Ascension Day');
    add(fromEaster(49), 'Pentecost');
    if (!orthodox) {
        add(new Date(year, 10, 1), "All Saints' Day");
        add(adventStart(year), 'First Sunday of Advent');
        add(new Date(year, 11, 24), 'Christmas Eve');
    }
    add(new Date(year, 11, 25), 'Christmas Day');
    return map;
}

const christianCache = {};
function christianNamesFor(date, style) {
    const k = `${date.getFullYear()}_${style}`;
    christianCache[k] = christianCache[k] || christianHolidaysForYear(date.getFullYear(), style);
    return christianCache[k][calKey(date)] || [];
}

// ---------------------------------------------------------------------------
// Islamic (Hijri) calendar, from the browser's own Intl calendar (Umm al-Qura).
// The real start of a month depends on the moon being sighted, so a date can
// be a day off from what a local community announces.

const HIJRI_MONTHS = ['Muharram', 'Safar', "Rabi' al-awwal", "Rabi' al-thani", 'Jumada al-ula',
    'Jumada al-thani', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah'];

// "month-day" -> name
const HIJRI_HOLIDAYS = {
    '1-1': 'Islamic New Year',
    '1-10': 'Day of Ashura',
    '3-12': "Mawlid (Prophet's Birthday)",
    '7-27': "Isra and Mi'raj",
    '8-15': "Mid-Sha'ban",
    '9-1': 'Ramadan begins',
    '9-27': 'Laylat al-Qadr (traditionally)',
    '10-1': 'Eid al-Fitr',
    '12-9': 'Day of Arafah',
    '12-10': 'Eid al-Adha'
};

// How a Hijri date is written, by rule (never ad hoc):
//   'full'    "30 Jumada al-ula 1448 AH"  the day's popup, tooltips and screen-reader names
//   'compact' "30 Jumada al-ula"          calendar cells (the year is in the full form)
//   'short'   "30", or "1 Jum II" on the first of a month   a phone's month cells, where there is no room for words
// (the short month names are all different, so a month start is never ambiguous)
const HIJRI_MONTHS_SHORT = ['Muh', 'Saf', 'Rab I', 'Rab II', 'Jum I', 'Jum II', 'Raj', 'Sha', 'Ram', 'Shaw', 'DhQ', 'DhH'];
function formatHijri(h, style = 'full') {
    if (!h) return '';
    if (style === 'short') return h.day === 1 ? `1 ${HIJRI_MONTHS_SHORT[h.month - 1]}` : String(h.day);
    if (style === 'compact') return `${h.day} ${h.monthName}`;
    return `${h.day} ${h.monthName} ${h.year} AH`;
}

let hijriFormatter;      // undefined = not tried yet, null = this browser can't do it
function getHijriFormatter() {
    if (hijriFormatter !== undefined) return hijriFormatter;
    hijriFormatter = null;
    for (const calendar of ['islamic-umalqura', 'islamic-civil']) {
        try {
            const f = new Intl.DateTimeFormat(`en-US-u-ca-${calendar}-nu-latn`,
                { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
            if (/islamic/.test(f.resolvedOptions().calendar)) { hijriFormatter = f; break; }
        } catch { /* try the next one */ }
    }
    return hijriFormatter;
}

function hijriSupported() { return !!getHijriFormatter(); }

// { day, month (1-12), year, monthName, holiday } for a local calendar date, or null.
function hijriFor(date) {
    const f = getHijriFormatter();
    if (!f) return null;
    // Noon UTC on the same civil date, so no time-zone shifts the day.
    const parts = f.formatToParts(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12)));
    const get = (type) => Number((parts.find(p => p.type === type) || {}).value);
    const day = get('day'), month = get('month'), year = get('year');
    if (!day || !month || !year) return null;
    return { day, month, year, monthName: HIJRI_MONTHS[month - 1], holiday: HIJRI_HOLIDAYS[`${month}-${day}`] || null };
}

// ---------------------------------------------------------------------------
// Public holidays by country (Nager.Date: free, no key). Only the country code
// is sent. One request per country and year, kept on the device.

const PUBLIC_HOLIDAY_CACHE_DAYS = 60;

// The country whose holidays to show: the saved location's, else the device's language region.
function publicHolidayCountry(location) {
    if (location && /^[A-Z]{2}$/.test(location.country || '')) return location.country;
    try {
        const region = new Intl.Locale(navigator.language).maximize().region;
        if (/^[A-Z]{2}$/.test(region || '')) return region;
    } catch { /* no region */ }
    return null;
}

function countryName(code) {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; }
}

function publicHolidaysCacheKey(year, country) { return `publicholidays_${country}_${year}`; }

// Nager's list -> { 'YYYY-MM-DD': ['New Year's Day', ...] }. Only holidays that
// apply to the whole country; regional ones would be wrong for most people.
function parsePublicHolidays(list) {
    const map = {};
    (Array.isArray(list) ? list : []).forEach(h => {
        if (!h || typeof h.date !== 'string' || typeof h.name !== 'string') return;
        if (h.global === false) return;
        if (Array.isArray(h.types) && !h.types.includes('Public')) return;
        const key = h.date.slice(0, 10);
        (map[key] = map[key] || []).push(h.name);
    });
    return map;
}

const PublicHolidays = {
    getMap(year, country) {
        const cached = country && Store.getCache(publicHolidaysCacheKey(year, country));
        return (cached && cached.map) || {};
    },

    async refresh(year, country) {
        if (!country) return {};
        const key = publicHolidaysCacheKey(year, country);
        const cached = Store.getCache(key);
        if (cached && Date.now() - cached.at < PUBLIC_HOLIDAY_CACHE_DAYS * 86400000) return cached.map || {};
        try {
            const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`);
            if (res.status === 404) {                       // a country the service doesn't cover
                Store.saveCache(key, { at: Date.now(), map: {} });
                return {};
            }
            if (!res.ok) return (cached && cached.map) || {};
            const map = parsePublicHolidays(await res.json());
            Store.saveCache(key, { at: Date.now(), map });
            return map;
        } catch {
            return (cached && cached.map) || {};
        }
    }
};

// ---------------------------------------------------------------------------
// Everything the extra calendars say about one day.

function normalizeNoteName(text) {
    return text.toLowerCase().replace(/[^a-z]/g, '');
}

// { notes: [{ text, kind: 'public' | 'christian' | 'islamic' }], hijri: {...} | null }
// A name that two calendars both give (Good Friday, Christmas Day) is shown once.
function extraCalendarNotes(date, prefs, location) {
    const notes = [];
    const seen = new Set();
    const push = (text, kind) => {
        const k = normalizeNoteName(text);
        if (seen.has(k)) return;
        seen.add(k);
        notes.push({ text, kind });
    };

    if (prefs.publicHolidays) {
        const country = publicHolidayCountry(location);
        const names = (PublicHolidays.getMap(date.getFullYear(), country)[calKey(date)]) || [];
        names.forEach(n => push(n, 'public'));
    }
    if (prefs.christianHolidays) {
        christianNamesFor(date, prefs.christianStyle).forEach(n => push(n, 'christian'));
    }
    let hijri = null;
    if (prefs.hijriCalendar) {
        hijri = hijriFor(date);
        if (hijri && hijri.holiday) push(hijri.holiday, 'islamic');
    }
    return { notes, hijri };
}

if (typeof module !== 'undefined') {
    module.exports = { easterWestern, easterOrthodox, adventStart, christianHolidaysForYear, hijriFor, hijriSupported, formatHijri, HIJRI_MONTHS_SHORT,
        parsePublicHolidays, publicHolidayCountry, extraCalendarNotes, calKey };
}
