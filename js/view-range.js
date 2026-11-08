// Rules for the calendar's date range, kept free of page code so they can be tested.
//   pickSwitchAnchor:   which date the new range is built around when you switch
//                       between Week / 2 weeks / Month.
//   describeViewRange:  the plain-words line under the title ("This week",
//                       "Next week", "3 months ago") that says where the range sits.

function vrKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function vrParse(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// Whole days since 1970 for a calendar date (immune to daylight-saving shifts).
function vrDay(date) {
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

// "Keep what you're looking at." When you switch views the new range is built around:
//   1. the selected day, if you can see it now (a day you picked on purpose is kept);
//   2. otherwise today, if you can see that;
//   3. otherwise whatever you're looking at: the first of the month on screen, the
//      middle of the range when going to Month, or the start of the range.
// The selected day itself is never changed here, only where the view is centered.
function pickSwitchAnchor({ fromMode, toMode, dates, anchorDate, selectedKey, todayKey }) {
    const keys = dates.map(vrKey);
    if (keys.includes(selectedKey)) return vrParse(selectedKey);
    if (keys.includes(todayKey)) return vrParse(todayKey);
    if (fromMode === 'month') return new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    if (toMode === 'month') return dates[Math.floor(dates.length / 2)];
    return dates[0];
}

// Where the shown range sits relative to today. `dates` = every date on screen.
function describeViewRange(mode, dates, today) {
    if (mode === 'month') {
        // The month the grid is "about" is the one its middle cell belongs to
        // (the first and last rows borrow days from the neighboring months).
        const shown = dates[Math.floor(dates.length / 2)];
        const diff = (shown.getFullYear() - today.getFullYear()) * 12 + (shown.getMonth() - today.getMonth());
        if (diff === 0) return 'This month';
        if (diff === 1) return 'Next month';
        if (diff === -1) return 'Last month';
        return diff > 0 ? `${diff} months from now` : `${-diff} months ago`;
    }

    const todayN = vrDay(today);
    const firstN = vrDay(dates[0]);
    const lastN = vrDay(dates[dates.length - 1]);
    if (todayN >= firstN && todayN <= lastN) return mode === 'week' ? 'This week' : 'Includes today';

    if (firstN > todayN) {
        const weeks = Math.ceil((firstN - todayN) / 7);
        const when = weeks === 1 ? 'next week' : `in ${weeks} weeks`;
        return mode === 'week' ? (weeks === 1 ? 'Next week' : `In ${weeks} weeks`) : `Starts ${when}`;
    }
    const weeks = Math.ceil((todayN - lastN) / 7);
    const when = weeks === 1 ? 'last week' : `${weeks} weeks ago`;
    return mode === 'week' ? (weeks === 1 ? 'Last week' : `${weeks} weeks ago`) : `Ended ${when}`;
}

if (typeof module !== 'undefined') {
    module.exports = { pickSwitchAnchor, describeViewRange, vrKey, vrParse };
}
