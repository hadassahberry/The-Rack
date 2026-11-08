// Keyboard and screen-reader support for the calendar's days (and the wording for a saved outfit's
// thumbnails). Pure functions (no page access) so they can be tested on their own.
//
//   dayAccessibleName     the spoken name of a day: its date plus the planning state that matters,
//                         kept short so tabbing through a month isn't a wall of words
//   calendarKeyTarget     where an arrow / Home / End / Page key should take keyboard focus
//   anchorToShow          what to build the view around so a given day is on screen

const CA_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CA_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function caParse(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function caKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function caAddDays(key, n) {
    const d = caParse(key);
    return caKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

// "Friday, November 6, 2026. Today. Selected. 2 outfits planned: Class, Dinner. Holiday: Veterans Day."
//   outfits: the day's outfits [{ label, itemIds }]; holidayNames: real holidays and observances only
//   (not the weekly Shabbos). Days with nothing planned don't say "nothing planned" (it would be
//   repeated on most days); only things that are true and useful are spoken.
function dayAccessibleName({ date, isToday, isSelected, outfits, holidayNames }) {
    const parts = [`${CA_WEEKDAYS[date.getDay()]}, ${CA_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}.`];
    if (isToday) parts.push('Today.');
    if (isSelected) parts.push('Selected.');

    const planned = (outfits || []).filter(o => o.itemIds && o.itemIds.length > 0);
    if (planned.length > 0) {
        const labels = [...new Set(planned.map(o => String(o.label || '').trim()).filter(Boolean))];
        const shown = labels.slice(0, 3).join(', ');
        const more = labels.length > 3 ? `, and ${labels.length - 3} more` : '';
        parts.push(`${planned.length} ${planned.length === 1 ? 'outfit' : 'outfits'} planned${labels.length ? `: ${shown}${more}` : ''}.`);
    }

    const holidays = [...new Set((holidayNames || []).filter(Boolean))];
    if (holidays.length > 0) {
        const more = holidays.length > 3 ? `, and ${holidays.length - 3} more` : '';
        parts.push(`${holidays.length === 1 ? 'Holiday' : 'Holidays'}: ${holidays.slice(0, 3).join(', ')}${more}.`);
    }
    return parts.join(' ');
}

// The same day-of-month one month earlier/later (a 31st becomes the 28th, 29th or 30th when needed),
// or the same weekday one or two weeks away, depending on the view.
function caShiftPeriod(dateKey, viewMode, direction) {
    const d = caParse(dateKey);
    if (viewMode === 'month') {
        const first = new Date(d.getFullYear(), d.getMonth() + direction, 1);
        const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        return caKey(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay)));
    }
    return caAddDays(dateKey, direction * (viewMode === '2weeks' ? 14 : 7));
}

// Where focus goes for a key, or null for a key the calendar doesn't use.
//   weekStart: 0 = weeks begin on Sunday, 1 = Monday
function calendarKeyTarget({ key, dateKey, viewMode, weekStart }) {
    const offsetInWeek = (caParse(dateKey).getDay() - weekStart + 7) % 7;
    switch (key) {
        case 'ArrowLeft': return caAddDays(dateKey, -1);
        case 'ArrowRight': return caAddDays(dateKey, 1);
        case 'ArrowUp': return caAddDays(dateKey, -7);
        case 'ArrowDown': return caAddDays(dateKey, 7);
        case 'Home': return caAddDays(dateKey, -offsetInWeek);
        case 'End': return caAddDays(dateKey, 6 - offsetInWeek);
        case 'PageUp': return caShiftPeriod(dateKey, viewMode, -1);
        case 'PageDown': return caShiftPeriod(dateKey, viewMode, 1);
        default: return null;
    }
}

// The date to build the view around so that `dateKey` is showing: the first of its month for the
// month view, the day itself for week and 2-week views.
function anchorToShow(viewMode, dateKey) {
    const d = caParse(dateKey);
    return viewMode === 'month' ? new Date(d.getFullYear(), d.getMonth(), 1) : d;
}

// The small markers on a phone's month cells, in a fixed order, each a different SHAPE (so they
// don't depend on colour): the forecast's icon, a star for a holiday, a candle for candle lighting.
function dayMarkers({ hasWeather, weatherIcon, hasHoliday, hasCandles }) {
    const out = [];
    if (hasWeather && weatherIcon) out.push({ kind: 'weather', glyph: weatherIcon });
    if (hasHoliday) out.push({ kind: 'holiday', glyph: '★' });
    if (hasCandles) out.push({ kind: 'candle', glyph: '🕯' });
    return out;
}

// A saved outfit's thumbnails are the only place its pieces are shown, so they get a spoken
// summary: "Pieces: Blue top, Black skirt, Brown shoes". Long outfits are shortened to the first few
// with "and N more" so it stays concise. '' when there is nothing to say.
function outfitPiecesSummary(names, max = 6) {
    const list = (names || []).map(n => String(n || '').trim()).filter(Boolean);
    if (list.length === 0) return '';
    if (list.length <= max) return `Pieces: ${list.join(', ')}`;
    return `Pieces: ${list.slice(0, max).join(', ')}, and ${list.length - max} more`;
}

// The one-line key under the calendar for the markers actually showing ('' when there are none).
function markerKeyText(kinds) {
    const has = (k) => (kinds instanceof Set ? kinds.has(k) : (kinds || []).includes(k));
    const parts = [];
    if (has('weather')) parts.push('weather icon = forecast');
    if (has('holiday')) parts.push('★ holiday');
    if (has('candle')) parts.push('🕯 candle lighting');
    return parts.length ? `${parts.join(' · ')}. Tap a day for details.` : '';
}

if (typeof module !== 'undefined') {
    module.exports = { dayAccessibleName, calendarKeyTarget, anchorToShow, caShiftPeriod, caKey, caParse, dayMarkers, markerKeyText, outfitPiecesSummary };
}
