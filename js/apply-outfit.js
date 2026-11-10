// What happens when a SAVED outfit is applied to a day. Pure functions (no page access) so they
// can be tested on their own. The rule is that nothing is overwritten silently:
//
//   already  an outfit on the day already has exactly these pieces: nothing changes, and the
//            person is told it's already planned (no duplicate outfit is created)
//   create   the day has no outfit yet: the saved outfit is added
//   fill     the highlighted outfit has no pieces yet: they're put in it (its activity is kept)
//   replace  the highlighted outfit has other pieces: they are swapped for the saved outfit's
//            (its activity is kept) and the person is told, with an Undo
//   add      the highlighted outfit is marked as WORN: it is left alone (so the record of what
//            was worn doesn't change) and the saved outfit is added as another outfit

function sameItemSet(a, b) {
    const A = new Set(a), B = new Set(b);
    return A.size === B.size && [...A].every(x => B.has(x));
}

// dayOutfits: the day's outfits [{ id, label, itemIds, worn? }]; activeId: the highlighted one.
function planApplySavedOutfit({ dayOutfits, activeId, savedItemIds }) {
    const outfits = dayOutfits || [];
    if (outfits.length === 0) return { action: 'create' };

    const active = outfits.find(o => o.id === activeId) || null;
    const matches = (o) => o.itemIds.length > 0 && sameItemSet(o.itemIds, savedItemIds);
    const twin = active && matches(active) ? active : outfits.find(matches);
    if (twin) return { action: 'already', outfitId: twin.id, isActive: twin.id === activeId };

    if (!active) return { action: 'create' };
    if (active.itemIds.length === 0) return { action: 'fill', outfitId: active.id };
    if (active.worn) return { action: 'add', outfitId: active.id };
    return { action: 'replace', outfitId: active.id, previousItemIds: [...active.itemIds] };
}

// The sentence shown after applying. `outfit` is the outfit the plan is about (for its activity).
function describeApply(plan, savedName, outfit) {
    const name = `“${savedName}”`;
    const activity = outfit && outfit.label ? `“${outfit.label}”` : '';
    switch (plan.action) {
        case 'already':
            return plan.isActive
                ? `Already planned: ${name} is already in this outfit. Nothing was changed.`
                : `Already planned: ${name} is already in ${activity ? `your ${activity} outfit` : 'another outfit on this day'}. Nothing was changed.`;
        case 'create':
            return `Added ${name} to this day.`;
        case 'fill':
            return `Added ${name} to your ${activity ? activity + ' ' : ''}outfit.`;
        case 'replace':
            return `Replaced the pieces in ${activity ? `your ${activity} outfit` : 'this outfit'} with ${name}.` +
                (activity ? ` The activity ${activity} was kept.` : '');
        case 'add':
            return `${activity ? `Your ${activity} outfit is` : 'This outfit is'} marked as worn, so it was left as it was. ${name} was added as another outfit.`;
        default:
            return '';
    }
}

// A fingerprint of everything on a day that an apply (or its Undo) can touch: each outfit's id,
// activity, pieces (in order), repeat-warning switch and worn mark.
function outfitsSignature(dayOutfits) {
    return JSON.stringify((dayOutfits || []).map(o =>
        [o.id, o.label || '', [...(o.itemIds || [])], !!o.flagsOff, !!o.worn]));
}

// The "Added…" notice (and its Undo) describe the day as it was right after the apply. Once the day
// is any different (an outfit added or removed, a piece changed, an activity edited, a change that
// arrived from another device) the notice is out of date and its Undo would be working from an old
// snapshot, so it must go. `notice.signature` is outfitsSignature() taken right after the apply.
function applyNoticeIsCurrent(notice, dayOutfits) {
    return !!notice && notice.signature === outfitsSignature(dayOutfits);
}

if (typeof module !== 'undefined') {
    module.exports = { sameItemSet, planApplySavedOutfit, describeApply, outfitsSignature, applyNoticeIsCurrent };
}
