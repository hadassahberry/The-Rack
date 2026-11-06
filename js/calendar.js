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
let plannerSchedule = {};
let plannerSavedOutfits = [];

function isoDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    anchorDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    selectedDateKey = isoDateKey(today);

    document.getElementById('prev-month-btn').addEventListener('click', () => stepView(-1));
    document.getElementById('next-month-btn').addEventListener('click', () => stepView(1));
    document.getElementById('back-to-calendar-btn').addEventListener('click', () => {
        document.querySelector('.calendar-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('view-switcher').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-view]');
        if (btn) setViewMode(btn.dataset.view);
    });

    window.waitForAuth().then(initCalendarLiveData);

    renderCalendar();
});

function initCalendarLiveData() {
    Store.onClosetChange((closet) => { plannerCloset = closet; renderCalendar(); });
    Store.onScheduleChange((schedule) => { plannerSchedule = schedule; renderCalendar(); });
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

// Holidays come from Hebcal one month at a time, and a week or 2-week view
// can straddle two months — fetch each month that appears on screen.
async function refreshHolidaysForView(location) {
    if (!Store.getPrefs().hebrewCalendarEnabled) return;
    const months = new Map();
    visibleDates().forEach(d => months.set(`${d.getFullYear()}-${d.getMonth()}`, d));
    await Promise.all([...months.values()].map(d => Holidays.refresh(d.getFullYear(), d.getMonth() + 1, location)));
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

async function setViewMode(mode) {
    if (mode === viewMode || !['week', '2weeks', 'month'].includes(mode)) return;
    viewMode = mode;
    // Keep the selected day on screen when switching views.
    anchorDate = new Date(selectedDateKey + 'T00:00:00');
    renderCalendar();
    await refreshHolidaysForView(Store.getLocation());
    renderCalendar();
}

function renderCalendar() {
    renderCalendarGrid();
    renderPlanningPanel();
}

// True when the planning panel sits below the calendar instead of beside it
// (matches the 900px breakpoint in components.css).
function isStackedLayout() {
    return window.matchMedia('(max-width: 900px)').matches;
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

function renderCalendarGrid() {
    const grid = document.getElementById('month-grid');
    if (!grid) return;
    grid.innerHTML = '';
    grid.className = `month-grid view-${viewMode}`;
    // Lets CSS treat the weekday header row differently per view (phones
    // show week / 2-week views as a day-by-day list instead of a grid).
    grid.closest('.calendar-panel').dataset.view = viewMode;

    const dates = visibleDates();
    document.getElementById('month-label').textContent = viewLabel(dates);

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

    for (const cellDate of dates) {
        const dateKey = isoDateKey(cellDate);
        const isCurrentMonth = viewMode !== 'month' || cellDate.getMonth() === anchorDate.getMonth();
        const holidayInfo = prefs.hebrewCalendarEnabled ? getHolidayInfo(cellDate, location, holidayMaps) : undefined;
        const holidayTitles = prefs.hebrewCalendarEnabled ? holidayTitlesFor(cellDate, holidayInfo) : [];
        const weather = weatherMap[dateKey];
        const assignedIds = plannerSchedule[dateKey] || [];

        const cell = document.createElement('div');
        cell.className = 'month-cell';
        if (!isCurrentMonth) cell.classList.add('not-current');
        if (holidayTitles.length > 0) cell.classList.add('holiday');
        if (dateKey === selectedDateKey) cell.classList.add('selected');
        cell.addEventListener('click', () => {
            selectedDateKey = dateKey;
            renderCalendar();
            // When the planning panel is stacked below the calendar (phones,
            // small tablets), bring it into view so tapping a day visibly does something.
            if (isStackedLayout()) {
                document.querySelector('.planning-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });

        const holidayLabel = holidayTitles.length > 0
            ? `<div class="cell-holiday-label">${holidayTitles.join(' / ')}</div>` : '';
        const candleLabel = (holidayInfo && holidayInfo.candleLighting)
            ? `<div class="cell-candle-label">🕯 ${holidayInfo.candleLighting}</div>` : '';
        const weatherBadge = weather
            ? `<span class="cell-weather">${weatherInfo(weather.code).icon} ${formatTemp(weather.high)}</span>` : '';
        const itemsList = assignedIds
            .map(id => plannerCloset.find(i => i.id === id))
            .filter(Boolean)
            .map(item => `<div class="cell-item-row"><span class="color-dot" style="background:${item.color || '#ccc'}"></span>${item.name}</div>`)
            .join('');

        cell.innerHTML = `
            ${holidayLabel}
            <div class="cell-top-row">
                <span class="cell-weekday">${WEEKDAY_NAMES[cellDate.getDay()].slice(0, 3)}</span>
                <span class="cell-date-num">${cellDate.getDate()}</span>
                ${weatherBadge}
            </div>
            ${candleLabel}
            <div class="cell-items">${itemsList}</div>
        `;
        grid.appendChild(cell);
    }
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

function renderPlanningPanel() {
    const dateHeading = document.getElementById('planning-date');
    const weatherLine = document.getElementById('planning-weather');
    const itemsBox = document.getElementById('planning-items');
    const outfitsRow = document.getElementById('planning-saved-outfits');
    const catTabs = document.getElementById('planning-category-tabs');
    const pieceGrid = document.getElementById('planning-piece-grid');
    if (!dateHeading) return;

    const location = Location.get();
    const prefs = Store.getPrefs();
    const weatherMap = prefs.weatherEnabled ? Weather.getForecastMap(location) : {};
    const selectedDate = new Date(selectedDateKey + 'T00:00:00');

    dateHeading.textContent = `${WEEKDAY_NAMES[selectedDate.getDay()]}, ${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getDate()}`;

    const weather = weatherMap[selectedDateKey];
    weatherLine.textContent = weather ? `${weatherInfo(weather.code).icon} ${formatTemp(weather.high, true)} · ${weatherInfo(weather.code).label}` : '';
    weatherLine.classList.toggle('hidden', !weather);

    // Holiday + candle-lighting for the selected day (the calendar cells
    // are too small on phones to show them).
    const holidayLine = document.getElementById('planning-holiday');
    const holidayInfo = prefs.hebrewCalendarEnabled ? getHolidayInfo(selectedDate, location) : undefined;
    const holidayText = !prefs.hebrewCalendarEnabled ? '' : [
        holidayTitlesFor(selectedDate, holidayInfo).join(' / '),
        holidayInfo && holidayInfo.candleLighting ? `🕯 Candle lighting ${holidayInfo.candleLighting}` : ''
    ].filter(Boolean).join(' · ');
    holidayLine.textContent = holidayText;
    holidayLine.classList.toggle('hidden', !holidayText);

    const assignedIds = plannerSchedule[selectedDateKey] || [];
    itemsBox.innerHTML = '';
    if (assignedIds.length === 0) {
        itemsBox.innerHTML = '<p class="planning-empty">No items planned yet — add one below.</p>';
    }
    assignedIds.forEach(id => {
        const item = plannerCloset.find(i => i.id === id);
        if (!item) return;
        const gap = computeGapDays(id, selectedDateKey);
        const gapTag = (gap !== null && Math.abs(gap) <= 3)
            ? `<span class="gap-tag">${Math.abs(gap)}d gap</span>` : '';
        const row = document.createElement('div');
        row.className = 'planning-item-row';
        row.innerHTML = `
            <span class="color-dot" style="background:${item.color || '#ccc'}"></span>
            <span class="planning-item-name">${item.name}</span>
            ${gapTag}
            <button class="remove-item-btn" aria-label="Remove">&times;</button>
        `;
        row.querySelector('.remove-item-btn').addEventListener('click', () => {
            const list = (plannerSchedule[selectedDateKey] || []).filter(x => x !== id);
            Store.setScheduleDay(selectedDateKey, list).catch(console.error);
        });
        itemsBox.appendChild(row);
    });

    // Saved outfits
    outfitsRow.innerHTML = '';
    if (plannerSavedOutfits.length === 0) {
        outfitsRow.innerHTML = '<p class="planning-empty">No saved outfits yet.</p>';
    }
    plannerSavedOutfits.forEach(outfit => {
        const pill = document.createElement('button');
        pill.className = 'outfit-pill';
        pill.textContent = outfit.name;
        pill.addEventListener('click', () => {
            Store.setScheduleDay(selectedDateKey, [...outfit.itemIds]).catch(console.error);
        });
        outfitsRow.appendChild(pill);
    });

    // Add-a-single-piece category tabs
    catTabs.innerHTML = '';
    CATEGORIES.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${cat === planningActiveCategory ? 'active' : ''}`;
        btn.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
        btn.addEventListener('click', () => {
            planningActiveCategory = cat;
            renderPlanningPanel();
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
    pieces.forEach(item => {
        const isOnSelectedDay = assignedIds.includes(item.id);
        const status = anyPlannedIds.has(item.id) ? 'planned' : 'rested';
        const card = document.createElement('div');
        card.className = `piece-card ${isOnSelectedDay ? 'selected' : ''}`;
        card.innerHTML = `
            <span class="color-dot" style="background:${item.color || '#ccc'}"></span>
            <span class="piece-card-name">${item.name}</span>
            <span class="piece-card-status">${status}</span>
        `;
        card.addEventListener('click', () => {
            const list = plannerSchedule[selectedDateKey] || [];
            const next = list.includes(item.id) ? list.filter(x => x !== item.id) : [...list, item.id];
            Store.setScheduleDay(selectedDateKey, next).catch(console.error);
        });
        pieceGrid.appendChild(card);
    });
}
