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

function isoDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    anchorDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    selectedDateKey = isoDateKey(today);

    document.getElementById('prev-month-btn').addEventListener('click', () => stepView(-1));
    document.getElementById('next-month-btn').addEventListener('click', () => stepView(1));
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
        plannerSchedule = Store.flattenSchedule(byDate);
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
    if (!item.image) {
        const dot = document.createElement('span');
        dot.className = 'color-dot';
        dot.style.background = item.color || '#ccc';
        return dot;
    }
    const img = document.createElement('img');
    img.className = className;
    img.src = item.image;
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

    const box = document.createElement('div');
    box.className = showPhotos ? 'cell-items cell-groups' : 'cell-items';
    if (groups.length > 1) box.classList.add('multi');
    const limit = cellPhotoLimit();       // pieces per outfit before "+N"

    groups.forEach(group => {
        const groupEl = document.createElement('div');
        groupEl.className = 'cell-group';
        if (group.label) {
            const label = document.createElement('div');
            label.className = 'cell-group-label';
            label.textContent = group.label;
            label.title = group.label;
            groupEl.appendChild(label);
        }

        if (!showPhotos) {
            group.items.forEach(item => {
                const row = document.createElement('div');
                row.className = 'cell-item-row';
                const dot = document.createElement('span');
                dot.className = 'color-dot';
                dot.style.background = item.color || '#ccc';
                row.append(dot, document.createTextNode(item.name));
                groupEl.appendChild(row);
            });
        } else {
            const photos = document.createElement('div');
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
        }
        box.appendChild(groupEl);
    });
    return box;
}

// Clicking a day opens the planning panel (that day's outfit + the photo
// closet to pick from) as a popup over the calendar, on every screen size.
function openPlanningPopup() {
    const panel = document.querySelector('.planning-panel');
    document.body.classList.add('planning-open');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'planning-date');
    panel.scrollTop = 0;
    document.getElementById('back-to-calendar-btn').focus({ preventScroll: true });
}

function closePlanningPopup() {
    const panel = document.querySelector('.planning-panel');
    document.body.classList.remove('planning-open');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('aria-labelledby');
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
    const closetById = Object.fromEntries(plannerCloset.map(i => [i.id, i]));

    for (const cellDate of dates) {
        const dateKey = isoDateKey(cellDate);
        const isCurrentMonth = viewMode !== 'month' || cellDate.getMonth() === anchorDate.getMonth();
        const holidayInfo = prefs.hebrewCalendarEnabled ? getHolidayInfo(cellDate, location, holidayMaps) : undefined;
        const holidayTitles = prefs.hebrewCalendarEnabled ? holidayTitlesFor(cellDate, holidayInfo) : [];
        const weather = weatherMap[dateKey];

        const cell = document.createElement('div');
        cell.className = 'month-cell';
        if (!isCurrentMonth) cell.classList.add('not-current');
        if (holidayTitles.length > 0) cell.classList.add('holiday');
        if (dateKey === selectedDateKey) cell.classList.add('selected');
        cell.addEventListener('click', () => {
            selectedDateKey = dateKey;
            renderCalendar();
            openPlanningPopup();      // narrow screens: the day's closet pops up right here
        });

        const holidayLabel = holidayTitles.length > 0
            ? `<div class="cell-holiday-label">${holidayTitles.join(' / ')}</div>` : '';
        const candleLabel = (holidayInfo && holidayInfo.candleLighting)
            ? `<div class="cell-candle-label">🕯 ${holidayInfo.candleLighting}</div>` : '';
        const weatherBadge = weather
            ? `<span class="cell-weather">${weatherInfo(weather.code).icon} ${formatTemp(weather.high)}</span>` : '';
        cell.innerHTML = `
            ${holidayLabel}
            <div class="cell-top-row">
                <span class="cell-weekday">${WEEKDAY_NAMES[cellDate.getDay()].slice(0, 3)}</span>
                <span class="cell-date-num">${cellDate.getDate()}</span>
                ${weatherBadge}
            </div>
            ${candleLabel}
        `;
        // The planned pieces: little photos (Settings → Outfit photos) or names.
        // Built as elements, not HTML, so an item's name can't break the page.
        cell.appendChild(buildCellItems(plannerOutfits[dateKey] || [], closetById, prefs.showOutfitPhotos));
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
    return Store.setScheduleOutfits(dateKey, next).catch(console.error);
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

// Activities used before, most recent first (for the quick-pick chips and the typing suggestions).
function knownActivityLabels() {
    const latest = new Map();
    for (const [date, outfits] of Object.entries(plannerOutfits)) {
        for (const o of outfits) {
            const text = (o.label || '').trim();
            if (!text) continue;
            const key = normalizeActivity(text);
            const seen = latest.get(key);
            if (!seen || date > seen.date) latest.set(key, { text, date });
        }
    }
    return [...latest.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map(v => v.text);
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

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'outfit-label';
    input.maxLength = 40;
    input.value = outfit.label || '';
    input.placeholder = 'Activity (optional)';
    input.setAttribute('list', 'activity-suggestions');
    input.setAttribute('aria-label', 'Activity for this outfit');
    input.addEventListener('focus', () => setActiveOutfit(outfit.id));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    input.addEventListener('change', () => {
        let value = input.value.trim().replace(/\s+/g, ' ');
        // "class" adopts the spelling already in use ("Class") so the same activity looks the same everywhere
        const existing = knownActivityLabels().find(l => normalizeActivity(l) === normalizeActivity(value));
        if (existing) value = existing;
        updateDay(selectedDateKey, outfits => {
            const o = outfits.find(x => x.id === outfit.id);
            if (o) o.label = value;
            return outfits;
        });
    });
    head.appendChild(input);

    if (!outfit.label && autoLabel) {
        const pill = document.createElement('span');
        pill.className = 'outfit-auto-label';
        pill.textContent = `${autoLabel} (automatic)`;
        head.appendChild(pill);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'outfit-delete';
    remove.setAttribute('aria-label', 'Remove this outfit');
    remove.textContent = '🗑️';
    remove.addEventListener('click', () => {
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
                updateDay(selectedDateKey, outfits => {
                    const o = outfits.find(x => x.id === outfit.id);
                    if (o) o.label = text;
                    return outfits;
                });
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
        link.textContent = outfit.flagsOff ? 'Repeat warnings are off for this outfit — turn them back on' : 'It\'s fine — hide warnings for this outfit';
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
    const known = knownActivityLabels();
    const selectedDate = new Date(selectedDateKey + 'T00:00:00');
    const suggestions = [...known];
    if (prefs.hebrewCalendarEnabled && selectedDate.getDay() === 5 && !suggestions.some(s => normalizeActivity(s) === 'shabbos')) {
        suggestions.unshift('Shabbos');                       // Friday night is Shabbos too
    }

    const list = document.getElementById('activity-suggestions');
    if (list) {
        list.innerHTML = '';
        suggestions.forEach(text => { const o = document.createElement('option'); o.value = text; list.appendChild(o); });
    }

    box.innerHTML = '';
    if (outfits.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'planning-empty';
        empty.textContent = 'No outfit planned yet — add pieces below, or start an outfit to give it an activity.';
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

    // Saved outfits: replace the active outfit's pieces (or start a new outfit)
    outfitsRow.innerHTML = '';
    if (plannerSavedOutfits.length === 0) {
        outfitsRow.innerHTML = '<p class="planning-empty">No saved outfits yet.</p>';
    }
    plannerSavedOutfits.forEach(saved => {
        const pill = document.createElement('button');
        pill.className = 'outfit-pill';
        // a peek at the pieces, so you can tell outfits apart by sight
        sortHeadToToe(saved.itemIds.map(id => closetById[id]).filter(Boolean)).slice(0, 3)
            .forEach(item => pill.appendChild(itemThumb(item, 'outfit-pill-thumb', '')));
        const pillName = document.createElement('span');
        pillName.textContent = saved.name;
        pill.appendChild(pillName);
        pill.addEventListener('click', () => {
            if (!active) {
                const id = newOutfitId();
                activeOutfitId = id;
                updateDay(selectedDateKey, outfits => [...outfits, { id, label: '', itemIds: [...saved.itemIds], flagsOff: false }]);
                return;
            }
            updateDay(selectedDateKey, outfits => {
                const o = outfits.find(x => x.id === active.id);
                if (o) o.itemIds = [...saved.itemIds];
                return outfits;
            });
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
    pieces.forEach(item => {
        const inActive = !!active && active.itemIds.includes(item.id);
        const rep = ctx ? itemRepeat(ctx, item.id, item.category) : null;
        const status = rep ? repeatTagText(ctx, rep) : (anyPlannedIds.has(item.id) ? 'planned' : 'rested');

        const card = document.createElement('div');
        card.className = `piece-card ${inActive ? 'selected' : ''} ${rep ? 'is-repeat' : ''}`;

        // Photo first: sometimes you just want to see it. The name is underneath.
        const photoBox = document.createElement('div');
        photoBox.className = 'piece-card-photo';
        photoBox.appendChild(itemThumb(item, 'piece-card-img', ''));
        if (inActive) {
            const check = document.createElement('span');
            check.className = 'piece-check';
            check.textContent = '✓';
            photoBox.appendChild(check);
        }
        const name = document.createElement('span');
        name.className = 'piece-card-name';
        name.textContent = item.name;
        const st = document.createElement('span');
        st.className = 'piece-card-status';
        st.textContent = status;
        card.title = item.name;
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

    renderOutfitCards(prefs, location, makeLabelOf(prefs, location));
    renderPicker();
}
