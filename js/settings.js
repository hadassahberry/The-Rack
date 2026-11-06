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
    el.innerHTML = parts.join(' ');          // fixed strings above, no user input
    el.classList.toggle('hidden', parts.length === 0);
}

function syncSettingsUI(prefs) {
    const $ = (id) => document.getElementById(id);
    $('pref-weather').checked = prefs.weatherEnabled;
    $('pref-hebrew').checked = prefs.hebrewCalendarEnabled;
    $('pref-temp').value = prefs.tempUnit;
    $('pref-weekstart').value = prefs.weekStart;

    // Say what "Automatic" currently means for the chosen location; units only matter with the weather on.
    $('pref-temp').options[0].textContent = `Automatic (${usesFahrenheit(Location.get()) ? '°F' : '°C'} here)`;
    $('pref-temp').disabled = !prefs.weatherEnabled;

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
    const noneOn = !prefs.weatherEnabled && !prefs.hebrewCalendarEnabled;
    $('location-card').classList.toggle('is-disabled', noneOn);
    $('city-input').disabled = noneOn;
    $('use-location-btn').disabled = noneOn;
    $('location-hint').textContent = noneOn
        ? 'Not needed while the weather and the Hebrew calendar are both off. Your location isn\'t used or sent anywhere.'
        : 'Used for the weather forecast and the Hebrew calendar (candle-lighting times).';
    renderCredits(prefs);
}

document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const status = $('location-status');
    const setStatus = (text, isError = false) => {
        status.textContent = text;
        status.classList.toggle('is-error', isError);
    };

    syncSettingsUI(Store.getPrefs());
    setLocationField(Location.get());

    // Switches. The change is saved to the account; js/app.js reacts to it.
    $('pref-weather').addEventListener('change', (e) => {
        Store.savePrefs({ weatherEnabled: e.target.checked }).catch(console.error);
    });
    $('pref-hebrew').addEventListener('change', (e) => {
        Store.savePrefs({ hebrewCalendarEnabled: e.target.checked }).catch(console.error);
    });
    $('pref-temp').addEventListener('change', (e) => {
        Store.savePrefs({ tempUnit: e.target.value }).catch(console.error);
    });
    $('pref-weekstart').addEventListener('change', (e) => {
        Store.savePrefs({ weekStart: e.target.value }).catch(console.error);
    });

    // Repeat warnings: switch, how many past times, and which categories count.
    $('pref-repeat').addEventListener('change', (e) => {
        Store.savePrefs({ repeatWarnings: e.target.checked }).catch(console.error);
    });
    $('pref-lookback').addEventListener('change', (e) => {
        Store.savePrefs({ repeatLookBack: Number(e.target.value) }).catch(console.error);
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
        Store.savePrefs({ repeatCategories: chosen }).catch(console.error);
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
