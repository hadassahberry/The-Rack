// Resolves and persists the location (lat/lon/city) used to drive weather
// and Jewish-holiday lookups. Tries browser geolocation first, falls back
// to a manual city search, and finally to a hardcoded default.
// Each location carries its IANA time zone (tzid): the Hebrew calendar needs
// it for candle-lighting times, and it must not depend on the weather lookup,
// because weather can be switched off in Settings.
// It also carries a 2-letter country code, used to pick °F or °C automatically.
const DEFAULT_LOCATION = { city: 'New York', region: 'NY', country: 'US', lat: 40.7128, lon: -74.006, tzid: 'America/New_York', source: 'default' };

// The device's own time zone — right for "my current location".
const deviceTimeZone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
};

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

    // "Use my current location" (Settings): ask the device again and save it.
    async detect() {
        const found = await this._tryBrowserGeolocation();
        if (!found) return null;
        Store.saveLocation(found);
        return found;
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
                            country: data.countryCode || undefined,
                            lat: latitude,
                            lon: longitude,
                            tzid: deviceTimeZone(),
                            source: 'geo'
                        });
                    } catch {
                        resolve({ city: 'Current Location', region: '', lat: pos.coords.latitude, lon: pos.coords.longitude, tzid: deviceTimeZone(), source: 'geo' });
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

        const { latitude, longitude, name, admin1, timezone, country_code } = data.results[0];
        const location = { city: name, region: admin1 || '', country: country_code, lat: latitude, lon: longitude, tzid: timezone, source: 'manual' };
        Store.saveLocation(location);
        return location;
    }
};
