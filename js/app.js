// Bootstraps location -> weather -> holidays after the initial (cached/default)
// paint from calendar.js, then re-renders with live data.
document.addEventListener('DOMContentLoaded', async () => {
    const location = await Location.init();
    const cityInput = document.getElementById('city-input');
    if (cityInput) cityInput.value = formatLocationLabel(location);

    await Weather.refresh(location);
    const withTzid = Store.getLocation() || location;
    await Holidays.refresh(viewYear, viewMonthJs + 1, withTzid);

    renderCalendar();
});
