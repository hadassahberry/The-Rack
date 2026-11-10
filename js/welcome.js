// First-time welcome card, and the "How to use The Rack" window.
//
// Who sees the welcome card? Only a BRAND-NEW, EMPTY account that hasn't seen it:
//   - its saved preferences don't say it has been shown (welcomeSeen), on ANY device; and
//   - the account was created on or after WELCOME_NEW_ACCOUNTS_FROM (accounts that existed before this
//     feature are never shown it, even if they later empty their closet); and
//   - it has no closet items, planned days or saved outfits.
// An account whose preferences lack the field entirely (every account made before this feature) is read
// as "unknown", and the other two rules keep it from being shown the card. The card is recorded as seen
// the moment it appears, so reloading or signing in elsewhere never shows it again. The same help stays
// available from Settings and from the ? Help button.

const WELCOME_NEW_ACCOUNTS_FROM = Date.parse('2026-11-10T00:00:00Z');

// prefs: the account's saved preferences; creationTime: when the sign-in was created (a date string);
// counts: { closet, planned, saved } or null when they couldn't be read. Pure, so it is tested alone.
function shouldShowWelcome({ prefs, creationTime, counts, cutoff = WELCOME_NEW_ACCOUNTS_FROM }) {
    if (!prefs || prefs.welcomeSeen === true) return false;              // already shown (on some device)
    if (prefs.welcomeSeen !== undefined && prefs.welcomeSeen !== false) return false;   // anything unexpected: don't force it
    const created = Date.parse(creationTime);
    if (!Number.isFinite(created) || created < cutoff) return false;     // an existing account, or one we can't date
    if (!counts) return false;                                           // couldn't check: err on the side of not showing
    return counts.closet === 0 && counts.planned === 0 && counts.saved === 0;
}

const Welcome = (function () {
    const $ = (id) => document.getElementById(id);
    let considered = false;

    function accountInfo() {
        const user = window.Firebase && window.Firebase.auth && window.Firebase.auth.currentUser;
        return { creationTime: user && user.metadata && user.metadata.creationTime };
    }

    async function readAccountData() {
        const [closet, schedule, saved] = await Promise.all([Store.getCloset(), Store.getScheduleDetail(), Store.getSavedOutfits()]);
        return { closet: closet.length, planned: Object.keys(schedule).length, saved: saved.length };
    }

    // Called once per page load with the account's first saved preferences (js/app.js).
    // deps: replaceable for tests.
    async function consider(prefs, deps = {}) {
        if (considered) return false;
        considered = true;
        const { creationTime } = (deps.accountInfo || accountInfo)();
        // Cheap checks first, so an existing account costs no extra reads.
        if (!shouldShowWelcome({ prefs, creationTime, counts: { closet: 0, planned: 0, saved: 0 } })) return false;
        let counts = null;
        try { counts = await (deps.readAccountData || readAccountData)(); } catch (e) { return false; }
        if (!shouldShowWelcome({ prefs, creationTime, counts })) return false;
        try { await (deps.markSeen || (() => Store.markWelcomeSeen()))(); } catch (e) { console.error('Couldn’t record the welcome card as seen', e); }
        (deps.show || show)();
        return true;
    }

    function show() {
        renderGettingStarted($('welcome-steps'), { full: false });
        $('welcome-modal').classList.remove('hidden');
        ModalDialogs.open($('welcome-modal'), { initialFocus: $('welcome-add-btn'), returnTo: () => $('add-clothes-btn') });
    }

    function dismiss() {
        $('welcome-modal').classList.add('hidden');
        ModalDialogs.close($('welcome-modal'));
    }

    // Both buttons dismiss it; "Add my first item" then goes to the Closet and opens the add-clothes menu.
    function addFirstItem() {
        dismiss();
        const closetTab = document.querySelector('.nav-btn[data-tab="closet-view"]');
        if (closetTab) closetTab.click();
        // Opened once this click has finished: the page closes the add menu for any click outside it, and this
        // very click (on the welcome button) is "outside" until it has finished bubbling.
        setTimeout(() => {
            const addBtn = $('add-clothes-btn');
            if (addBtn.getAttribute('aria-expanded') !== 'true') addBtn.click();     // opens the menu: Upload a photo / Take a photo ...
            const first = $('add-menu-list').querySelector('button:not(.hidden)');
            if (first) first.focus();
        }, 0);
    }

    // ---- the full "How to use The Rack" window (Settings and the ? menu both open it) ----
    function openHelp() {
        renderGettingStarted($('help-content'), { full: true, link: typeof featureEnabled === 'function' && featureEnabled('linkImport') });
        $('help-modal').classList.remove('hidden');
        ModalDialogs.open($('help-modal'), { initialFocus: $('help-close-btn'), returnTo: () => $('help-btn') });
    }
    function closeHelp() {
        $('help-modal').classList.add('hidden');
        ModalDialogs.close($('help-modal'));
    }

    function init() {
        if (!$('welcome-modal')) return;
        $('welcome-add-btn').addEventListener('click', addFirstItem);
        $('welcome-skip-btn').addEventListener('click', dismiss);
        closeOnBackdrop($('welcome-modal'), dismiss);
        $('help-close-btn').addEventListener('click', closeHelp);
        closeOnBackdrop($('help-modal'), closeHelp);
        const settingsBtn = $('settings-help-btn');
        if (settingsBtn) settingsBtn.addEventListener('click', openHelp);
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!$('welcome-modal').classList.contains('hidden') && ModalDialogs.isOpen($('welcome-modal'))) dismiss();
            else if (!$('help-modal').classList.contains('hidden') && ModalDialogs.isOpen($('help-modal'))) closeHelp();
        });
    }
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

    return { consider, openHelp, closeHelp, show, dismiss };
})();

if (typeof module !== 'undefined') {
    module.exports = { shouldShowWelcome, WELCOME_NEW_ACCOUNTS_FROM };
}
