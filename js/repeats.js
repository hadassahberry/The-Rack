// Repeat warnings: "you already wore this to that activity."
//
// An outfit can carry an activity label ("Class", "Shul", ...). Shabbos
// (Saturdays) and Yom Tov get a label automatically when the Hebrew calendar
// is on. For an outfit with a label, we look at the last N other times that
// same activity was planned (the N closest days, before or after, so planning
// ahead works too) and flag:
//   - an item that was also worn to that activity   (soft: shown on the item)
//   - the same combination of items                 (strong: shown on the outfit)
// Settings decide N and which categories count (e.g. only tops, bottoms and
// dresses, so wearing the same shoes every week doesn't nag).
//
// Pure functions only — no page access — so they can be tested on their own.

// "Class", " class ", "CLASS" are the same activity.
function normalizeActivity(label) {
    return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Whole days from aKey to bKey ('YYYY-MM-DD'); positive when b is later.
// Bare dates parse as UTC midnight, so the difference is an exact multiple of a day.
function daysBetween(aKey, bKey) {
    return Math.round((new Date(bKey) - new Date(aKey)) / 86400000);
}

// "yesterday", "5 days ago", "3 weeks ago", "in 2 weeks", "4 months ago"...
function describeWhen(daysAway) {
    const n = Math.abs(daysAway);
    const future = daysAway > 0;
    if (n === 1) return future ? 'tomorrow' : 'yesterday';
    if (n < 14) return future ? `in ${n} days` : `${n} days ago`;
    if (n < 60) {
        const weeks = Math.round(n / 7);
        return future ? `in ${weeks} weeks` : `${weeks} weeks ago`;
    }
    const months = Math.round(n / 30);
    return future ? `in ${months} months` : `${months} months ago`;
}

// Everything needed to judge one activity on one day, worked out once:
// the N closest other times that activity was planned. Returns null when
// warnings don't apply (switched off, no activity label, or no categories chosen).
//   outfitsByDate: { 'YYYY-MM-DD': [{ id, label, itemIds }] }
//   labelOf(dateKey, outfit): the outfit's effective label (typed or automatic)
function repeatContext({ dateKey, label, outfitsByDate, labelOf, prefs }) {
    if (!prefs.repeatWarnings) return null;
    const wanted = normalizeActivity(label);
    if (!wanted) return null;
    const tracked = new Set(prefs.repeatCategories || []);
    if (tracked.size === 0) return null;

    const matches = [];
    for (const [otherKey, outfits] of Object.entries(outfitsByDate)) {
        if (otherKey === dateKey) continue;                     // same day isn't a "last time"
        for (const o of outfits) {
            if (!o.itemIds.length) continue;                    // nothing was planned, so no outfit to repeat
            if (normalizeActivity(labelOf(otherKey, o)) !== wanted) continue;
            matches.push({ dateKey: otherKey, daysAway: daysBetween(dateKey, otherKey), itemIds: new Set(o.itemIds) });
        }
    }
    // Closest first (the earlier day wins a tie), then keep only the last N times.
    matches.sort((a, b) => Math.abs(a.daysAway) - Math.abs(b.daysAway) || a.daysAway - b.daysAway);
    const lookBack = Math.max(1, Number(prefs.repeatLookBack) || 3);
    return { label: String(label).trim(), tracked, occurrences: matches.slice(0, lookBack) };
}

// Soft flag: the closest of those times this item was worn, or null.
// Only items in the chosen categories count.
function itemRepeat(ctx, itemId, category) {
    if (!ctx || !ctx.tracked.has(category)) return null;
    return ctx.occurrences.find(o => o.itemIds.has(itemId)) || null;
}

// Strong flag: the closest of those times with exactly the same combination
// of (counted) items, or null. Needs at least two counted items; with just
// one, the item flag already says it.
function sameOutfitRepeat(ctx, itemIds, categoryOf) {
    if (!ctx) return null;
    const mine = itemIds.filter(id => ctx.tracked.has(categoryOf(id)));
    if (mine.length < 2) return null;
    const mineSet = new Set(mine);
    return ctx.occurrences.find(o => {
        const theirs = [...o.itemIds].filter(id => ctx.tracked.has(categoryOf(id)));
        return theirs.length === mineSet.size && theirs.every(id => mineSet.has(id));
    }) || null;
}

if (typeof module !== 'undefined') {
    module.exports = { normalizeActivity, daysBetween, describeWhen, repeatContext, itemRepeat, sameOutfitRepeat };
}
