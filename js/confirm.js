// A reusable "Are you sure?" window, and the wording for what deleting an item
// would affect. Used before anything the user can't easily get back.
//
//   if (await confirmDialog({ title: 'Delete this?', message: '...' })) { ... }
//
// Cancel, Esc and a click outside all answer "no". The Cancel button has the
// focus when it opens, so pressing Enter by habit never deletes anything.

function pluralize(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// What deleting a closet item would touch.
//   scheduleByDate: { 'YYYY-MM-DD': [{ id, label, itemIds, worn? }] }  (planned outfits)
//   savedOutfits:   [{ id, name, itemIds }]
// An outfit left with no pieces and no activity disappears (same rule as
// Store.removeItemFromSchedule); a saved outfit left with no pieces is deleted.
function itemDeletionImpact(itemId, scheduleByDate, savedOutfits) {
    const impact = { days: 0, plannedOutfits: 0, plannedOutfitsRemoved: 0, wornDays: 0, saved: [] };
    for (const outfits of Object.values(scheduleByDate || {})) {
        let touchedDay = false, wornDay = false;
        outfits.forEach(o => {
            if (!o.itemIds.includes(itemId)) return;
            touchedDay = true;
            impact.plannedOutfits++;
            if (o.worn) wornDay = true;
            const left = o.itemIds.filter(id => id !== itemId).length;
            if (left === 0 && !o.label) impact.plannedOutfitsRemoved++;
        });
        if (touchedDay) impact.days++;
        if (wornDay) impact.wornDays++;
    }
    (savedOutfits || []).forEach(s => {
        if (!s.itemIds.includes(itemId)) return;
        const left = s.itemIds.filter(id => id !== itemId).length;
        impact.saved.push({ id: s.id, name: s.name, willBeDeleted: left === 0 });
    });
    return impact;
}

// The sentences shown in the confirmation: { message, details: [string] }.
function describeItemDeletion(itemName, impact) {
    const details = [];
    if (impact.days > 0) {
        details.push(`It will be taken out of ${pluralize(impact.days, 'planned day')}` +
            (impact.plannedOutfits > impact.days ? ` (${pluralize(impact.plannedOutfits, 'planned outfit')})` : '') + '.');
        if (impact.plannedOutfitsRemoved > 0) {
            details.push(`${pluralize(impact.plannedOutfitsRemoved, 'planned outfit')} had only this piece and no activity, so ${impact.plannedOutfitsRemoved === 1 ? 'it' : 'they'} will be removed from the calendar.`);
        }
        if (impact.wornDays > 0) {
            details.push(`It will also leave your wear history (${pluralize(impact.wornDays, 'day')} marked as worn).`);
        }
    } else {
        details.push('It isn’t planned on any day.');
    }
    const kept = impact.saved.filter(s => !s.willBeDeleted);
    const gone = impact.saved.filter(s => s.willBeDeleted);
    if (impact.saved.length === 0) {
        details.push('It isn’t in any saved outfit.');
    } else {
        if (kept.length) details.push(`It will be taken out of ${pluralize(kept.length, 'saved outfit')}: ${kept.map(s => `“${s.name}”`).join(', ')}.`);
        if (gone.length) details.push(`${gone.length === 1 ? 'This saved outfit has' : 'These saved outfits have'} only this piece, so ${gone.length === 1 ? 'it' : 'they'} will be deleted too: ${gone.map(s => `“${s.name}”`).join(', ')}.`);
    }
    return { message: `“${itemName}” will be removed from your closet.`, details };
}

// ---------------------------------------------------------------------------
// The window itself (markup: #confirm-modal in index.html)

let confirmResolve = null;

// Closing hands focus back to whatever had it when the question opened (js/dialog.js), and
// un-blocks the window underneath it, if any.
function finishConfirm(answer) {
    const modal = document.getElementById('confirm-modal');
    modal.classList.add('hidden');
    ModalDialogs.close(modal);
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(answer);
}

// options: { title, message, details = [], note = '', confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true }
function confirmDialog(options) {
    const o = { details: [], note: '', confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true, ...options };
    if (confirmResolve) finishConfirm(false);          // never leave an earlier question hanging

    const $ = (id) => document.getElementById(id);
    $('confirm-title').textContent = o.title;
    $('confirm-message').textContent = o.message || '';
    $('confirm-message').classList.toggle('hidden', !o.message);
    const list = $('confirm-details');
    list.innerHTML = '';
    o.details.forEach(text => { const li = document.createElement('li'); li.textContent = text; list.appendChild(li); });
    list.classList.toggle('hidden', o.details.length === 0);
    $('confirm-note').textContent = o.note;
    $('confirm-note').classList.toggle('hidden', !o.note);
    const ok = $('confirm-ok-btn'), cancel = $('confirm-cancel-btn');
    ok.textContent = o.confirmLabel;
    ok.className = o.danger ? 'danger-btn' : 'primary-btn';
    cancel.textContent = o.cancelLabel;
    cancel.classList.toggle('hidden', !o.cancelLabel);     // no cancel label = a plain notice with just OK

    $('confirm-modal').classList.remove('hidden');
    // The safe answer has focus first (Cancel, or OK on a plain notice); the page behind is blocked.
    ModalDialogs.open($('confirm-modal'), { initialFocus: o.cancelLabel ? cancel : ok });
    return new Promise(resolve => { confirmResolve = resolve; });
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('confirm-modal');
    if (!modal) return;
    document.getElementById('confirm-ok-btn').addEventListener('click', () => finishConfirm(true));
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => finishConfirm(false));

    // A click on the dark area answers "no" (press and release both on it).
    let pressedOnBackdrop = false;
    modal.addEventListener('mousedown', (e) => { pressedOnBackdrop = e.target === modal; });
    modal.addEventListener('click', (e) => {
        if (pressedOnBackdrop && e.target === modal) finishConfirm(false);
        pressedOnBackdrop = false;
    });

    // Handled first (capture phase) so a window underneath, like the edit popup,
    // doesn't also react to the same Esc. (Tab stays inside the window: js/dialog.js.)
    window.addEventListener('keydown', (e) => {
        if (modal.classList.contains('hidden')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finishConfirm(false);
        }
    }, true);
});

if (typeof module !== 'undefined') {
    module.exports = { pluralize, itemDeletionImpact, describeItemDeletion };
}
