const Store = {
    getCloset() {
        return JSON.parse(localStorage.getItem('rack_closet')) || [];
    },
    saveCloset(closet) {
        localStorage.setItem('rack_closet', JSON.stringify(closet));
    },
    getSchedule() {
        return JSON.parse(localStorage.getItem('rack_schedule')) || {};
    },
    saveSchedule(schedule) {
        localStorage.setItem('rack_schedule', JSON.stringify(schedule));
    }
};
