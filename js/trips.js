// Trips: the Trips tab, the trip form, the destination's weather and the packing checklist. The rules (validation, which
// weather a day uses, how the checklist is worked out) are in js/trip-logic.js and tested there.
//
//   - A trip's days are planned in the ordinary Planner (and with Help me choose). Nothing about planning is copied or
//     stored a second time: the days list and the checklist are read from the planner every time they are drawn, so they
//     are always in step with it.
//   - The destination's forecast is fetched here, on its own, and kept per trip. It deliberately does NOT use Weather.refresh
//     (js/weather.js): that saves the place it is given as the person's HOME location. Nothing in this file reads or writes
//     the home location, and a trip day never falls back to the home forecast.
//   - Only what is ticked on a checklist is saved (users/{uid}/trips/{id}.packed, by piece id).

const Trips = (function () {
    const $ = (id) => document.getElementById(id);
    const state = {
        trips: [], selectedId: null,
        forecasts: {}, statuses: {}, fetchedAt: {}, inFlight: {},      // per trip id: the destination forecast, how the last request went, when, and a request under way
        overrides: {},                                                  // 'tripId:pieceId' -> ticked (shown at once, until the save is confirmed)
        editingId: null, chosen: null, places: [], searching: false, saving: false,
        noticeTripId: null                                              // the trip just saved over days that already had plans: only that trip shows the notice
    };
    const WEATHER_STALE_MS = 3 * 60 * 60 * 1000;                       // a forecast younger than this is not asked for again
    const CATEGORY_LABELS = { outerwear: 'Outerwear', tops: 'Tops', dresses: 'Dresses', bottoms: 'Bottoms', shoes: 'Shoes', accessories: 'Accessories' };
    const todayKey = () => isoDateKey(new Date());
    const announce = (text) => { const a = $('app-announcer'); if (a) a.textContent = text; };
    const weatherOn = () => !!Store.getPrefs().weatherEnabled;
    const selected = () => state.trips.find(t => t.id === state.selectedId) || null;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

    // ---- the destination's weather ----
    function cacheKey(trip) { return 'tripwx_' + trip.id; }
    function loadCachedWeather(trip) {
        const c = Store.getCache(cacheKey(trip));
        if (c && c.lat === trip.destination.latitude && c.lon === trip.destination.longitude && c.map) {       // only for the SAME place
            state.forecasts[trip.id] = c.map;
            state.fetchedAt[trip.id] = c.fetchedAt || null;
        } else { delete state.forecasts[trip.id]; delete state.fetchedAt[trip.id]; }
    }
    // Only trips whose days the forecast could reach are asked about (today through 16 days ahead, plus a day for time zones).
    const reachable = (trip) => trip.end >= todayKey() && tripDaysBetween(todayKey(), trip.start) <= 17;

    async function refreshWeather(trip, { force = false } = {}) {
        if (!weatherOn() || !reachable(trip) || state.inFlight[trip.id]) return;
        const at = state.fetchedAt[trip.id];
        if (!force && at && Date.now() - at < WEATHER_STALE_MS && state.forecasts[trip.id]) return;
        state.inFlight[trip.id] = true;
        state.statuses[trip.id] = 'loading';
        document.dispatchEvent(new Event('trip-weather'));
        const { latitude, longitude } = trip.destination;
        try {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,weathercode&temperature_unit=fahrenheit&timezone=auto&forecast_days=16`);
            if (!res.ok) throw new Error('Weather request failed (' + res.status + ')');
            const map = parseTripForecast(await res.json());
            state.forecasts[trip.id] = map;
            state.fetchedAt[trip.id] = Date.now();
            try { Store.saveCache(cacheKey(trip), { lat: latitude, lon: longitude, map, fetchedAt: state.fetchedAt[trip.id] }); } catch (e) { /* storage full: fine */ }
            state.statuses[trip.id] = 'ok';
        } catch (err) {
            console.warn('The trip forecast could not be loaded:', err && err.message);
            state.statuses[trip.id] = 'failed';              // whatever was saved before stays, marked as not refreshed
        }
        delete state.inFlight[trip.id];
        document.dispatchEvent(new Event('trip-weather'));
    }
    function refreshAllWeather() { state.trips.forEach(t => refreshWeather(t)); }

    // { trip, avail, forecast } for one date of a trip, from the destination only.
    function weatherFor(trip, dateKey) {
        const map = state.forecasts[trip.id] || {};
        const avail = tripWeatherAvailability({ dateKey, todayKey: todayKey(), forecastMap: map, status: state.statuses[trip.id] || 'idle', weatherEnabled: weatherOn(), destinationName: trip.destination.name });
        return { trip, avail, forecast: avail.kind === 'available' ? map[dateKey] : null };
    }

    // ---- data ----
    function setTrips(trips, { fromServer = false } = {}) {
        state.trips = trips;
        if (fromServer) Store.saveTripsLocal(trips);
        trips.forEach(t => { if (!(t.id in state.forecasts)) loadCachedWeather(t); });
        if (!selected()) state.selectedId = trips.length ? (trips.find(t => t.end >= todayKey()) || trips[0]).id : null;
        document.dispatchEvent(new Event('trips-changed'));       // the calendar redraws (which days are away, and their weather)
        render();
        refreshAllWeather();
    }

    // ---- drawing ----
    function render() {
        if (!$('trips-view')) return;
        renderNotice();
        renderList();
        renderDetail();
    }

    // The "these days already had outfits" notice. Never stored text: it is recomputed from the SELECTED trip and the CURRENT plans
    // on every draw (after a plan changes, a trip is picked or deleted), so it can't outlive what it says. It is empty, and hidden,
    // when no trip is selected, when none remain, when the selected trip isn't the one just saved, and when the plans are gone.
    function renderNotice() {
        const note = $('trip-notice');
        if (!note) return;
        const trip = selected();
        const text = trip && trip.id === state.noticeTripId && dataReady() ? tripPlansNotice(trip, plannerOutfits) : '';
        note.textContent = text;
        note.classList.toggle('hidden', !text);
    }

    function renderList() {
        const list = $('trips-list');
        list.innerHTML = '';
        $('trips-empty').classList.toggle('hidden', state.trips.length > 0);
        state.trips.forEach(trip => {
            const card = el('button', 'trip-card' + (trip.id === state.selectedId ? ' selected' : ''));
            card.type = 'button';
            card.setAttribute('aria-pressed', String(trip.id === state.selectedId));
            card.dataset.tripId = trip.id;
            const plan = packingFor(trip);
            card.append(
                el('span', 'trip-card-title', tripTitle(trip)),
                el('span', 'trip-card-sub', `${trip.destination.label} · ${tripRangeLabel(trip.start, trip.end, todayKey())}`),
                el('span', 'trip-card-sub', plan.total ? `${plan.packed} of ${plan.total} ${plan.total === 1 ? 'piece' : 'pieces'} packed` : 'No outfits planned yet')
            );
            card.addEventListener('click', () => { state.selectedId = trip.id; render(); refreshWeather(trip); });
            list.appendChild(card);
        });
    }

    const dataReady = () => (typeof closetLoaded === 'undefined' || closetLoaded) && (typeof plannerLoaded === 'undefined' || plannerLoaded);
    function packedFor(trip) {
        const state_ = { ...trip.packed };
        Object.keys(state.overrides).forEach(k => { if (k.startsWith(trip.id + ':')) state_[k.slice(trip.id.length + 1)] = state.overrides[k]; });
        return state_;
    }
    function packingFor(trip) { return buildPackingList({ trip, outfitsByDate: plannerOutfits, closet: plannerCloset, packed: packedFor(trip) }); }

    function renderDetail() {
        const trip = selected();
        $('trip-detail').classList.toggle('hidden', !trip);
        if (!trip) {                                      // nothing selected (or none left): nothing from a trip that is gone is kept anywhere
            $('trip-days').innerHTML = '';
            $('trip-pack-list').innerHTML = '';
            $('trip-pack-summary').textContent = '';
            return;
        }
        $('trip-detail-title').textContent = tripTitle(trip);
        $('trip-detail-sub').textContent = `${trip.destination.label} · ${tripRangeLabel(trip.start, trip.end, todayKey())}`;

        // where the weather comes from, always said
        const src = $('trip-weather-source');
        src.textContent = weatherOn()
            ? `Weather for each day is the forecast for ${trip.destination.label} (from Open-Meteo), never your home location.`
            : 'Weather is switched off in Settings, so no forecast is shown for this trip.';
        const failed = weatherOn() && state.statuses[trip.id] === 'failed';
        $('trip-weather-retry-btn').classList.toggle('hidden', !failed);

        // the days
        const days = $('trip-days');
        days.innerHTML = '';
        const ready = dataReady();
        tripDaySummaries({ trip, outfitsByDate: plannerOutfits, closet: plannerCloset }).forEach(day => {
            const row = el('div', 'trip-day');
            row.appendChild(el('strong', 'trip-day-date', day.label));
            const w = weatherFor(trip, day.date);
            const wtext = el('span', 'trip-day-weather' + (w.forecast ? '' : ' is-missing'));
            if (w.forecast) wtext.textContent = `${weatherInfo(w.forecast.code).icon} ${formatTemp(w.forecast.high, true)} / ${formatTemp(w.forecast.low)} · ${weatherInfo(w.forecast.code).label}`;
            else wtext.textContent = w.avail.text;
            row.appendChild(wtext);
            if (w.avail.detail) row.appendChild(el('span', 'trip-day-detail', w.avail.detail));
            const plan = el('span', 'trip-day-plan');
            if (!ready) plan.textContent = 'Loading your plans…';
            else if (day.outfits.length === 0) plan.textContent = 'Nothing planned yet';
            else plan.textContent = day.outfits.map(o => (o.label ? `${o.label}: ` : '') + o.pieces.join(', ')).join('  ·  ');
            row.appendChild(plan);
            const btn = el('button', 'secondary-btn trip-plan-btn', day.outfits.length ? 'Open this day' : 'Plan this day');
            btn.type = 'button';
            btn.setAttribute('aria-label', `${day.outfits.length ? 'Open' : 'Plan'} ${day.label} in the Planner`);
            btn.addEventListener('click', () => planDay(day.date));
            row.appendChild(btn);
            days.appendChild(row);
        });

        // the packing checklist
        const plan = packingFor(trip);
        const box = $('trip-pack-list');
        box.innerHTML = '';
        $('trip-pack-summary').textContent = !ready ? 'Loading your closet and plans…'
            : plan.total === 0 ? 'Nothing to pack yet. Plan outfits on this trip’s days (use Plan this day, and Help me choose if you like) and the pieces appear here.'
            : `${plan.packed} of ${plan.total} ${plan.total === 1 ? 'piece' : 'pieces'} packed. Each piece is listed once, with every day it is used.`;
        plan.groups.forEach(group => {
            const h = el('h4', 'trip-pack-group', CATEGORY_LABELS[group.category] || group.category);
            const ul = el('ul', 'trip-pack-items');
            ul.setAttribute('aria-label', CATEGORY_LABELS[group.category] || group.category);
            group.items.forEach(item => {
                const piece = plannerCloset.find(p => p.id === item.id);
                const li = el('li', 'trip-pack-item' + (item.checked ? ' is-packed' : ''));
                const label = el('label', 'trip-pack-label');
                const box_ = document.createElement('input');
                box_.type = 'checkbox';
                box_.checked = item.checked;
                box_.dataset.pieceId = item.id;
                box_.setAttribute('aria-label', `${item.name}, used ${item.datesText}`);
                box_.addEventListener('change', () => togglePacked(trip, item.id, box_.checked));
                label.appendChild(box_);
                if (piece) label.appendChild(itemThumb(piece, 'trip-pack-thumb', ''));
                const text = el('span', 'trip-pack-text');
                const nameLine = el('span', 'trip-pack-name', item.name);
                if (piece && piece.demo === true) nameLine.appendChild(demoBadge());
                text.append(nameLine, el('span', 'trip-pack-dates', `Used ${item.datesText}`));
                label.appendChild(text);
                li.appendChild(label);
                ul.appendChild(li);
            });
            box.append(h, ul);
        });
    }

    function planDay(dateKey) {
        const tab = document.querySelector('.nav-btn[data-tab="calendar-view"]');
        if (tab) tab.click();
        openDayForPlanning(dateKey);            // the ordinary planning window: Help me choose in it uses this trip's weather
    }

    // ---- ticking pieces off ----
    let packSaves = null, packStatus = null;
    async function togglePacked(trip, pieceId, checked) {
        const key = trip.id + ':' + pieceId;
        state.overrides[key] = checked;                                 // shown at once
        renderList(); updateSummaryOnly();
        const ok = await packSaves.run('pack:' + key, () => Store.setTripPacked(trip.id, pieceId, checked), { onFail: (e) => console.error('Saving the checklist failed', e) });
        if (ok && state.overrides[key] === checked) delete state.overrides[key];     // the saved copy now says the same
        render();
    }
    function updateSummaryOnly() {
        const trip = selected(); if (!trip) return;
        const plan = packingFor(trip);
        $('trip-pack-summary').textContent = `${plan.packed} of ${plan.total} ${plan.total === 1 ? 'piece' : 'pieces'} packed. Each piece is listed once, with every day it is used.`;
    }

    // ---- the trip form ----
    const modalOpen = () => !$('trip-modal').classList.contains('hidden');
    function setDestStatus(text) { $('trip-dest-status').textContent = text; }
    function showErrors(messages) {
        const box = $('trip-errors');
        box.innerHTML = '';
        messages.forEach(m => { const p = el('span', 'trip-error-line', m); box.appendChild(p); });
        box.classList.toggle('hidden', messages.length === 0);
    }
    function showChosen() {
        const c = state.chosen;
        $('trip-dest-chosen').textContent = c ? `Destination: ${c.label}` : 'No destination chosen yet.';
        $('trip-dest-chosen').classList.toggle('is-set', !!c);
    }
    function openForm(trip) {
        state.editingId = trip ? trip.id : null;
        state.chosen = trip ? { ...trip.destination } : null;
        state.places = [];
        $('trip-modal-title').textContent = trip ? 'Edit trip' : 'Add a trip';
        $('trip-name').value = trip ? trip.name : '';
        $('trip-dest-input').value = trip ? trip.destination.name : '';
        $('trip-start').value = trip ? trip.start : '';
        $('trip-end').value = trip ? trip.end : '';
        $('trip-dest-results').classList.add('hidden');
        $('trip-dest-options').innerHTML = '';
        setDestStatus('');
        showChosen();
        showErrors([]);
        $('trip-save-btn').disabled = false;
        $('trip-modal').classList.remove('hidden');
        ModalDialogs.open($('trip-modal'), { initialFocus: $('trip-dest-input'), returnTo: () => $('trip-add-btn') });
    }
    function closeForm() {
        if (!modalOpen() || state.saving) return;
        $('trip-modal').classList.add('hidden');
        ModalDialogs.close($('trip-modal'));
    }

    // "Paris" -> every matching place, each labeled so two of the same name can be told apart. Nothing is guessed: with more
    // than one match the person must choose; a single match is shown in full and still has to be confirmed by saving.
    async function searchPlaces() {
        const q = $('trip-dest-input').value.trim();
        if (state.searching) return;
        if (q.length < 2) { setDestStatus('Type at least two letters of the place, then press Search.'); return; }
        state.searching = true;
        $('trip-dest-search-btn').disabled = true;
        setDestStatus('Searching…');
        $('trip-dest-results').classList.add('hidden');
        try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en&format=json`);
            if (!res.ok) throw new Error('Place search failed (' + res.status + ')');
            state.places = disambiguatePlaces(normalizeGeoResults(await res.json()));
        } catch (e) {
            state.places = [];
            setDestStatus('Couldn’t search for places. Check your connection and try again.');
            state.searching = false; $('trip-dest-search-btn').disabled = false;
            return;
        }
        state.searching = false;
        $('trip-dest-search-btn').disabled = false;
        renderPlaces(q);
    }
    function renderPlaces(q) {
        const box = $('trip-dest-options');
        box.innerHTML = '';
        if (state.places.length === 0) {
            $('trip-dest-results').classList.add('hidden');
            setDestStatus(`No place found for “${q}”. Check the spelling, or try a larger place nearby.`);
            return;
        }
        state.places.forEach((p, i) => {
            const label = el('label', 'trip-place');
            const radio = document.createElement('input');
            radio.type = 'radio'; radio.name = 'trip-place'; radio.value = String(i);
            radio.addEventListener('change', () => { state.chosen = destinationFromPlace(p); showChosen(); showErrors([]); });
            const text = el('span', 'trip-place-text');
            text.append(el('span', 'trip-place-label', p.label));
            if (p.population) text.append(el('span', 'trip-place-detail', `population ${p.population.toLocaleString('en-US')}`));
            label.append(radio, text);
            box.appendChild(label);
        });
        $('trip-dest-results').classList.remove('hidden');
        if (state.places.length === 1) {
            box.querySelector('input').checked = true;
            state.chosen = destinationFromPlace(state.places[0]);
            showChosen();
            setDestStatus('Found one place. Check it is the right one before saving.');
        } else {
            state.chosen = null;
            showChosen();
            setDestStatus(`${state.places.length} places match “${q}”. Choose the right one.`);
        }
    }

    async function saveForm() {
        if (state.saving) return;
        const editing = state.trips.find(t => t.id === state.editingId) || null;
        const start = $('trip-start').value, end = $('trip-end').value;
        const verdict = validateTrip({
            destination: state.chosen, start, end, todayKey: todayKey(), existingTrips: state.trips, ignoreId: state.editingId,
            allowPast: !!editing && editing.end < todayKey()
        });
        showErrors(verdict.messages);
        if (!verdict.ok) {
            const field = verdict.errors.destination ? 'trip-dest-input' : (verdict.errors.start || verdict.errors.dates) ? 'trip-start' : 'trip-end';
            $(field).focus();
            return;
        }
        const trip = {
            id: editing ? editing.id : 'trip_' + Date.now() + Math.random().toString(36).slice(2, 6),
            name: $('trip-name').value.trim().slice(0, 60),
            destination: state.chosen, start, end,
            packed: editing ? editing.packed : {},
            createdAt: editing ? editing.createdAt : Date.now()
        };
        state.saving = true;
        $('trip-save-btn').disabled = true;
        try {
            await Store.saveTrip(trip);
        } catch (e) {
            console.error('Saving the trip failed', e);
            state.saving = false;
            $('trip-save-btn').disabled = false;
            showErrors(['Couldn’t save the trip. Check your connection and try again. Nothing you entered was lost.']);
            return;
        }
        state.saving = false;
        state.selectedId = trip.id;
        closeForm();
        const planned = tripDates(start, end).filter(d => ((typeof plannerOutfits !== 'undefined' && plannerOutfits[d]) || []).some(o => o.itemIds.length > 0)).length;
        announce(`Trip saved.${planned ? ` ${planned === 1 ? 'One of its days already has' : planned + ' of its days already have'} outfits planned, so those pieces are on the packing list.` : ''}`);
        state.noticeTripId = planned ? trip.id : null;           // the notice itself is drawn (and kept up to date) by renderNotice
        render();
        if (editing && (editing.destination.latitude !== trip.destination.latitude || editing.destination.longitude !== trip.destination.longitude)) { delete state.forecasts[trip.id]; delete state.fetchedAt[trip.id]; delete state.statuses[trip.id]; }
    }

    async function deleteTripAsked() {
        const trip = selected();
        if (!trip) return;
        const sure = await confirmDialog({
            title: `Delete “${tripTitle(trip)}”?`,
            message: 'The trip, its saved ticks and its weather are removed. Outfits you planned on its days stay in the Planner, and your pieces are not touched.',
            confirmLabel: 'Delete trip'
        });
        if (!sure) return;
        try {
            await Store.deleteTrip(trip.id);
            Object.keys(state.overrides).filter(k => k.startsWith(trip.id + ':')).forEach(k => delete state.overrides[k]);
            delete state.forecasts[trip.id]; delete state.statuses[trip.id]; delete state.fetchedAt[trip.id];
            if (state.selectedId === trip.id) state.selectedId = null;
            if (state.noticeTripId === trip.id) state.noticeTripId = null;
            state.trips = state.trips.filter(t => t.id !== trip.id);          // gone from the screen now, not only when the server's answer arrives
            if (!selected()) state.selectedId = state.trips.length ? (state.trips.find(t => t.end >= todayKey()) || state.trips[0]).id : null;
            document.dispatchEvent(new Event('trips-changed'));       // the calendar stops marking its days at once
            render();
            announce('Trip deleted.');
        } catch (e) {
            console.error('Deleting the trip failed', e);
            await confirmDialog({ title: 'Couldn’t delete the trip', message: 'Something went wrong. Please try again.', confirmLabel: 'OK', cancelLabel: '', danger: false });
        }
    }

    // ---- wiring ----
    function init() {
        if (!$('trips-view')) return;
        packStatus = createSaveStatusView($('trip-pack-status'), { onRetry: () => packSaves.retryFailed() });
        packSaves = createSaveTracker({ onChange: (s) => packStatus.render(s) });
        warnBeforeLeavingWhileSaving(packSaves);
        $('trip-add-btn').addEventListener('click', () => openForm(null));
        $('trip-edit-btn').addEventListener('click', () => { const t = selected(); if (t) openForm(t); });
        $('trip-delete-btn').addEventListener('click', deleteTripAsked);
        $('trip-weather-retry-btn').addEventListener('click', () => { const t = selected(); if (t) refreshWeather(t, { force: true }); });
        $('trip-dest-search-btn').addEventListener('click', searchPlaces);
        $('trip-dest-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchPlaces(); } });
        $('trip-save-btn').addEventListener('click', saveForm);
        $('trip-cancel-btn').addEventListener('click', closeForm);
        $('trip-close-btn').addEventListener('click', closeForm);
        closeOnBackdrop($('trip-modal'), closeForm);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOpen() && ModalDialogs.isOpen($('trip-modal'))) closeForm(); });
        document.querySelectorAll('.nav-btn').forEach(b => { if (b.dataset.tab === 'trips-view') b.addEventListener('click', () => { render(); refreshAllWeather(); }); });
        document.addEventListener('trip-weather', render);
        window.waitForAuth().then(() => {
            setTrips(Store.getTripsLocal());                    // the first paint: the trips this device last saw for this account
            Store.onTripsChange((trips) => setTrips(trips, { fromServer: true }));
        });
    }
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

    return {
        list: () => state.trips, setTrips, weatherFor, refreshWeather, refreshView: render,
        forecastFor: (tripId) => state.forecasts[tripId] || {}
    };
})();

// ---- what the Planner and Help me choose use (js/calendar.js, js/help-choose.js) ----
// The trip a date belongs to, or null.
function tripForDate(dateKey) {
    return tripOnDate(Trips.list(), dateKey);
}
// The weather for a date that is part of a trip: { trip, avail, forecast } from the DESTINATION only. null for any other date.
function tripWeatherFor(dateKey) {
    const trip = tripForDate(dateKey);
    return trip ? Trips.weatherFor(trip, dateKey) : null;
}
