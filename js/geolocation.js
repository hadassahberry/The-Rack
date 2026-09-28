// Resolves and persists the location (lat/lon/city) used to drive weather
// and Jewish-holiday lookups. Tries browser geolocation first, falls back
// to a manual city search, and finally to a hardcoded default.
const DEFAULT_LOCATION = { city: 'New York', region: 'NY', lat: 40.7128, lon: -74.006, source: 'default' };

const Location = {
    get() {
        return Store.getLocation() || DEFAULT_LOCATION;
    },

    async init() {
        const saved = Store.getLocation();
        if (saved) return saved;

        const geoLocation = await this._tryBrowserGeolocation();
        const location = geoLocation || DEFAULT_LOCATION;
        Store.saveLocation(location);
        return location;
    },

    _tryBrowserGeolocation() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) { resolve(null); return; }

            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    try {
                        const { latitude, longitude } = pos.coords;
                        const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
                        const data = await res.json();
                        resolve({
                            city: data.city || data.locality || 'Current Location',
                            region: data.principalSubdivisionCode || data.principalSubdivision || '',
                            lat: latitude,
                            lon: longitude,
                            source: 'geo'
                        });
                    } catch {
                        resolve({ city: 'Current Location', region: '', lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'geo' });
                    }
                },
                () => resolve(null),
                { timeout: 8000 }
            );
        });
    },

    async searchCity(cityName) {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1`);
        const data = await res.json();
        if (!data.results || data.results.length === 0) return null;

        const { latitude, longitude, name, admin1 } = data.results[0];
        const location = { city: name, region: admin1 || '', lat: latitude, lon: longitude, source: 'manual' };
        Store.saveLocation(location);
        return location;
    }
};
