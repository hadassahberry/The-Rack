// Jewish calendar data (holidays + Friday candle-lighting) from Hebcal's
// free, keyless JSON API. Keyed by ISO date so the calendar can badge cells.
function normalizeHolidayTitle(title) {
    let t = title.replace(/\s+\d{4,}$/, '');
    if (t === 'Rosh Hashana') t = 'Rosh Hashana I';
    return t;
}

function formatCandleTime(isoDateTime) {
    // Hebcal returns wall-clock time for the queried location as an explicit
    // offset (e.g. "2026-09-04T19:05:00-04:00") — read it directly instead of
    // going through Date's local-timezone getters, which would silently
    // re-interpret it in the browser's own timezone.
    const match = /T(\d{2}):(\d{2})/.exec(isoDateTime);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
}

const Holidays = {
    getMap(year, month, location) {
        const loc = location || Location.get();
        return Store.getCache(`holidays_${year}-${month}_${loc.lat}_${loc.lon}`) || {};
    },

    async refresh(year, month, location) {
        if (!location || !location.tzid) return this.getMap(year, month, location);

        try {
            const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&month=${month}&maj=on&min=on&mod=on&s=on&c=on&geo=pos&latitude=${location.lat}&longitude=${location.lon}&tzid=${encodeURIComponent(location.tzid)}&m=18`;
            const res = await fetch(url);
            const data = await res.json();

            const map = {};
            (data.items || []).forEach(item => {
                const dateKey = item.date.slice(0, 10);
                if (item.category === 'candles') {
                    map[dateKey] = map[dateKey] || { holidays: [], candleLighting: null };
                    map[dateKey].candleLighting = formatCandleTime(item.date);
                } else if (item.category === 'holiday') {
                    map[dateKey] = map[dateKey] || { holidays: [], candleLighting: null };
                    map[dateKey].holidays.push({ title: normalizeHolidayTitle(item.title), yomtov: !!item.yomtov });
                }
            });

            Store.saveCache(`holidays_${year}-${month}_${location.lat}_${location.lon}`, map);
            return map;
        } catch {
            return this.getMap(year, month, location);
        }
    }
};
