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
