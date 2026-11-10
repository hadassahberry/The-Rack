// Applies the user's Settings (js/settings.js draws the page itself).
//
// Weather, the Hebrew calendar and public holidays are each optional. Anything
// switched off is never requested, so the user's location is never sent to
// that service, and the browser's location prompt only appears if at least one
// of them is on. (Christian and Hijri dates are worked out on the device.)
// Nothing is fetched until the user is signed in and their saved settings
// have arrived (they sync with the account).
let appliedPrefs = null;

document.addEventListener('DOMContentLoaded', async () => {
    renderCredits(Store.getPrefs());
    await window.waitForAuth();
    Store.onPrefsChange(applyPrefs);
});

async function applyPrefs(prefs) {
    const was = appliedPrefs;
    appliedPrefs = prefs;

    // The first time this page hears the account's saved preferences (from the server, not the local copy),
    // a brand-new empty account may be shown the welcome card. Anyone else is left alone (js/welcome.js).
    if (!was) Welcome.consider(prefs);

    syncSettingsUI(prefs);
    renderCalendar();

    // Only fetch what was just switched on, or everything on the first pass
    // after page load. (Saving a setting echoes back here; that must not refetch.)
    const needWeather = prefs.weatherEnabled && !(was && was.weatherEnabled);
    const needHebrew = prefs.hebrewCalendarEnabled && !(was && was.hebrewCalendarEnabled);
    const needPublic = prefs.publicHolidays && !(was && was.publicHolidays);
    if (!needWeather && !needHebrew && !needPublic) return;

    const location = Store.getLocation() || await Location.init();   // may ask the device for location
    setLocationField(location);
    if (needWeather) await Weather.refresh(location);
    if (needHebrew || needPublic) await refreshHolidaysForView(Store.getLocation() || location);
    renderCalendar();
}
