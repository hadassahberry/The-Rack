// The Settings page: location, weather on/off, Hebrew calendar on/off, account.
// js/app.js applies changes (fetching or dropping data); this file is the UI.
function setLocationField(location) {
    const input = document.getElementById('city-input');
    if (input) input.value = formatLocationLabel(location);
}

// Credit lines required by the data providers' terms; only shown for the
// sources that are switched on.
function renderCredits(prefs) {
    const el = document.getElementById('app-credits');
    if (!el) return;
    const parts = [];
    if (prefs.weatherEnabled) {
        parts.push('Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>.');
    }
    if (prefs.hebrewCalendarEnabled) {
        parts.push('Jewish holidays and candle-lighting times are provided by ' +
            '<a href="https://www.hebcal.com/" target="_blank" rel="noopener">Hebcal.com</a> with a ' +
            '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0 International License</a>.');
    }
    if (prefs.publicHolidays) {
        parts.push('Public holidays from <a href="https://date.nager.at/" target="_blank" rel="noopener">Nager.Date</a>.');
    }
    el.innerHTML = parts.join(' ');          // fixed strings above, no user input
    el.classList.toggle('hidden', parts.length === 0);
}

function syncSettingsUI(prefs) {
    const $ = (id) => document.getElementById(id);
    $('pref-weather').checked = prefs.weatherEnabled;
    $('pref-hebrew').checked = prefs.hebrewCalendarEnabled;
    $('pref-temp').value = prefs.tempUnit;
    $('pref-weekstart').value = prefs.weekStart;
    $('pref-photos').checked = prefs.showOutfitPhotos;

    // The other calendars. Public holidays follow the location's country.
    $('pref-public').checked = prefs.publicHolidays;
    $('pref-christian').checked = prefs.christianHolidays;
    $('pref-christian-style').value = prefs.christianStyle;
    $('pref-christian-style').disabled = !prefs.christianHolidays;
    $('pref-hijri').checked = prefs.hijriCalendar;
    const country = publicHolidayCountry(Location.get());
    $('public-hint').textContent = country
        ? `Days off for ${countryName(country)}, based on your location.`
        : 'Set your location below and your country\'s days off will appear.';
    if (!hijriSupported()) {
        $('pref-hijri').disabled = true;
        $('hijri-hint').textContent = 'This browser can\'t show the Hijri calendar. Try updating it.';
    }

    // Say what "Automatic" currently means for the chosen location; units only matter with the weather on.
    $('pref-temp').options[0].textContent = `Automatic (${usesFahrenheit(Location.get()) ? '°F' : '°C'} here)`;
    $('pref-temp').disabled = !prefs.weatherEnabled;

    // Nothing Jewish is mentioned unless the Hebrew calendar is on.
    $('repeat-jewish-note').textContent = prefs.hebrewCalendarEnabled
        ? ' Shabbos and Yom Tov count as activities automatically.' : '';

    // Repeat warnings: the details only matter while the switch is on.
    $('pref-repeat').checked = prefs.repeatWarnings;
    $('pref-lookback').value = String(prefs.repeatLookBack);
    $('pref-lookback').disabled = !prefs.repeatWarnings;
    document.querySelectorAll('#repeat-categories input').forEach(box => {
        box.checked = prefs.repeatCategories.includes(box.value);
        box.disabled = !prefs.repeatWarnings;
    });
    $('repeat-categories-hint').textContent = prefs.repeatWarnings && prefs.repeatCategories.length === 0
        ? 'Nothing selected, so there are no warnings. Pick at least one.'
        : 'Only these kinds of pieces count.';

    // Location only matters to those two features.
    const uses = [];
    if (prefs.weatherEnabled) uses.push('the weather forecast');
    if (prefs.hebrewCalendarEnabled) uses.push('the Hebrew calendar (candle-lighting times)');
    if (prefs.publicHolidays) uses.push('your country\'s public holidays');
    const noneOn = uses.length === 0;
    $('location-card').classList.toggle('is-disabled', noneOn);
    $('city-input').disabled = noneOn;
    $('use-location-btn').disabled = noneOn;
    $('location-hint').textContent = noneOn
        ? 'Not needed while the weather, the Hebrew calendar and public holidays are all off. Your location isn\'t used or sent anywhere.'
        : `Used for ${uses.length > 1 ? uses.slice(0, -1).join(', ') + ' and ' + uses[uses.length - 1] : uses[0]}.`;
    renderCredits(prefs);
}

// ---- Saving feedback (js/save-state.js) ----
// Each switch saves to the account the moment it changes. One line at the top of the page says
// Saving… / Saved / Couldn’t save – try again; a failed switch is shown as the person set it and
// "try again" saves that same choice again.
const prefSaves = createSaveTracker({ onChange: (state) => { if (prefSaveView) prefSaveView.render(state); } });
warnBeforeLeavingWhileSaving(prefSaves);
let prefSaveView = null;

function savePref(patch) {
    const key = 'pref:' + Object.keys(patch).join(',');
    return prefSaves.run(key, () => Store.savePrefs(patch), {
        onFail: (err, latest) => {
            console.error('Saving a setting failed', err);
            if (latest) syncSettingsUI({ ...Store.getPrefs(), ...patch });      // keep showing what they chose
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const status = $('location-status');
    const setStatus = (text, isError = false) => {
        status.textContent = text;
        status.classList.toggle('is-error', isError);
    };

    prefSaveView = createSaveStatusView($('settings-save-status'), { onRetry: () => prefSaves.retryFailed() });
    syncSettingsUI(Store.getPrefs());
    setLocationField(Location.get());

    // Switches. The change is saved to the account; js/app.js reacts to it.
    $('pref-weather').addEventListener('change', (e) => {
        savePref({ weatherEnabled: e.target.checked });
    });
    $('pref-hebrew').addEventListener('change', (e) => {
        savePref({ hebrewCalendarEnabled: e.target.checked });
    });
    $('pref-temp').addEventListener('change', (e) => {
        savePref({ tempUnit: e.target.value });
    });
    $('pref-weekstart').addEventListener('change', (e) => {
        savePref({ weekStart: e.target.value });
    });
    $('pref-photos').addEventListener('change', (e) => {
        savePref({ showOutfitPhotos: e.target.checked });
    });
    $('pref-public').addEventListener('change', (e) => {
        savePref({ publicHolidays: e.target.checked });
    });
    $('pref-christian').addEventListener('change', (e) => {
        savePref({ christianHolidays: e.target.checked });
    });
    $('pref-christian-style').addEventListener('change', (e) => {
        savePref({ christianStyle: e.target.value });
    });
    $('pref-hijri').addEventListener('change', (e) => {
        savePref({ hijriCalendar: e.target.checked });
    });

    // Repeat warnings: switch, how many past times, and which categories count.
    $('pref-repeat').addEventListener('change', (e) => {
        savePref({ repeatWarnings: e.target.checked });
    });
    $('pref-lookback').addEventListener('change', (e) => {
        savePref({ repeatLookBack: Number(e.target.value) });
    });
    const categoryBoxes = $('repeat-categories');
    CATEGORIES.forEach(cat => {
        const label = document.createElement('label');
        label.className = 'chip-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = cat;
        const text = document.createElement('span');
        text.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
        label.append(box, text);
        categoryBoxes.appendChild(label);
    });
    categoryBoxes.addEventListener('change', () => {
        const chosen = [...categoryBoxes.querySelectorAll('input:checked')].map(b => b.value);
        savePref({ repeatCategories: chosen });
    });
    syncSettingsUI(Store.getPrefs());          // the category boxes now exist, so tick them

    // Typing a city: press Enter or click away.
    const cityInput = $('city-input');
    cityInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); cityInput.blur(); }
    });
    cityInput.addEventListener('blur', async () => {
        const value = cityInput.value.trim();
        if (!value || value === formatLocationLabel(Location.get())) { setLocationField(Location.get()); return; }
        setStatus('Looking up that city…');
        try {
            const resolved = await Location.searchCity(value);
            if (!resolved) { setStatus('Couldn\'t find that city. Try adding the state or country.', true); return; }
            setLocationField(resolved);
            await refreshLocationData(resolved);
            syncSettingsUI(Store.getPrefs());          // "Automatic" may now mean °C instead of °F
            setStatus(`Location set to ${formatLocationLabel(resolved)}.`);
        } catch (err) {
            setStatus('Couldn\'t look that up right now. Please try again.', true);
        }
    });

    // Re-detect from the device.
    $('use-location-btn').addEventListener('click', async () => {
        setStatus('Finding your location…');
        const found = await Location.detect();
        if (!found) { setStatus('Couldn\'t get your location. Allow location access for this site, or type a city instead.', true); return; }
        setLocationField(found);
        await refreshLocationData(found);
        syncSettingsUI(Store.getPrefs());
        setStatus(`Location set to ${formatLocationLabel(Location.get())}.`);
    });
});
