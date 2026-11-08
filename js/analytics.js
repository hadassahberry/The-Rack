// Wear stats. Planning an outfit is not wearing it, so only outfits the owner
// has marked as worn count as wears. Today's date is the cut-off: an outfit on a
// future day can never be a wear, and a plan on a past day that was never marked
// is shown as "not marked yet" rather than quietly assumed worn.
//
// Dates are 'YYYY-MM-DD' strings, which compare correctly as plain strings.

// closet: [{ id, name, category, ... }]
// scheduleByDate: { 'YYYY-MM-DD': [{ id, label, itemIds, worn? }] }
function computeWearStats(closet, scheduleByDate, todayKey) {
    const known = new Set(closet.map(i => i.id));
    const wornDays = {};      // itemId -> Set of days it was worn
    const plannedDays = {};   // itemId -> Set of days it's planned, today or later, not worn yet
    const unmarkedPast = [];  // past plans never marked as worn: [{ date, outfitId }]
    let plannedOutfits = 0;

    for (const [date, outfits] of Object.entries(scheduleByDate)) {
        outfits.forEach(o => {
            const ids = o.itemIds.filter(id => known.has(id));
            if (ids.length === 0) return;
            if (date <= todayKey && o.worn) {
                ids.forEach(id => (wornDays[id] = wornDays[id] || new Set()).add(date));
            } else if (date >= todayKey) {
                plannedOutfits++;
                ids.forEach(id => (plannedDays[id] = plannedDays[id] || new Set()).add(date));
            } else {
                unmarkedPast.push({ date, outfitId: o.id });
            }
        });
    }

    const perItem = closet.map(item => ({
        item,
        worn: wornDays[item.id] ? wornDays[item.id].size : 0,
        planned: plannedDays[item.id] ? plannedDays[item.id].size : 0
    }));
    const totalWears = perItem.reduce((sum, p) => sum + p.worn, 0);

    const categoryCounts = {};
    perItem.forEach(p => { if (p.worn) categoryCounts[p.item.category] = (categoryCounts[p.item.category] || 0) + p.worn; });
    const topCategory = Object.keys(categoryCounts).reduce((a, b) => categoryCounts[a] >= categoryCounts[b] ? a : b, null);

    return { totalItems: closet.length, totalWears, plannedOutfits, topCategory, perItem, unmarkedPast };
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            if (btn.dataset.tab === 'analytics-view') btn.addEventListener('click', renderAnalytics);
        });
        const markBtn = document.getElementById('wear-mark-past-btn');
        if (markBtn) markBtn.addEventListener('click', markPastOutfitsWorn);
    });
}

let wearUnmarkedPast = [];     // what the "Mark them as worn" button would mark

async function renderAnalytics() {
    const closet = await Store.getCloset();
    const schedule = await Store.getScheduleDetail();
    const stats = computeWearStats(closet, schedule, isoDateKey(new Date()));

    document.getElementById('stat-total-items').textContent = stats.totalItems;
    document.getElementById('stat-total-wears').textContent = stats.totalWears;
    document.getElementById('stat-planned').textContent = stats.plannedOutfits;
    document.getElementById('stat-top-category').textContent = stats.topCategory ? stats.topCategory.toUpperCase() : '—';

    // Past plans nobody marked: offered, never assumed.
    wearUnmarkedPast = stats.unmarkedPast;
    const notice = document.getElementById('wear-unmarked');
    notice.classList.toggle('hidden', wearUnmarkedPast.length === 0);
    document.getElementById('wear-unmarked-text').textContent = wearUnmarkedPast.length === 0 ? '' :
        `${pluralize(wearUnmarkedPast.length, 'past planned outfit')} ${wearUnmarkedPast.length === 1 ? 'isn’t' : 'aren’t'} marked as worn, so ${wearUnmarkedPast.length === 1 ? 'it isn’t' : 'they aren’t'} counted. ` +
        'Wore them? Mark them all here, or open a day in the Planner to mark outfits one at a time.';

    const wornGrid = document.getElementById('analytics-most-worn');
    wornGrid.innerHTML = '';
    const worn = stats.perItem.filter(p => p.worn > 0).sort((a, b) => b.worn - a.worn).slice(0, 4);
    if (worn.length === 0) {
        wornGrid.innerHTML = '<p class="planning-empty">Nothing marked as worn yet. Open today or a past day in the Planner and press “Mark as worn” on an outfit.</p>';
        return;
    }
    worn.forEach(p => {
        wornGrid.innerHTML += `
            <div class="worn-card">
                <img src="${itemPhoto(p.item)}" alt="">
                <span>${escapeHtml(p.item.name)}</span>
                <span style="font-size:0.7rem; color:#888;">Worn ${p.worn}x${p.planned ? ` · planned ${p.planned}x` : ''}</span>
            </div>
        `;
    });
}

// Explicitly marks the listed past outfits as worn (after asking).
async function markPastOutfitsWorn() {
    const todo = wearUnmarkedPast;
    if (todo.length === 0) return;
    const sure = await confirmDialog({
        title: `Mark ${pluralize(todo.length, 'past outfit')} as worn?`,
        message: 'They’ll count toward your wear stats. You can unmark any of them later by opening that day in the Planner.',
        confirmLabel: 'Mark as worn',
        danger: false
    });
    if (!sure) return;

    const schedule = await Store.getScheduleDetail();            // fresh copy, not the one on screen
    const idsByDate = {};
    todo.forEach(t => (idsByDate[t.date] = idsByDate[t.date] || new Set()).add(t.outfitId));
    try {
        for (const [date, ids] of Object.entries(idsByDate)) {
            const outfits = (schedule[date] || []).map(o => ids.has(o.id) ? { ...o, worn: true } : o);
            await Store.setScheduleOutfits(date, outfits);
        }
    } catch (err) {
        console.error('Marking outfits as worn failed', err);
        await confirmDialog({ title: 'Couldn’t mark them', message: 'Something went wrong. Please try again.', confirmLabel: 'OK', cancelLabel: '', danger: false });
    }
    renderAnalytics();
}

if (typeof module !== 'undefined') {
    module.exports = { computeWearStats };
}
