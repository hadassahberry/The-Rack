const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let viewYear, viewMonthJs; // viewMonthJs is 0-indexed (JS Date convention)
let selectedDateKey;
let planningActiveCategory = 'tops';

function isoDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    viewYear = today.getFullYear();
    viewMonthJs = today.getMonth();
    selectedDateKey = isoDateKey(today);

    const location = Location.get();
    document.getElementById('city-input').value = formatLocationLabel(location);

    document.getElementById('prev-month-btn').addEventListener('click', () => changeMonth(-1));
    document.getElementById('next-month-btn').addEventListener('click', () => changeMonth(1));

    const cityInput = document.getElementById('city-input');
    cityInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); cityInput.blur(); }
    });
    cityInput.addEventListener('blur', async () => {
        const value = cityInput.value.trim();
        if (!value) return;
        const resolved = await Location.searchCity(value);
        if (!resolved) return;
        cityInput.value = formatLocationLabel(resolved);
        await refreshLocationData(resolved);
    });

    ['rack:closet-changed', 'rack:schedule-changed', 'rack:outfits-changed'].forEach(evt => {
        window.addEventListener(evt, renderCalendar);
    });

    renderCalendar();
});

function formatLocationLabel(location) {
    if (!location) return '';
    return location.region ? `${location.city}, ${location.region}` : location.city;
}

async function refreshLocationData(location) {
    await Weather.refresh(location);
    const withTzid = Store.getLocation() || location;
    await Holidays.refresh(viewYear, viewMonthJs + 1, withTzid);
    renderCalendar();
}

async function changeMonth(delta) {
    viewMonthJs += delta;
    if (viewMonthJs < 0) { viewMonthJs = 11; viewYear--; }
    if (viewMonthJs > 11) { viewMonthJs = 0; viewYear++; }
    renderCalendar();
    await Holidays.refresh(viewYear, viewMonthJs + 1, Store.getLocation());
    renderCalendar();
}

function renderCalendar() {
    renderMonthGrid();
    renderPlanningPanel();
}

function renderMonthGrid() {
    const grid = document.getElementById('month-grid');
    if (!grid) return;
    grid.innerHTML = '';

    document.getElementById('month-label').textContent = `${MONTH_NAMES[viewMonthJs]} ${viewYear}`;

    const closet = Store.getCloset();
    const schedule = Store.getSchedule();
    const location = Location.get();
    const weatherMap = Weather.getForecastMap(location);
    const holidaysMap = Holidays.getMap(viewYear, viewMonthJs + 1, location);

    const firstOfMonth = new Date(viewYear, viewMonthJs, 1);
    const startDay = firstOfMonth.getDay();
    const daysInMonth = new Date(viewYear, viewMonthJs + 1, 0).getDate();
    const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
        const cellDate = new Date(viewYear, viewMonthJs, 1 + (i - startDay));
        const dateKey = isoDateKey(cellDate);
        const isCurrentMonth = cellDate.getMonth() === viewMonthJs;
        const isShabbat = cellDate.getDay() === 6;
        const holidayInfo = holidaysMap[dateKey];
        const holidayTitles = [
            ...(isShabbat ? ['Shabbos'] : []),
            ...((holidayInfo && holidayInfo.holidays) ? holidayInfo.holidays.map(h => h.title) : [])
        ];
        const weather = weatherMap[dateKey];
        const assignedIds = schedule[dateKey] || [];

        const cell = document.createElement('div');
        cell.className = 'month-cell';
        if (!isCurrentMonth) cell.classList.add('not-current');
        if (holidayTitles.length > 0) cell.classList.add('holiday');
        if (dateKey === selectedDateKey) cell.classList.add('selected');
        cell.addEventListener('click', () => {
            selectedDateKey = dateKey;
            renderCalendar();
        });

        const holidayLabel = holidayTitles.length > 0
            ? `<div class="cell-holiday-label">${holidayTitles.join(' / ')}</div>` : '';
        const candleLabel = (holidayInfo && holidayInfo.candleLighting)
            ? `<div class="cell-candle-label">🕯 ${holidayInfo.candleLighting}</div>` : '';
        const weatherBadge = weather
            ? `<span class="cell-weather">${weatherInfo(weather.code).icon} ${weather.high}°</span>` : '';
        const itemsList = assignedIds
            .map(id => closet.find(i => i.id === id))
            .filter(Boolean)
            .map(item => `<div class="cell-item-row"><span class="color-dot" style="background:${item.color || '#ccc'}"></span>${item.name}</div>`)
            .join('');

        cell.innerHTML = `
            ${holidayLabel}
            <div class="cell-top-row">
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
    const schedule = Store.getSchedule();
    const selected = new Date(excludeDateKey);
    let nearest = null;

    Object.keys(schedule).forEach(dateKey => {
        if (dateKey === excludeDateKey) return;
        if (!schedule[dateKey].includes(itemId)) return;
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

    const closet = Store.getCloset();
    const schedule = Store.getSchedule();
    const location = Location.get();
    const weatherMap = Weather.getForecastMap(location);
    const selectedDate = new Date(selectedDateKey + 'T00:00:00');

    dateHeading.textContent = `${WEEKDAY_NAMES[selectedDate.getDay()]}, ${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getDate()}`;

    const weather = weatherMap[selectedDateKey];
    weatherLine.textContent = weather ? `${weatherInfo(weather.code).icon} ${weather.high}° · ${weatherInfo(weather.code).label}` : '';
    weatherLine.classList.toggle('hidden', !weather);

    const assignedIds = schedule[selectedDateKey] || [];
    itemsBox.innerHTML = '';
    if (assignedIds.length === 0) {
        itemsBox.innerHTML = '<p class="planning-empty">No items planned yet — add one below.</p>';
    }
    assignedIds.forEach(id => {
        const item = closet.find(i => i.id === id);
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
            let s = Store.getSchedule();
            s[selectedDateKey] = (s[selectedDateKey] || []).filter(x => x !== id);
            if (s[selectedDateKey].length === 0) delete s[selectedDateKey];
            Store.saveSchedule(s);
            renderCalendar();
        });
        itemsBox.appendChild(row);
    });

    // Saved outfits
    outfitsRow.innerHTML = '';
    const outfits = Store.getSavedOutfits();
    if (outfits.length === 0) {
        outfitsRow.innerHTML = '<p class="planning-empty">No saved outfits yet.</p>';
    }
    outfits.forEach(outfit => {
        const pill = document.createElement('button');
        pill.className = 'outfit-pill';
        pill.textContent = outfit.name;
        pill.addEventListener('click', () => {
            let s = Store.getSchedule();
            s[selectedDateKey] = [...outfit.itemIds];
            Store.saveSchedule(s);
            renderCalendar();
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
    const anyPlannedIds = new Set(Object.values(schedule).flat());
    const pieces = closet.filter(i => i.category === planningActiveCategory);
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
            let s = Store.getSchedule();
            const list = s[selectedDateKey] || [];
            if (list.includes(item.id)) {
                s[selectedDateKey] = list.filter(x => x !== item.id);
                if (s[selectedDateKey].length === 0) delete s[selectedDateKey];
            } else {
                s[selectedDateKey] = [...list, item.id];
            }
            Store.saveSchedule(s);
            renderCalendar();
        });
        pieceGrid.appendChild(card);
    });
}
