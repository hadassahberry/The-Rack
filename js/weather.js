// Daily forecast (up to 16 days out) keyed by ISO date, plus small helpers
// to render a short description/icon for a WMO weather code.
const WEATHER_CODES = {
    0: { icon: '☀️', label: 'clear and sunny' },
    1: { icon: '🌤️', label: 'mostly clear' },
    2: { icon: '⛅', label: 'partly cloudy' },
    3: { icon: '☁️', label: 'overcast and mild' },
    45: { icon: '🌫️', label: 'foggy' },
    48: { icon: '🌫️', label: 'foggy' },
    51: { icon: '🌦️', label: 'light drizzle' },
    53: { icon: '🌦️', label: 'drizzly' },
    55: { icon: '🌦️', label: 'steady drizzle' },
    61: { icon: '🌧️', label: 'light rain' },
    63: { icon: '🌧️', label: 'rainy' },
    65: { icon: '🌧️', label: 'heavy rain' },
    71: { icon: '❄️', label: 'light snow' },
    73: { icon: '❄️', label: 'snowy' },
    75: { icon: '❄️', label: 'heavy snow' },
    80: { icon: '🌦️', label: 'rain showers' },
    81: { icon: '🌦️', label: 'rain showers' },
    82: { icon: '🌧️', label: 'heavy showers' },
    95: { icon: '⛈️', label: 'stormy' }
};

function weatherInfo(code) {
    return WEATHER_CODES[code] || { icon: '🌡️', label: 'unknown conditions' };
}

// ---- Temperature units ----
// Forecasts are stored in °F and converted when shown. "Automatic" picks °F in
// the few countries that use it and °C everywhere else, based on the location;
// the Settings page can override it.
const FAHRENHEIT_COUNTRIES = new Set([
    'US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM',   // United States and its territories
    'BS', 'BZ', 'KY', 'PW', 'LR', 'MH', 'FM'    // Bahamas, Belize, Cayman Is., Palau, Liberia, Marshall Is., Micronesia
]);

// Older saved locations have no country; fall back to the device's language region.
function countryOfLocation(location) {
    if (location && location.country) return String(location.country).toUpperCase();
    try { return (new Intl.Locale(navigator.language).region || '').toUpperCase(); } catch { return ''; }
}

function usesFahrenheit(location) {
    const country = countryOfLocation(location);
    return country ? FAHRENHEIT_COUNTRIES.has(country) : true;   // unknown: °F
}

// 'F' or 'C' — the user's choice, or automatic from the location.
function currentTempUnit() {
    const choice = Store.getPrefs().tempUnit;
    if (choice === 'F' || choice === 'C') return choice;
    return usesFahrenheit(Location.get()) ? 'F' : 'C';
}

// Forecast temperatures are stored in °F; this shows them in the chosen unit.
function formatTemp(valueF, withUnit = false) {
    const unit = currentTempUnit();
    const value = unit === 'C' ? Math.round((valueF - 32) * 5 / 9) : Math.round(valueF);
    return `${value}°${withUnit ? unit : ''}`;
}

const Weather = {
    getForecastMap(location) {
        const loc = location || Location.get();
        return Store.getCache(`weather_${loc.lat}_${loc.lon}`) || {};
    },

    async refresh(location) {
        try {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&temperature_unit=fahrenheit&timezone=auto&forecast_days=16`);
            const data = await res.json();

            if (data.timezone && data.timezone !== location.tzid) {
                Store.saveLocation({ ...location, tzid: data.timezone });
            }

            const map = {};
            data.daily.time.forEach((dateStr, i) => {
                const high = Math.round(data.daily.temperature_2m_max[i]);
                const low = Math.round(data.daily.temperature_2m_min[i]);
                map[dateStr] = { high, low, code: data.daily.weathercode[i] };
            });

            Store.saveCache(`weather_${location.lat}_${location.lon}`, map);
            return map;
        } catch {
            return this.getForecastMap(location);
        }
    }
};
