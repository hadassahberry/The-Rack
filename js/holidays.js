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

// Candle lighting is 18 minutes before sunset, everywhere.
const CANDLE_LIGHTING_MINUTES = 18;

// Inside Israel the holiday schedule differs (e.g. no second day of Yom Tov),
// so it's inferred from the location: no setting needed. The time zone is the
// most reliable signal because every saved location carries one.
function isIsraelLocation(loc) {
    return !!loc && (loc.country === 'IL' || loc.tzid === 'Asia/Jerusalem' || loc.tzid === 'Asia/Tel_Aviv');
}

// The Israel and outside-Israel schedules are cached separately.
function holidaysCacheKey(year, month, loc) {
    return `holidays_${year}-${month}_${loc.lat}_${loc.lon}${isIsraelLocation(loc) ? '_il' : ''}`;
}

const Holidays = {
    getMap(year, month, location) {
        const loc = location || Location.get();
        return Store.getCache(holidaysCacheKey(year, month, loc)) || {};
    },

    async refresh(year, month, location) {
        if (!location || !location.tzid) return this.getMap(year, month, location);

        try {
            const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&month=${month}&maj=on&min=on&mod=on&s=on&c=on&geo=pos&latitude=${location.lat}&longitude=${location.lon}&tzid=${encodeURIComponent(location.tzid)}&b=${CANDLE_LIGHTING_MINUTES}${isIsraelLocation(location) ? '&i=on' : ''}`;
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

            Store.saveCache(holidaysCacheKey(year, month, location), map);
            return map;
        } catch {
            return this.getMap(year, month, location);
        }
    }
};
