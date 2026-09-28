const Store = {
    getCloset() {
        return JSON.parse(localStorage.getItem('rack_closet')) || [];
    },
    saveCloset(closet) {
        localStorage.setItem('rack_closet', JSON.stringify(closet));
    },
    // schedule is keyed by ISO date string, e.g. '2026-09-28' -> [itemId, ...]
    getSchedule() {
        return JSON.parse(localStorage.getItem('rack_schedule')) || {};
    },
    saveSchedule(schedule) {
        localStorage.setItem('rack_schedule', JSON.stringify(schedule));
    },
    getSavedOutfits() {
        return JSON.parse(localStorage.getItem('rack_saved_outfits')) || [];
    },
    saveSavedOutfits(outfits) {
        localStorage.setItem('rack_saved_outfits', JSON.stringify(outfits));
    },
    getLocation() {
        return JSON.parse(localStorage.getItem('rack_location')) || null;
    },
    saveLocation(location) {
        localStorage.setItem('rack_location', JSON.stringify(location));
    },
    getCache(key) {
        try {
            return JSON.parse(localStorage.getItem('rack_cache_' + key)) || null;
        } catch {
            return null;
        }
    },
    saveCache(key, value) {
        localStorage.setItem('rack_cache_' + key, JSON.stringify(value));
    }
};
