const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Which range the calendar shows: 'week', '2weeks' or 'month' (the default,
// every time the page opens). anchorDate is the date the range is built
// around: its month for 'month', its Sunday-start week for the others.
let viewMode = 'month';
let anchorDate;
let selectedDateKey;
let planningActiveCategory = 'tops';

// Kept in sync by Firestore's live listeners (see initLiveData) so render
// functions can read synchronously instead of awaiting Store on every call.
let plannerCloset = [];
let plannerOutfits = {};     // { 'YYYY-MM-DD': [{ id, label, itemIds, flagsOff }] } — what's planned each day
let plannerSchedule = {};    // { 'YYYY-MM-DD': [itemIds] } — the same days flattened (calendar cells, gap tags, "planned")
let plannerSavedOutfits = [];

// ---- Saving feedback (js/save-state.js) ----
// Plans save as you go. The line in the day popup (and, when the popup is closed, the one above the
// calendar) says Saving… / Saved / Couldn’t save – try again. A day whose save failed stays as the person
// left it on screen, and "try again" writes that same plan again.
let unsavedDays = {};        // { 'YYYY-MM-DD': [outfits] } — failed saves, shown (and retried) until one succeeds
let planSaveState = { status: 'idle', slow: false, failedCount: 0 };
let planSaveViews = null;
const planSaves = createSaveTracker({ onChange: (state) => { planSaveState = state; renderPlanSaveStatus(); } });
warnBeforeLeavingWhileSaving(planSaves);

function renderPlanSaveStatus() {
    if (!planSaveViews) return;
    const popupOpen = document.body.classList.contains('planning-open');
    planSaveViews.panel.render(planSaveState);
    planSaveViews.page.render(popupOpen ? { status: 'idle' } : planSaveState);     // one visible line at a time
}

function isoDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    anchorDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    selectedDateKey = isoDateKey(today);

    document.getElementById('prev-month-btn').addEventListener('click', () => stepView(-1));
    document.getElementById('next-month-btn').addEventListener('click', () => stepView(1));
    document.getElementById('today-btn').addEventListener('click', goToToday);
    const dayGrid = document.getElementById('month-grid');
    dayGrid.addEventListener('keydown', onCalendarKeydown);
    dayGrid.addEventListener('focusin', (e) => {        // however focus got onto a day (Tab, arrows, a click, a screen reader), it becomes the one Tab stop
        const day = e.target.closest && e.target.closest('.month-cell');
        if (!day) return;
        calendarFocusKey = day.dataset.date;
        dayGrid.querySelectorAll('.month-cell').forEach(c => { c.tabIndex = c === day ? 0 : -1; });
    });
    planSaveViews = {
        panel: createSaveStatusView(document.getElementById('plan-save-status'), { onRetry: () => planSaves.retryFailed() }),
        page: createSaveStatusView(document.getElementById('calendar-save-status'), { onRetry: () => planSaves.retryFailed() })
    };
    document.getElementById('apply-undo-btn').addEventListener('click', undoApply);
    document.getElementById('weather-retry-btn').addEventListener('click', retryWeather);
    document.getElementById('planning-weather-retry').addEventListener('click', retryWeather);
    document.addEventListener('weather-status', () => renderCalendar());   // loading / loaded / failed
    scheduleMidnightRefresh();
    // The planning panel is a popup: close with the button, a click outside, or Esc.
    document.getElementById('back-to-calendar-btn').addEventListener('click', closePlanningPopup);
    document.getElementById('planning-backdrop').addEventListener('click', closePlanningPopup);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('planning-open')) closePlanningPopup();
    });
    document.getElementById('view-switcher').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-view]');
        if (btn) setViewMode(btn.dataset.view);
    });
    document.getElementById('add-outfit-btn').addEventListener('click', () => {
        const id = newOutfitId();
        activeOutfitId = id;
        updateDay(selectedDateKey, outfits => [...outfits, { id, label: '', itemIds: [], flagsOff: false }]);
    });

    window.waitForAuth().then(initCalendarLiveData);

    renderCalendar();
});

function initCalendarLiveData() {
    Store.onClosetChange((closet) => { plannerCloset = closet; renderCalendar(); });
    Store.onScheduleChange((byDate) => {
        plannerOutfits = byDate;
        // A day whose save failed keeps what the person did (the server copy reverted) until it is saved.
        for (const [date, outfits] of Object.entries(unsavedDays)) {
            if (outfits.length) plannerOutfits[date] = outfits; else delete plannerOutfits[date];
        }
        plannerSchedule = Store.flattenSchedule(plannerOutfits);
        renderCalendar();
    });
    Store.onSavedOutfitsChange((outfits) => { plannerSavedOutfits = outfits; renderCalendar(); });
}

function formatLocationLabel(location) {
    if (!location) return '';
    return location.region ? `${location.city}, ${location.region}` : location.city;
}

// Fetches whatever the user has switched on (Settings) for this location, then
// redraws. Anything switched off is never requested, so no location is sent
// to that service.
async function refreshLocationData(location) {
    const prefs = Store.getPrefs();
    if (prefs.weatherEnabled) await Weather.refresh(location);
    await refreshHolidaysForView(Store.getLocation() || location);
    renderCalendar();
}

// Every date shown in the current view. Month view fills out whole weeks, so
// it includes a few days from the neighboring months; the week views start on
// the Sunday of the anchor date's week.
function visibleDates() {
    const a = anchorDate;
    const weekStart = weekStartIndex();
    if (viewMode === 'month') {
        const y = a.getFullYear(), m = a.getMonth();
        const startDay = (new Date(y, m, 1).getDay() - weekStart + 7) % 7;   // blank days before the 1st
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const total = Math.ceil((startDay + daysInMonth) / 7) * 7;
        return Array.from({ length: total }, (_, i) => new Date(y, m, 1 + i - startDay));
    }
    const count = viewMode === 'week' ? 7 : 14;
    const daysIntoWeek = (a.getDay() - weekStart + 7) % 7;
    return Array.from({ length: count }, (_, i) => new Date(a.getFullYear(), a.getMonth(), a.getDate() - daysIntoWeek + i));
}

// Which weekday the calendar's week begins on (Settings): 0 = Sunday, 1 = Monday.
function weekStartIndex() {
    return Store.getPrefs().weekStart === 'mon' ? 1 : 0;
}

// Holiday data comes from the network for two calendars, and only for the ones
// switched on: Hebcal (Jewish) one month at a time, and Nager.Date (public
// holidays) one year at a time. A week or 2-week view can straddle two months
// (or two years), so fetch each one that appears on screen. The Christian and
// Hijri calendars are worked out on the device and need nothing fetched.
async function refreshHolidaysForView(location) {
    const prefs = Store.getPrefs();
    const dates = visibleDates();
    const jobs = [];
    if (prefs.hebrewCalendarEnabled) {
        const months = new Map();
        dates.forEach(d => months.set(`${d.getFullYear()}-${d.getMonth()}`, d));
        months.forEach(d => jobs.push(Holidays.refresh(d.getFullYear(), d.getMonth() + 1, location)));
    }
    if (prefs.publicHolidays) {
        const country = publicHolidayCountry(location || Location.get());
        new Set(dates.map(d => d.getFullYear())).forEach(y => jobs.push(PublicHolidays.refresh(y, country)));
    }
    await Promise.all(jobs);
}

function viewLabel(dates) {
    if (viewMode === 'month') return `${MONTH_NAMES[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`;
    const first = dates[0], last = dates[dates.length - 1];
    const short = (d) => `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
    return first.getFullYear() === last.getFullYear()
        ? `${short(first)} – ${short(last)}, ${last.getFullYear()}`
        : `${short(first)}, ${first.getFullYear()} – ${short(last)}, ${last.getFullYear()}`;
}

async function stepView(direction) {
    const a = anchorDate;
    anchorDate = viewMode === 'month'
        ? new Date(a.getFullYear(), a.getMonth() + direction, 1)
        : new Date(a.getFullYear(), a.getMonth(), a.getDate() + direction * (viewMode === 'week' ? 7 : 14));
    renderCalendar();
    await refreshHolidaysForView(Store.getLocation());
    renderCalendar();
}

// "Today": come back to the current date in whichever view is open (Week, 2 weeks or
// Month) and select it. The view itself is not changed.
async function goToToday() {
    const now = new Date();
    anchorDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    selectedDateKey = isoDateKey(now);
    renderCalendar();
    await refreshHolidaysForView(Store.getLocation());
    renderCalendar();
}

// If the page stays open past midnight, today's marker moves to the new day by itself.
function scheduleMidnightRefresh() {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    setTimeout(() => {
        renderCalendar();
        scheduleMidnightRefresh();
    }, nextMidnight - now);
}

async function setViewMode(mode) {
    if (mode === viewMode || !['week', '2weeks', 'month'].includes(mode)) return;
    // The new range is built around the day you picked if you can see it, else today if
    // you can see that, else wherever you're looking now (js/view-range.js). Your
    // selected day is never changed by switching views.
    anchorDate = pickSwitchAnchor({
        fromMode: viewMode,
        toMode: mode,
        dates: visibleDates(),
        anchorDate,
        selectedKey: selectedDateKey,
        todayKey: isoDateKey(new Date())
    });
    viewMode = mode;
    renderCalendar();
    await refreshHolidaysForView(Store.getLocation());
    renderCalendar();
}

function renderCalendar() {
    renderCalendarGrid();
    renderPlanningPanel();
}

// Holiday data (and Friday candle-lighting) for one date. `cache` lets a
// caller rendering many dates reuse each month's map instead of re-reading it.
function getHolidayInfo(date, location, cache = {}) {
    const k = `${date.getFullYear()}-${date.getMonth() + 1}`;
    cache[k] = cache[k] || Holidays.getMap(date.getFullYear(), date.getMonth() + 1, location);
    return cache[k][isoDateKey(date)];
}

// "Shabbos", "Rosh Hashana I", ... for one date.
function holidayTitlesFor(date, holidayInfo) {
    return [
        ...(date.getDay() === 6 ? ['Shabbos'] : []),
        ...((holidayInfo && holidayInfo.holidays) ? holidayInfo.holidays.map(h => h.title) : [])
    ];
}

// A small photo of a piece (its color dot if it somehow has no photo).
// `alt` is '' where the piece's name is already written next to the photo.
function itemThumb(item, className, alt = item.name) {
    if (!itemPhoto(item)) {
        const dot = document.createElement('span');
        dot.className = 'color-dot';
        dot.style.background = item.color || '#ccc';
        return dot;
    }
    const img = document.createElement('img');
    img.className = className;
    img.src = itemPhoto(item);
    img.alt = alt;
    return img;
}

const phoneQuery = window.matchMedia('(max-width: 640px)');
// Turning a phone sideways (or resizing a window) changes how many photos fit.
phoneQuery.addEventListener('change', () => renderCalendarGrid());

// How many photos fit in one calendar day before it says "+N".
function cellPhotoLimit() {
    if (phoneQuery.matches) return viewMode === 'month' ? 3 : 5;
    return viewMode === 'week' ? 5 : 4;
}

// The pieces planned for one calendar day: one group per outfit (activity),
// side by side, so two activities never blend together. Inside a group the
// pieces run head to toe, a top above a bottom.
function buildCellItems(outfits, closetById, showPhotos) {
    const groups = outfits
        .map(o => ({
            label: o.label || '',
            items: sortHeadToToe(o.itemIds.map(id => closetById[id]).filter(Boolean))
        }))
        .filter(g => g.items.length > 0);

    // (spans, not divs: the whole day is a <button>, which may only hold inline elements)
    const box = document.createElement('span');
    box.className = showPhotos ? 'cell-items cell-groups' : 'cell-items';
    if (groups.length > 1) box.classList.add('multi');
    const limit = cellPhotoLimit();       // pieces per outfit before "+N"
    let tallestStack = 1;                 // most photos in any one outfit's column (drives their size in CSS)

    groups.forEach(group => {
        const groupEl = document.createElement('span');
        groupEl.className = 'cell-group';
        if (group.label) {
            const label = document.createElement('span');
            label.className = 'cell-group-label';
            label.textContent = group.label;
            label.title = group.label;
            groupEl.appendChild(label);
        }

        if (!showPhotos) {
            group.items.forEach(item => {
                const row = document.createElement('span');
                row.className = 'cell-item-row';
                const dot = document.createElement('span');
                dot.className = 'color-dot';
                dot.style.background = item.color || '#ccc';
                row.append(dot, document.createTextNode(item.name));
                groupEl.appendChild(row);
            });
        } else {
            const photos = document.createElement('span');
            photos.className = 'cell-photos';
            const shown = group.items.length > limit ? group.items.slice(0, limit - 1) : group.items;
            shown.forEach(item => {
                const thumb = itemThumb(item, 'cell-thumb');
                thumb.title = item.name;
                photos.appendChild(thumb);
            });
            if (shown.length < group.items.length) {
                const more = document.createElement('span');
                more.className = 'cell-more';
                more.textContent = `+${group.items.length - shown.length}`;
                photos.appendChild(more);
            }
            groupEl.appendChild(photos);
            tallestStack = Math.max(tallestStack, photos.children.length);
        }
        box.appendChild(groupEl);
    });
    // CSS sizes the photos from these: as big as the day's width and height allow,
    // smaller with more pieces or more outfits.
    if (showPhotos) {
        box.style.setProperty('--per-row', String(Math.min(2, Math.max(1, groups.length))));   // outfits beyond two wrap underneath
        box.style.setProperty('--n', String(tallestStack));
    }
    return box;
}

// Clicking a day opens the planning panel (that day's outfit + the photo
// closet to pick from) as a popup over the calendar, on every screen size.
function openPlanningPopup() {
    applyStatus = null;                    // a fresh look at the day: no leftover message from before
    renderApplyStatus();
    const panel = document.querySelector('.planning-panel');
    document.body.classList.add('planning-open');
    renderPlanSaveStatus();
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'planning-date');
    panel.scrollTop = 0;
    // It is genuinely modal: focus moves in (to the Close button), Tab stays inside, and the calendar
    // and page behind are blocked (only the dim backdrop stays clickable, to close it). Closing hands
    // focus back to the day that was opened (see returnTo: the calendar redraws, so the button that
    // was clicked may be gone).
    ModalDialogs.open(panel, {
        initialFocus: document.getElementById('back-to-calendar-btn'),
        keep: [document.getElementById('planning-backdrop')],
        returnTo: () => {
            const day = document.querySelector(`#month-grid [data-date="${selectedDateKey}"]`);
            if (day) calendarFocusKey = selectedDateKey;
            return day;
        }
    });
}

function closePlanningPopup() {
    const wasOpen = document.body.classList.contains('planning-open');
    const panel = document.querySelector('.planning-panel');
    document.body.classList.remove('planning-open');
    renderPlanSaveStatus();
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('aria-labelledby');
    if (wasOpen) ModalDialogs.close(panel);   // un-blocks the page and returns keyboard focus to the day that was opened
}

// Keyboard focus on the calendar's days. The grid is ONE Tab stop (the day in calendarFocusKey,
// else the selected day, else today); the arrow keys move between days (see onCalendarKeydown).
let calendarFocusKey = null;     // the day that is the Tab stop / has keyboard focus
let pendingFocusKey = null;      // a day to give focus to once the grid has been rebuilt

function renderCalendarGrid() {
    const grid = document.getElementById('month-grid');
    if (!grid) return;
    // The grid is rebuilt from scratch on every redraw (a saved plan arriving, a day being
    // picked...), which would drop keyboard focus: remember which day had it and put it back.
    const focused = document.activeElement;
    const keepFocusKey = pendingFocusKey || (grid.contains(focused) && focused.dataset ? focused.dataset.date : null);
    pendingFocusKey = null;
    grid.innerHTML = '';
    grid.className = `month-grid view-${viewMode}`;
    // Lets CSS treat the weekday header row differently per view (phones
    // show week / 2-week views as a day-by-day list instead of a grid).
    grid.closest('.calendar-panel').dataset.view = viewMode;

    const dates = visibleDates();
    document.getElementById('month-label').textContent = viewLabel(dates);
    document.getElementById('view-sublabel').textContent = describeViewRange(viewMode, dates, new Date());   // "This week", "Next month"...

    // Weekday header row follows the chosen first day of the week.
    const weekStart = weekStartIndex();
    document.querySelector('.weekday-row').innerHTML = Array.from({ length: 7 }, (_, i) =>
        `<span>${WEEKDAY_NAMES[(weekStart + i) % 7].slice(0, 3).toUpperCase()}</span>`).join('');
    const unit = viewMode === 'month' ? 'month' : viewMode === 'week' ? 'week' : '2 weeks';
    document.getElementById('prev-month-btn').setAttribute('aria-label', `Previous ${unit}`);
    document.getElementById('next-month-btn').setAttribute('aria-label', `Next ${unit}`);
    document.querySelectorAll('#view-switcher [data-view]').forEach(btn => {
        const active = btn.dataset.view === viewMode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    });

    const location = Location.get();
    const prefs = Store.getPrefs();                    // Settings: weather / Hebrew calendar on or off
    const weatherMap = prefs.weatherEnabled ? Weather.getForecastMap(location) : {};
    const holidayMaps = {};
    const closetById = Object.fromEntries(plannerCloset.map(i => [i.id, i]));

    const todayKey = isoDateKey(new Date());

    // The single Tab stop: the day that last had focus, else the selected day, else today, else the first day shown.
    const visibleKeys = dates.map(isoDateKey);
    const firstShown = dates.find(d => viewMode !== 'month' || d.getMonth() === anchorDate.getMonth()) || dates[0];
    const tabStopKey = [calendarFocusKey, selectedDateKey, todayKey].find(k => k && visibleKeys.includes(k)) || isoDateKey(firstShown);

    const markerKindsShown = new Set();      // which markers appear in this view (for the key under the calendar)
    for (const cellDate of dates) {
        const dateKey = isoDateKey(cellDate);
        const isToday = dateKey === todayKey;
        const isCurrentMonth = viewMode !== 'month' || cellDate.getMonth() === anchorDate.getMonth();
        const holidayInfo = prefs.hebrewCalendarEnabled ? getHolidayInfo(cellDate, location, holidayMaps) : undefined;
        const holidayTitles = prefs.hebrewCalendarEnabled ? holidayTitlesFor(cellDate, holidayInfo) : [];
        // A forecast only for days it really covers (today and the next 15). Never for a past
        // day (even a stale saved one) and never made up; why a day has none is explained
        // by the legend under the calendar and by the day's own popup.
        const weather = prefs.weatherEnabled ? weatherFor(dateKey, weatherMap, todayKey).forecast : null;
        const extra = extraCalendarNotes(cellDate, prefs, location);   // public / Christian / Hijri

        // Each day is a real <button>: it can be reached with Tab / the arrow keys, shows a focus
        // ring, and opens with Enter or Space exactly as a click does. Its spoken name is the
        // date plus what matters (see js/calendar-access.js); everything inside is for the eye.
        // (A button may only contain inline elements, so the parts inside are spans.)
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'month-cell';
        cell.dataset.date = dateKey;
        cell.tabIndex = dateKey === tabStopKey ? 0 : -1;
        if (!isCurrentMonth) cell.classList.add('not-current');
        if (holidayTitles.length > 0) cell.classList.add('holiday');
        else if (extra.notes.some(n => n.kind === 'public')) cell.classList.add('public-holiday');
        if (dateKey === selectedDateKey) cell.classList.add('selected');
        if (isToday) { cell.classList.add('today'); cell.setAttribute('aria-current', 'date'); }   // its own marker, separate from "selected"
        cell.setAttribute('aria-label', dayAccessibleName({
            date: cellDate,
            isToday,
            isSelected: dateKey === selectedDateKey,
            outfits: plannerOutfits[dateKey] || [],
            holidayNames: [...holidayTitles.filter(t => t !== 'Shabbos'), ...extra.notes.map(n => n.text)]   // real holidays, not the weekly Shabbos
        }));
        cell.addEventListener('click', () => {
            selectedDateKey = dateKey;
            calendarFocusKey = dateKey;
            renderCalendar();
            openPlanningPopup();      // narrow screens: the day's closet pops up right here
        });

        const holidayLabel = holidayTitles.length > 0
            ? `<span class="cell-holiday-label">${holidayTitles.join(' / ')}</span>` : '';
        const candleLabel = (holidayInfo && holidayInfo.candleLighting)
            ? `<span class="cell-candle-label">🕯 ${holidayInfo.candleLighting}</span>` : '';
        const weatherBadge = weather
            ? `<span class="cell-weather">${weatherInfo(weather.code).icon} ${formatTemp(weather.high)}</span>` : '';
        cell.innerHTML = `
            ${holidayLabel}
            <span class="cell-top-row">
                <span class="cell-weekday">${WEEKDAY_NAMES[cellDate.getDay()].slice(0, 3)}</span>
                <span class="cell-date-num">${cellDate.getDate()}${isToday ? '<span class="sr-only"> (today)</span>' : ''}</span>
                ${weatherBadge}
            </span>
            ${candleLabel}
        `;
        // Holiday names from the other calendars (built as elements: some come
        // from the network) and the Hijri date.
        const topRow = cell.querySelector('.cell-top-row');
        if (extra.notes.length) {
            const box = document.createElement('span');
            box.className = 'cell-notes';
            extra.notes.forEach(n => {
                const note = document.createElement('span');
                note.className = `cell-note cell-note-${n.kind}`;
                note.textContent = n.text;
                note.title = n.text;
                box.appendChild(note);
            });
            topRow.before(box);
        }
        if (extra.hijri) {
            const h = extra.hijri;
            const hijri = document.createElement('span');
            hijri.className = 'cell-hijri';
            hijri.title = `${h.day} ${h.monthName} ${h.year} AH`;
            const full = document.createElement('span');
            full.className = 'hijri-full';
            full.textContent = h.day === 1 ? `1 ${h.monthName} ${h.year}` : `${h.day} ${h.monthName}`;
            const short = document.createElement('span');          // phone month view: no room for words
            short.className = 'hijri-short';
            short.textContent = h.day === 1 ? `1 ${h.monthName.slice(0, 3)}` : String(h.day);
            hijri.append(full, short);
            topRow.after(hijri);
        }
        // Phone month view: the words (weather, holiday names, candle times) live in the day's
        // popup, so a few tiny shapes under the date say "there is something here". Decoration
        // only (aria-hidden): the day's spoken name and its popup carry the real details.
        const markers = dayMarkers({
            hasWeather: !!weather,
            weatherIcon: weather ? weatherInfo(weather.code).icon : '',
            hasHoliday: holidayTitles.some(t => t !== 'Shabbos') || extra.notes.length > 0,   // not the weekly Shabbos
            hasCandles: !!(holidayInfo && holidayInfo.candleLighting)
        });
        if (markers.length) {
            const row = document.createElement('span');
            row.className = 'cell-markers';
            row.setAttribute('aria-hidden', 'true');
            markers.forEach(m => {
                const mark = document.createElement('span');
                mark.className = `cm cm-${m.kind}`;
                mark.textContent = m.glyph;
                row.appendChild(mark);
                markerKindsShown.add(m.kind);
            });
            topRow.after(row);
        }
        // The planned pieces: little photos (Settings → Outfit photos) or names.
        // Built as elements, not HTML, so an item's name can't break the page.
        cell.appendChild(buildCellItems(plannerOutfits[dateKey] || [], closetById, prefs.showOutfitPhotos));
        grid.appendChild(cell);
    }
    renderWeatherLegend(prefs.weatherEnabled, dates, weatherMap, todayKey);
    renderMarkerKey(markerKindsShown);

    if (keepFocusKey) {                       // put keyboard focus back on the day that had it
        const again = grid.querySelector(`[data-date="${keepFocusKey}"]`);
        if (again) again.focus({ preventScroll: true });
    }
}

// Arrow keys, Home / End and Page Up / Down move between the days; Enter and Space open one
// (a <button> does that by itself). Only the focused day is a Tab stop, so Tab passes over
// the whole calendar in one step instead of through all of its days.
function onCalendarKeydown(e) {
    const cell = e.target.closest && e.target.closest('.month-cell');
    if (!cell || e.altKey || e.ctrlKey || e.metaKey) return;
    // Up / Down follow the layout: a week down in the 7-column grid, but just the next day when the
    // days are stacked in one column (the Week and 2-week views on a phone).
    let key = e.key;
    const oneColumn = getComputedStyle(document.getElementById('month-grid')).gridTemplateColumns.trim().split(/\s+/).length === 1;
    if (oneColumn && key === 'ArrowUp') key = 'ArrowLeft';
    if (oneColumn && key === 'ArrowDown') key = 'ArrowRight';
    const target = calendarKeyTarget({ key, dateKey: cell.dataset.date, viewMode, weekStart: weekStartIndex() });
    if (!target) return;
    e.preventDefault();                       // the arrows and Page keys shouldn't also scroll the page
    focusCalendarDay(target);
}

function focusCalendarDay(dateKey) {
    const grid = document.getElementById('month-grid');
    calendarFocusKey = dateKey;
    const shown = grid.querySelector(`[data-date="${dateKey}"]`);
    if (shown) {                              // already on screen: move focus (and the one Tab stop) there
        grid.querySelectorAll('.month-cell').forEach(c => { c.tabIndex = c === shown ? 0 : -1; });
        shown.focus();
        return;
    }
    // Off the edge of what's showing: move the view just far enough, then focus the day.
    anchorDate = anchorToShow(viewMode, dateKey);
    pendingFocusKey = dateKey;
    renderCalendar();
    refreshHolidaysForView(Store.getLocation()).then(renderCalendar);     // focus stays on the day through this redraw too
}

// --- Weather: what to show for a day, and why there's sometimes nothing (js/weather-status.js) ---

// { avail, forecast }: why a day has or hasn't got weather, and the forecast itself when it does.
function weatherFor(dateKey, weatherMap, todayKey) {
    const avail = weatherAvailability({ dateKey, todayKey, hasForecast: !!weatherMap[dateKey], status: Weather.status });
    return { avail, forecast: avail.kind === 'available' ? weatherMap[dateKey] : null };
}

// One quiet line under the calendar explaining the markers that are actually showing
// (phone month view only; CSS hides it elsewhere). The wording is in js/calendar-access.js.
function renderMarkerKey(kinds) {
    const key = document.getElementById('marker-key');
    if (!key) return;
    const text = markerKeyText(kinds);
    key.classList.toggle('hidden', !text);
    key.textContent = text;
}

// The one quiet line under the calendar. Shown only when some visible day has no forecast
// (past, too far ahead, still loading, or the request failed), and only if weather is on.
function renderWeatherLegend(enabled, dates, weatherMap, todayKey) {
    const box = document.getElementById('weather-legend');
    if (!box) return;
    const legend = enabled
        ? weatherLegend({ visibleKeys: dates.map(isoDateKey), todayKey, hasForecastFor: k => !!weatherMap[k], status: Weather.status })
        : null;
    box.classList.toggle('hidden', !legend);
    box.classList.toggle('is-error', !!legend && legend.retry);
    document.getElementById('weather-legend-text').textContent = legend ? legend.text : '';
    document.getElementById('weather-retry-btn').classList.toggle('hidden', !(legend && legend.retry));
}

// "Try again" after a failed forecast request. The calendar redraws as the request starts and ends.
function retryWeather() {
    return Weather.refresh(Location.get());
}

function computeGapDays(itemId, excludeDateKey) {
    const selected = new Date(excludeDateKey);
    let nearest = null;

    Object.keys(plannerSchedule).forEach(dateKey => {
        if (dateKey === excludeDateKey) return;
        if (!plannerSchedule[dateKey].includes(itemId)) return;
        const diffDays = Math.round((new Date(dateKey) - selected) / 86400000);
        if (nearest === null || Math.abs(diffDays) < Math.abs(nearest)) nearest = diffDays;
    });

    return nearest;
}

// ---------------------------------------------------------------------------
// Outfits on the selected day
//
// A day can hold several outfits ("Friday night", "Class"...), each with an
// optional activity label. The piece picker and saved outfits act on the
// ACTIVE outfit (the highlighted card). Repeat warnings come from js/repeats.js.
// ---------------------------------------------------------------------------

let activeOutfitId = null;

function newOutfitId() {
    return 'out_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Edits one day's outfits and saves. `mutate` gets a copy of the list and
// returns the new list (an empty list removes the day).
function updateDay(dateKey, mutate) {
    const copy = (plannerOutfits[dateKey] || []).map(o => ({ ...o, itemIds: [...o.itemIds] }));
    const next = mutate(copy);
    // Apply it locally straight away. A second tap before the save comes back
    // from the server then builds on this change instead of overwriting it.
    if (next.length) plannerOutfits[dateKey] = next; else delete plannerOutfits[dateKey];
    plannerSchedule = Store.flattenSchedule(plannerOutfits);
    renderApplyStatus();      // any change to a day makes an earlier "Added…" notice (and its Undo) out of date, right away
    delete unsavedDays[dateKey];                 // this edit already builds on (and replaces) any earlier failed one for the day
    // Saved only when the server has confirmed it. The same list is what "try again" writes, so a retry can
    // neither lose the edit nor add a second copy (the day's document is replaced, not appended to).
    return planSaves.run(dateKey, () => Store.setScheduleOutfits(dateKey, next), {
        onOk: (latest) => { if (latest) delete unsavedDays[dateKey]; },
        onFail: (err, latest) => {
            console.error('Saving the plan failed', err);
            if (!latest) return;                       // a newer edit to this day has replaced it
            unsavedDays[dateKey] = next;
            if (next.length) plannerOutfits[dateKey] = next; else delete plannerOutfits[dateKey];
            plannerSchedule = Store.flattenSchedule(plannerOutfits);
            renderCalendar();
        }
    });
}

// Shabbos (Saturdays) and Yom Tov count as activities on their own when the
// Hebrew calendar is on, so repeats are caught without any typing. Yom Tov
// needs that month's holiday data to be on this device, which it is for any
// month that's been viewed.
function autoActivityLabel(dateKey, prefs, location, cache) {
    if (!prefs.hebrewCalendarEnabled) return '';
    const date = new Date(dateKey + 'T00:00:00');
    const info = getHolidayInfo(date, location, cache);
    if (info && info.holidays && info.holidays.some(h => h.yomtov)) return 'Yom Tov';
    return date.getDay() === 6 ? 'Shabbos' : '';
}

// An outfit's activity: what the user typed, otherwise the automatic one.
function makeLabelOf(prefs, location) {
    const cache = {};
    return (dateKey, outfit) => (outfit.label || '').trim() || autoActivityLabel(dateKey, prefs, location, cache);
}

// This person's activities, as saved on their plans, most recently used first (js/activities.js).
// Nothing is built in: no plans means an empty list.
function savedActivities() {
    return activityList(plannerOutfits, Date.now());
}

// Saves an activity on one of the selected day's outfits. The time is kept so the list can show
// the most recently used first. Only that outfit's label changes; the rest of the plan is as it was.
function setOutfitActivity(outfitId, label) {
    return updateDay(selectedDateKey, outfits => {
        const o = outfits.find(x => x.id === outfitId);
        if (o) {
            o.label = label;
            if (label) o.labelAt = Date.now(); else delete o.labelAt;
        }
        return outfits;
    });
}

function repeatContextFor(dateKey, outfit, prefs, labelOf) {
    return repeatContext({ dateKey, label: labelOf(dateKey, outfit), outfitsByDate: plannerOutfits, labelOf, prefs });
}

// "Worn to Class · 2 weeks ago"
function repeatTagText(ctx, occurrence) {
    return `Worn to ${ctx.label} · ${describeWhen(occurrence.daysAway)}`;
}

function setActiveOutfit(id) {
    if (activeOutfitId === id) return;
    activeOutfitId = id;
    document.querySelectorAll('#planning-items .outfit-card').forEach(card => {
        card.classList.toggle('active', card.dataset.outfitId === id);
    });
    renderPicker();   // the picker's highlights and warnings depend on the active outfit
}

function buildOutfitCard({ outfit, isActive, ctx, autoLabel, catById, chips }) {
    const card = document.createElement('div');
    card.className = 'outfit-card' + (isActive ? ' active' : '');
    card.dataset.outfitId = outfit.id;
    card.addEventListener('click', (e) => {
        if (!e.target.closest('input, button')) setActiveOutfit(outfit.id);
    });

    // --- header: activity label + remove ---
    const head = document.createElement('div');
    head.className = 'outfit-card-head';

    // The Activity field is an editable dropdown of the person's own saved activities (js/activity-combo.js).
    const combo = createActivityCombo({
        value: outfit.label || '',
        getActivities: savedActivities,
        onFocus: () => setActiveOutfit(outfit.id),
        onCommit: (label) => setOutfitActivity(outfit.id, label)
    });
    head.appendChild(combo.element);

    if (!outfit.label && autoLabel) {
        const pill = document.createElement('span');
        pill.className = 'outfit-auto-label';
        pill.textContent = `${autoLabel} (automatic)`;
        head.appendChild(pill);
    }

    // "Mark as worn": wearing is something you confirm, not something planning implies.
    // Only today and past days can be marked (you can't have worn tomorrow's outfit yet).
    if (selectedDateKey <= isoDateKey(new Date()) && outfit.itemIds.length > 0) {
        const worn = document.createElement('button');
        worn.type = 'button';
        worn.className = 'worn-toggle' + (outfit.worn ? ' is-worn' : '');
        worn.setAttribute('aria-pressed', String(!!outfit.worn));
        worn.textContent = outfit.worn ? '✓ Worn' : 'Mark as worn';
        worn.addEventListener('click', () => {
            updateDay(selectedDateKey, outfits => {
                const o = outfits.find(x => x.id === outfit.id);
                if (o) o.worn = !o.worn;
                return outfits;
            });
        });
        head.appendChild(worn);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'outfit-delete';
    remove.setAttribute('aria-label', 'Remove this outfit');
    remove.textContent = '🗑️';
    remove.addEventListener('click', async () => {
        // An empty outfit with no activity has nothing in it to lose: remove it straight away.
        const hasContent = outfit.itemIds.length > 0 || !!outfit.label;
        if (hasContent) {
            const day = new Date(selectedDateKey + 'T00:00:00');
            const what = [outfit.label ? `“${outfit.label}”` : 'This outfit',
                outfit.itemIds.length ? `with ${pluralize(outfit.itemIds.length, 'piece')}` : ''].filter(Boolean).join(' ');
            const sure = await confirmDialog({
                title: 'Remove this outfit?',
                message: `${what} will be removed from ${WEEKDAY_NAMES[day.getDay()]}, ${MONTH_NAMES[day.getMonth()]} ${day.getDate()}.`,
                details: outfit.worn ? ['It is marked as worn, so it will also leave your wear stats.'] : [],
                note: 'Your clothing pieces stay in your closet.',
                confirmLabel: 'Remove outfit'
            });
            if (!sure) return;
        }
        if (activeOutfitId === outfit.id) activeOutfitId = null;
        updateDay(selectedDateKey, outfits => outfits.filter(x => x.id !== outfit.id));
    });
    head.appendChild(remove);
    card.appendChild(head);

    // --- quick-pick activities for an outfit with no label yet ---
    if (!outfit.label && chips.length) {
        const row = document.createElement('div');
        row.className = 'label-chips';
        chips.forEach(text => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'label-chip';
            chip.textContent = text;
            chip.addEventListener('click', () => {
                activeOutfitId = outfit.id;
                setOutfitActivity(outfit.id, text);
            });
            row.appendChild(chip);
        });
        card.appendChild(row);
    }

    // --- repeat warnings ---
    const flagsOn = !!ctx && !outfit.flagsOff;
    const same = flagsOn ? sameOutfitRepeat(ctx, outfit.itemIds, id => catById[id]) : null;
    const itemFlags = {};
    if (flagsOn) {
        outfit.itemIds.forEach(id => {
            const item = plannerCloset.find(i => i.id === id);
            const rep = item ? itemRepeat(ctx, id, item.category) : null;
            if (rep) itemFlags[id] = rep;
        });
    }
    const anyFlag = !!same || Object.keys(itemFlags).length > 0;

    if (same) {
        const banner = document.createElement('div');
        banner.className = 'repeat-banner';
        banner.textContent = `⚠ Same outfit as ${ctx.label} ${describeWhen(same.daysAway)}`;
        card.appendChild(banner);
    }

    // --- items ---
    if (outfit.itemIds.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'planning-empty';
        empty.textContent = 'No pieces yet — pick some below.';
        card.appendChild(empty);
    }
    sortHeadToToe(outfit.itemIds.map(id => plannerCloset.find(i => i.id === id)).filter(Boolean)).forEach(item => {
        const id = item.id;
        const row = document.createElement('div');
        row.className = 'planning-item-row';

        row.appendChild(itemThumb(item, 'planning-item-thumb', ''));

        const name = document.createElement('span');
        name.className = 'planning-item-name';
        name.textContent = item.name;
        row.appendChild(name);

        if (itemFlags[id]) {
            const tag = document.createElement('span');
            tag.className = 'repeat-tag';
            tag.textContent = repeatTagText(ctx, itemFlags[id]);
            row.appendChild(tag);
        }
        const gap = computeGapDays(id, selectedDateKey);
        if (gap !== null && Math.abs(gap) <= 3) {
            const gapTag = document.createElement('span');
            gapTag.className = 'gap-tag';
            gapTag.textContent = `${Math.abs(gap)}d gap`;
            row.appendChild(gapTag);
        }

        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'remove-item-btn';
        x.setAttribute('aria-label', 'Remove');
        x.textContent = '×';
        x.addEventListener('click', () => {
            updateDay(selectedDateKey, outfits => {
                const o = outfits.find(y => y.id === outfit.id);
                if (!o) return outfits;
                o.itemIds = o.itemIds.filter(y => y !== id);
                // an outfit emptied of everything (and with no activity) just goes away
                return (!o.itemIds.length && !o.label) ? outfits.filter(y => y !== o) : outfits;
            });
        });
        row.appendChild(x);
        card.appendChild(row);
    });

    // --- dismissing / restoring the warnings ---
    if (anyFlag || (outfit.flagsOff && ctx)) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'link-btn flag-toggle';
        link.textContent = outfit.flagsOff ? 'Repeat warnings are off for this outfit — turn them back on' : 'Don’t warn about repeats for this outfit.';
        link.addEventListener('click', () => {
            updateDay(selectedDateKey, outfits => {
                const o = outfits.find(y => y.id === outfit.id);
                if (o) o.flagsOff = !o.flagsOff;
                return outfits;
            });
        });
        card.appendChild(link);
    }
    return card;
}

function renderOutfitCards(prefs, location, labelOf) {
    const box = document.getElementById('planning-items');
    const addBtn = document.getElementById('add-outfit-btn');
    const outfits = plannerOutfits[selectedDateKey] || [];
    if (!outfits.some(o => o.id === activeOutfitId)) activeOutfitId = outfits.length ? outfits[0].id : null;

    const catById = Object.fromEntries(plannerCloset.map(i => [i.id, i.category]));
    // The quick-pick chips under an outfit with no activity are the person's own most recent ones.
    // No activity is ever suggested that they haven't saved themselves.
    const suggestions = savedActivities().map(a => a.label);

    box.innerHTML = '';
    if (outfits.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'planning-empty';
        empty.textContent = 'Nothing planned yet. Add a piece below, or choose Add an outfit to start planning.';
        box.appendChild(empty);
    }
    outfits.forEach(outfit => {
        box.appendChild(buildOutfitCard({
            outfit,
            isActive: outfit.id === activeOutfitId,
            ctx: repeatContextFor(selectedDateKey, outfit, prefs, labelOf),
            autoLabel: autoActivityLabel(selectedDateKey, prefs, location, {}),
            catById,
            chips: suggestions.slice(0, 5)
        }));
    });
    addBtn.textContent = outfits.length ? '+ Add another outfit' : '+ Add an outfit';
}

// --- Applying a saved outfit to the selected day (rules: js/apply-outfit.js) ---
let applyStatus = null;      // { dateKey, text, kind: 'info' | 'already', undo }: what the last apply did

function renderApplyStatus() {
    const box = document.getElementById('apply-status');
    if (!box) return;
    // The notice describes the day as it was right after the apply. If the day has changed since (an
    // outfit added or removed, a piece changed, anything), it is out of date: drop it, and its Undo
    // with it, so Undo can never work from an old snapshot and wipe out later edits.
    if (applyStatus && !applyNoticeIsCurrent(applyStatus, plannerOutfits[applyStatus.dateKey])) applyStatus = null;
    const show = !!applyStatus && applyStatus.dateKey === selectedDateKey;
    box.classList.toggle('hidden', !show);
    box.classList.toggle('is-already', show && applyStatus.kind === 'already');
    document.getElementById('apply-status-text').textContent = show ? applyStatus.text : '';
    document.getElementById('apply-undo-btn').classList.toggle('hidden', !(show && applyStatus.undo));
}

// Adds or replaces pieces as the rules say, never silently, and tells the person what happened.
function applySavedOutfit(saved) {
    const dateKey = selectedDateKey;
    const dayOutfits = plannerOutfits[dateKey] || [];
    const plan = planApplySavedOutfit({ dayOutfits, activeId: activeOutfitId, savedItemIds: saved.itemIds });
    const target = dayOutfits.find(o => o.id === plan.outfitId);
    let undo = null;

    if (plan.action === 'already') {
        if (plan.outfitId !== activeOutfitId) setActiveOutfit(plan.outfitId);   // point at the outfit that has it
    } else if (plan.action === 'create' || plan.action === 'add') {
        const id = newOutfitId();
        activeOutfitId = id;
        updateDay(dateKey, outfits => [...outfits, { id, label: '', itemIds: [...saved.itemIds], flagsOff: false }]);
        undo = () => {
            if (activeOutfitId === id) activeOutfitId = null;
            return updateDay(dateKey, outfits => outfits.filter(o => o.id !== id));
        };
    } else if (plan.action === 'fill' || plan.action === 'replace') {
        const before = plan.action === 'replace' ? plan.previousItemIds : [];
        updateDay(dateKey, outfits => {
            const o = outfits.find(x => x.id === plan.outfitId);
            if (o) o.itemIds = [...saved.itemIds];            // only the pieces: its activity (and everything else) stays
            return outfits;
        });
        undo = () => updateDay(dateKey, outfits => {
            const o = outfits.find(x => x.id === plan.outfitId);
            if (o) o.itemIds = [...before];
            return outfits;
        });
    }

    // The day has already been updated locally by now, so this is how the day looks right after the apply.
    applyStatus = {
        dateKey, text: describeApply(plan, saved.name, target), kind: plan.action === 'already' ? 'already' : 'info', undo,
        signature: outfitsSignature(plannerOutfits[dateKey])
    };
    renderApplyStatus();
}

function undoApply() {
    renderApplyStatus();                                   // drops a notice that has gone out of date
    if (!applyStatus || !applyStatus.undo) return;
    const { dateKey, undo } = applyStatus;
    undo();                                                // (changes the day, which clears the old notice)
    applyStatus = { dateKey, text: 'Undone.', kind: 'info', undo: null, signature: outfitsSignature(plannerOutfits[dateKey]) };
    renderApplyStatus();
}

// Saved outfits, the category tabs and the piece grid (all act on the active outfit).
function renderPicker() {
    const outfitsRow = document.getElementById('planning-saved-outfits');
    const catTabs = document.getElementById('planning-category-tabs');
    const pieceGrid = document.getElementById('planning-piece-grid');
    const prefs = Store.getPrefs();
    const location = Location.get();
    const labelOf = makeLabelOf(prefs, location);
    const dayOutfits = plannerOutfits[selectedDateKey] || [];
    const active = dayOutfits.find(o => o.id === activeOutfitId) || null;
    const ctx = active && !active.flagsOff ? repeatContextFor(selectedDateKey, active, prefs, labelOf) : null;
    const closetById = Object.fromEntries(plannerCloset.map(i => [i.id, i]));

    // This panel is rebuilt after every change (a piece added or removed, a category picked), which
    // would drop keyboard focus: note what had it, and give it back once the new buttons exist.
    const focused = document.activeElement;
    const refocusPiece = pieceGrid.contains(focused) ? focused.dataset.itemId : null;
    const refocusCategory = catTabs.contains(focused) ? focused.dataset.category : null;

    // Saved outfits: replace the active outfit's pieces (or start a new outfit)
    outfitsRow.innerHTML = '';
    if (plannerSavedOutfits.length === 0) {
        outfitsRow.innerHTML = '<p class="planning-empty">No saved outfits yet.</p>';
    }
    plannerSavedOutfits.forEach(saved => {
        const pill = document.createElement('button');
        pill.className = 'outfit-pill';
        // a peek at the pieces, so you can tell outfits apart by sight
        const savedPieces = sortHeadToToe(saved.itemIds.map(id => closetById[id]).filter(Boolean));
        savedPieces.slice(0, 3).forEach(item => pill.appendChild(itemThumb(item, 'outfit-pill-thumb', '')));
        const pillName = document.createElement('span');
        pillName.textContent = saved.name;
        pill.appendChild(pillName);
        // Spoken: the outfit's name is the button's name; its pieces (what the thumbnails show) are
        // the description. The thumbnails themselves stay silent (empty alt text).
        pill.setAttribute('aria-label', saved.name);
        const piecesText = outfitPiecesSummary(savedPieces.map(i => i.name));
        if (piecesText) {
            const desc = document.createElement('span');
            desc.className = 'sr-only';
            desc.id = `saved-pieces-${saved.id}`;
            desc.textContent = piecesText;
            pill.appendChild(desc);
            pill.setAttribute('aria-describedby', desc.id);
        }
        // Already on this day? Say so before it's even clicked.
        if (dayOutfits.some(o => o.itemIds.length > 0 && sameItemSet(o.itemIds, saved.itemIds))) {
            pill.classList.add('is-planned');
            const tag = document.createElement('span');
            tag.className = 'pill-planned';
            tag.textContent = '✓ Planned';
            pill.appendChild(tag);
            pill.setAttribute('aria-label', `${saved.name} (already planned on this day)`);
        }
        pill.addEventListener('click', () => applySavedOutfit(saved));
        outfitsRow.appendChild(pill);
    });
    renderApplyStatus();

    // Add-a-single-piece category tabs
    catTabs.innerHTML = '';
    CATEGORIES.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${cat === planningActiveCategory ? 'active' : ''}`;
        btn.dataset.category = cat;
        btn.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
        btn.addEventListener('click', () => {
            planningActiveCategory = cat;
            renderPicker();
        });
        catTabs.appendChild(btn);
    });

    // Piece grid
    pieceGrid.innerHTML = '';
    const anyPlannedIds = new Set(Object.values(plannerSchedule).flat());
    const pieces = plannerCloset.filter(i => i.category === planningActiveCategory);
    if (pieces.length === 0) {
        pieceGrid.innerHTML = '<p class="planning-empty">No items in this category yet.</p>';
    }
    pieces.forEach((item, index) => {
        const inActive = !!active && active.itemIds.includes(item.id);
        const rep = ctx ? itemRepeat(ctx, item.id, item.category) : null;
        const status = rep ? repeatTagText(ctx, rep) : (anyPlannedIds.has(item.id) ? 'planned' : 'rested');

        // Each piece is a real toggle button: reachable with Tab, switched with Space or Enter, and
        // "pressed" says it is in the outfit being edited. Its name is the piece's name; its
        // status ("planned", "Worn to Class · 6 days ago") is the description. The photo and the
        // tick are decoration (the photo has empty alt text because the name already says it).
        // Parts are spans because a button may only hold inline content.
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `piece-card ${inActive ? 'selected' : ''} ${rep ? 'is-repeat' : ''}`;
        card.dataset.itemId = item.id;
        card.setAttribute('aria-pressed', String(inActive));

        // Photo first: sometimes you just want to see it. The name is underneath.
        const photoBox = document.createElement('span');
        photoBox.className = 'piece-card-photo';
        photoBox.appendChild(itemThumb(item, 'piece-card-img', ''));
        if (inActive) {
            const check = document.createElement('span');
            check.className = 'piece-check';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = '✓';
            photoBox.appendChild(check);
        }
        const name = document.createElement('span');
        name.className = 'piece-card-name';
        name.id = `piece-name-${index}`;
        name.textContent = item.name;
        const st = document.createElement('span');
        st.className = 'piece-card-status';
        st.id = `piece-status-${index}`;
        st.textContent = status;
        card.title = item.name;                      // the full name on hover, when a long one is shortened
        card.setAttribute('aria-labelledby', name.id);
        card.setAttribute('aria-describedby', st.id);
        card.append(photoBox, name, st);

        card.addEventListener('click', () => {
            if (!active) {
                const id = newOutfitId();
                activeOutfitId = id;
                updateDay(selectedDateKey, outfits => [...outfits, { id, label: '', itemIds: [item.id], flagsOff: false }]);
                return;
            }
            updateDay(selectedDateKey, outfits => {
                const o = outfits.find(x => x.id === active.id);
                if (!o) return outfits;
                o.itemIds = o.itemIds.includes(item.id) ? o.itemIds.filter(x => x !== item.id) : [...o.itemIds, item.id];
                return (!o.itemIds.length && !o.label) ? outfits.filter(x => x !== o) : outfits;
            });
        });
        pieceGrid.appendChild(card);
    });

    // Keyboard focus goes back to the same piece (or category tab) it was on.
    if (refocusPiece) {
        const again = [...pieceGrid.children].find(c => c.dataset && c.dataset.itemId === refocusPiece);
        if (again) again.focus({ preventScroll: true });
    } else if (refocusCategory) {
        const again = [...catTabs.children].find(c => c.dataset.category === refocusCategory);
        if (again) again.focus({ preventScroll: true });
    }
}

function renderPlanningPanel() {
    const dateHeading = document.getElementById('planning-date');
    const weatherLine = document.getElementById('planning-weather');
    if (!dateHeading) return;

    const location = Location.get();
    const prefs = Store.getPrefs();
    const weatherMap = prefs.weatherEnabled ? Weather.getForecastMap(location) : {};
    const selectedDate = new Date(selectedDateKey + 'T00:00:00');

    dateHeading.textContent = `${WEEKDAY_NAMES[selectedDate.getDay()]}, ${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getDate()}`;

    // The forecast for this day, or (when weather is on) a short note saying why there isn't one:
    // a past date, too far ahead ("not available yet", which isn't an error), still loading,
    // or the request failed (with Try again). If the last refresh failed but an earlier
    // forecast is on hand, it's shown with a note saying how old it is.
    const { avail, forecast: weather } = weatherFor(selectedDateKey, weatherMap, isoDateKey(new Date()));
    weatherLine.textContent = weather ? `${weatherInfo(weather.code).icon} ${formatTemp(weather.high, true)} · ${weatherInfo(weather.code).label}` : '';
    weatherLine.classList.toggle('hidden', !weather);

    let noteText = '';
    if (prefs.weatherEnabled) {
        if (avail.kind !== 'available') noteText = avail.text;
        else if (avail.stale) {
            const fetchedAt = Weather.getFetchedAt(location);
            noteText = `Couldn’t refresh the forecast. This one was loaded ${describeAge(fetchedAt ? Date.now() - fetchedAt : NaN)}.`;
        }
    }
    const note = document.getElementById('planning-weather-note');
    note.classList.toggle('hidden', !noteText);
    note.classList.toggle('is-error', avail.kind === 'failed' || !!avail.stale);
    document.getElementById('planning-weather-note-text').textContent = noteText;
    document.getElementById('planning-weather-retry').classList.toggle('hidden', !(noteText && (avail.kind === 'failed' || avail.stale)));

    // Holiday + candle-lighting for the selected day (the calendar cells
    // are too small on phones to show them).
    const holidayLine = document.getElementById('planning-holiday');
    const holidayInfo = prefs.hebrewCalendarEnabled ? getHolidayInfo(selectedDate, location) : undefined;
    const extra = extraCalendarNotes(selectedDate, prefs, location);
    const holidayText = [
        !prefs.hebrewCalendarEnabled ? '' : [
            holidayTitlesFor(selectedDate, holidayInfo).join(' / '),
            holidayInfo && holidayInfo.candleLighting ? `🕯 Candle lighting ${holidayInfo.candleLighting}` : ''
        ].filter(Boolean).join(' · '),
        extra.notes.map(n => n.text).join(' · '),
        extra.hijri ? `${extra.hijri.day} ${extra.hijri.monthName} ${extra.hijri.year} AH` : ''
    ].filter(Boolean).join('\n');          // one line per calendar
    holidayLine.textContent = holidayText;
    holidayLine.classList.toggle('hidden', !holidayText);

    renderOutfitCards(prefs, location, makeLabelOf(prefs, location));
    renderPicker();
}
