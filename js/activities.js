// The person's own activities ("Class", "Shul", "Dinner"...) for the Activity dropdown.
// Pure functions only (no page access) so they can be tested on their own.
//
// There are NO built-in or preset activities: the list is exactly the activities this
// person has saved on a plan. An activity joins the list when it is saved on a plan, never
// from text that is merely being typed.

// "Class", " class ", "CLASS" and "cla  ss"-style spacing slips are the same activity
// (only spaces and capitals are ignored: "Classes" is a different one).
function activityKey(text) {
    return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// The tidy form that gets saved: trimmed, one space between words, at most 40 characters.
function cleanActivity(text) {
    return String(text || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function activityDayMs(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d, 12).getTime();
}

// Every distinct activity on the saved plans, most recently used first.
//   scheduleByDate: { 'YYYY-MM-DD': [{ label, labelAt?, ... }] }
//   nowMs: the current time (a parameter so tests can fix it)
// "Used" means the last time the activity was SAVED on a plan (labelAt, recorded since
// this list existed). Plans saved before that have no such time, so their plan date stands
// in for it, but never a date later than the start of today: planning ahead with an old
// activity shouldn't pin it to the top forever. Ties go in alphabetical order, so the order
// is always the same. If one activity was saved with different spacing or capitals, the
// spelling from its most recent use is the one shown.
function activityList(scheduleByDate, nowMs) {
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    const startOfToday = today.getTime();
    const best = new Map();
    for (const [dateKey, outfits] of Object.entries(scheduleByDate || {})) {
        for (const o of outfits) {
            const label = cleanActivity(o.label);
            if (!label) continue;
            const usedAt = Number.isFinite(o.labelAt) ? o.labelAt : Math.min(activityDayMs(dateKey), startOfToday);
            const key = activityKey(label);
            const seen = best.get(key);
            if (!seen || usedAt > seen.usedAt) best.set(key, { label, key, usedAt });
        }
    }
    return [...best.values()].sort((a, b) =>
        b.usedAt - a.usedAt || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

// The list narrowed to what's been typed: names that START with it first, then names
// that contain it. Each group keeps the list's own order. Nothing typed = everything.
function filterActivities(list, query) {
    const q = activityKey(query);
    if (!q) return list.slice();
    const starts = [], contains = [];
    list.forEach(a => {
        if (a.key.startsWith(q)) starts.push(a);
        else if (a.key.includes(q)) contains.push(a);
    });
    return [...starts, ...contains];
}

// The saved activity that `text` is the same as (ignoring spaces and capitals), or null.
function findActivity(list, text) {
    const key = activityKey(text);
    return key ? (list.find(a => a.key === key) || null) : null;
}

// What to save for typed text: tidied, and spelled the way the existing activity is
// ("class" becomes "Class" if "Class" is already used), so one activity looks the same
// everywhere. '' means "no activity".
function resolveActivity(list, text) {
    const cleaned = cleanActivity(text);
    if (!cleaned) return '';
    const hit = findActivity(list, cleaned);
    return hit ? hit.label : cleaned;
}

if (typeof module !== 'undefined') {
    module.exports = { activityKey, cleanActivity, activityList, filterActivities, findActivity, resolveActivity };
}
