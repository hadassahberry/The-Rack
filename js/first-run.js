// First-run setup for an empty closet: a short, skippable window that offers a starter closet (5-8 quick pieces, photos
// optional) or labeled demo pieces, then offers Help me choose so the person can pick a first outfit.
//
// The rules live in js/starter-closet.js (who is offered it, what a starter piece is, how demo pieces are removed).
// This file is the window, and the order things happen in:
//   1. Nothing is decided until BOTH the account's settings and its closet have really arrived from the server
//      (the live listeners say so with fromCache false). An empty list before that says nothing about the account.
//   2. A closet with pieces is never shown it (and that is remembered, so emptying the closet later doesn't bring it back).
//   3. When shown, it is recorded as seen at once: skipping, closing, finishing or reloading never brings it back by
//      itself. It stays available from the empty Closet, and demo pieces carry a Remove demo pieces button.
//   4. Once the closet can make an outfit, Help me choose is offered straight away; if it can't, the window says exactly
//      what is missing (never an empty or broken result).
// It writes nothing except what the person chooses: the starter pieces, the demo pieces, and the "seen" mark.

const FirstRun = (function () {
    const $ = (id) => document.getElementById(id);
    const state = {
        prefs: null, prefsConfirmed: false, closet: null, closetConfirmed: false,
        decided: false, rows: [], busy: false,
        awaiting: false,      // chose to add their own photos (or closed while something was missing): offer Help me choose once they can
        offered: false
    };
    const STEPS = ['choose', 'starter', 'ready', 'missing'];
    const TITLES = { choose: 'Let’s set up your closet', starter: 'Your starter closet', ready: 'Ready for your first outfit', missing: 'Almost there' };

    const announce = (text) => { const a = $('app-announcer'); if (a) a.textContent = text; };
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const modalOpen = () => !!$('first-run-modal') && !$('first-run-modal').classList.contains('hidden');
    const today = () => isoDateKey(new Date());

    // ---- when to show it ----
    function notePrefs(prefs, meta) {
        state.prefs = prefs;
        state.prefsConfirmed = !!(meta && meta.fromCache === false);
        decide();
    }
    function noteCloset(items, meta) {
        state.closet = items;
        state.closetConfirmed = !!(meta && meta.fromCache === false);
        decide();
        renderDemoBanners(items);
        maybeOffer(items);
    }

    function decide() {
        if (state.decided) return;
        const verdict = firstRunDecision({
            prefs: state.prefs, prefsConfirmed: state.prefsConfirmed,
            closetCount: state.closet ? state.closet.length : undefined, closetConfirmed: state.closetConfirmed
        });
        if (verdict === 'wait') return;
        state.decided = true;
        if (verdict === 'show') {
            showFirstRun();
            return;
        }
        // Someone who already has pieces is never shown it, and that is remembered on the account.
        if (verdict === 'has-pieces' && (state.prefs.firstRunSeen !== true || state.prefs.welcomeSeen !== true)) Store.markFirstRunSeen().catch(e => console.error('Couldn’t record the setup as not needed', e));
        if (typeof Welcome !== 'undefined') Welcome.consider(state.prefs);      // the older welcome card keeps its own rules
    }

    function showFirstRun() {
        // Recorded the moment it appears (as the welcome card is), on the account, so it holds on every device.
        Store.markFirstRunSeen().catch(e => console.error('Couldn’t record the setup as seen', e));
        openModal('choose');
    }

    // ---- the window ----
    function showStep(name) {
        STEPS.forEach(s => { const el = $('first-run-' + s); if (el) el.classList.toggle('hidden', s !== name); });
        $('first-run-title').textContent = TITLES[name];
        setMessage('');
    }
    function openModal(step, initialFocus) {
        const modal = $('first-run-modal');
        showStep(step);
        modal.classList.remove('hidden');
        ModalDialogs.open(modal, {
            initialFocus: initialFocus || (() => modal.querySelector('.first-run-step:not(.hidden) button')),
            returnTo: () => $('add-clothes-btn')
        });
    }
    function closeModal() {
        const modal = $('first-run-modal');
        if (!modal || modal.classList.contains('hidden')) return;
        modal.classList.add('hidden');
        ModalDialogs.close(modal);
    }
    function setMessage(text, kind = 'error') {
        document.querySelectorAll('#first-run-modal .first-run-message').forEach(p => {
            const here = !!p.closest('.first-run-step:not(.hidden)');
            p.textContent = here ? text : '';
            p.classList.toggle('hidden', !(here && text));
            p.classList.toggle('is-error', kind === 'error');
        });
    }
    function setBusy(on) {
        state.busy = on;
        document.querySelectorAll('#first-run-modal button, #first-run-modal input, #first-run-modal select').forEach(el => { el.disabled = on; });
    }

    function startHint() {
        return 'You can set up your closet any time from the Closet tab.';
    }
    // Skip / Esc / a click outside: close it. Anything typed into the starter form is asked about first.
    async function requestClose() {
        if (!modalOpen() || state.busy) return;
        if (!$('first-run-starter').classList.contains('hidden') && state.rows.some(rowHasInput)) {
            const leave = await confirmDialog({ title: 'Leave without adding them?', message: 'The pieces you filled in won’t be added.', confirmLabel: 'Leave', cancelLabel: 'Keep editing' });
            if (!leave) return;
        }
        const onChoose = !$('first-run-choose').classList.contains('hidden');
        const onMissing = !$('first-run-missing').classList.contains('hidden');
        closeModal();
        if (onMissing) state.awaiting = true;           // they will get the offer once they have what was missing
        announce(onChoose ? 'Skipped. ' + startHint() : 'Closed. ' + startHint());
    }

    // ---- the three ways to start ----
    function start(kind) {
        if (kind === 'starter') { resetRows(); openModal('starter', () => $('starter-rows').querySelector('select')); }
        else if (kind === 'demo') addDemo();
        else if (kind === 'photos') addOwnPhotos();
        else if (kind === 'remove-demo') removeDemo();
    }

    // "I'll add my own photos": the same as the welcome card's button. They are told when they can pick an outfit.
    function addOwnPhotos() {
        closeModal();
        state.awaiting = true;
        const closetTab = document.querySelector('.nav-btn[data-tab="closet-view"]');
        if (closetTab) closetTab.click();
        setTimeout(() => {       // after this click has finished, or the page closes the menu it just opened
            const addBtn = $('add-clothes-btn');
            if (addBtn.getAttribute('aria-expanded') !== 'true') addBtn.click();
            const first = $('add-menu-list').querySelector('button:not(.hidden)');
            if (first) first.focus();
        }, 0);
        announce('Add a photo of a piece. Once you have a top and a bottom, or a dress, I’ll offer to suggest an outfit.');
    }

    async function addDemo() {
        if (state.busy) return;
        if ((state.closet || []).some(isDemoItem)) { announce('Demo pieces are already in your closet.'); return; }
        if (!modalOpen()) openModal('choose');
        showStep('choose');
        setBusy(true);
        announce('Adding demo pieces…');
        try {
            await Store.addClosetItems(makeDemoItems());
        } catch (e) {
            console.error('Adding the demo pieces failed', e);
            setBusy(false);
            setMessage('Couldn’t add the demo pieces. Check your connection and try again.');
            $('first-run-demo-btn').focus();
            return;
        }
        setBusy(false);
        afterAdded(makeDemoItems(), 'demo');
    }

    // ---- the starter closet form ----
    const rowHasInput = (r) => !!(r.color || String(r.name || '').trim() || r.photo);
    const newRow = (category) => ({ category: category || 'tops', occasion: 'casual', color: '', name: '', photo: null });
    function resetRows(categories) {
        state.rows = (categories || STARTER_SLOTS).map(newRow);
        renderRows();
    }
    function option(value, text, selected) {
        const o = document.createElement('option');
        o.value = value; o.textContent = text; o.selected = selected;
        return o;
    }
    function rowEl(row, i) {
        const el = document.createElement('div');
        el.className = 'starter-row';
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', `Piece ${i + 1}`);

        const top = document.createElement('div');
        top.className = 'starter-row-top';
        const cat = document.createElement('select');
        cat.className = 'starter-category';
        cat.setAttribute('aria-label', `Kind of piece ${i + 1}`);
        STARTER_CATEGORIES.forEach(c => cat.appendChild(option(c, STARTER_CATEGORY_LABELS[c], c === row.category)));
        cat.addEventListener('change', () => { row.category = cat.value; });
        const occ = document.createElement('select');
        occ.className = 'starter-occasion';
        occ.setAttribute('aria-label', `Occasion for piece ${i + 1}`);
        STARTER_OCCASIONS.forEach(o => occ.appendChild(option(o, STARTER_OCCASION_LABELS[o], o === row.occasion)));
        occ.addEventListener('change', () => { row.occasion = occ.value; });
        top.append(cat, occ);
        if (state.rows.length > 1) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'starter-remove';
            remove.setAttribute('aria-label', `Remove piece ${i + 1}`);
            remove.textContent = '×';
            remove.addEventListener('click', () => { state.rows.splice(i, 1); renderRows(); const next = $('starter-rows').querySelectorAll('.starter-category')[Math.min(i, state.rows.length - 1)]; if (next) next.focus(); });
            top.appendChild(remove);
        }

        const colors = document.createElement('div');
        colors.className = 'starter-colors';
        colors.setAttribute('role', 'radiogroup');
        colors.setAttribute('aria-label', `Color for piece ${i + 1}`);
        STARTER_COLORS.forEach(c => {
            const label = document.createElement('label');
            label.className = 'swatch';
            label.title = c.name;
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'starter-color-' + i;
            input.value = c.hex;
            input.checked = row.color === c.hex;
            input.addEventListener('change', () => { row.color = c.hex; setMessage(''); });
            const dot = document.createElement('span');
            dot.className = 'swatch-dot';
            dot.style.background = c.hex;
            const name = document.createElement('span');
            name.className = 'sr-only';
            name.textContent = c.name;
            label.append(input, dot, name);
            colors.appendChild(label);
        });

        const bottom = document.createElement('div');
        bottom.className = 'starter-row-bottom';
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'starter-name';
        name.maxLength = 60;
        name.placeholder = 'Name (optional)';
        name.value = row.name;
        name.setAttribute('aria-label', `Name for piece ${i + 1} (optional)`);
        name.addEventListener('input', () => { row.name = name.value; });
        const photoLabel = document.createElement('label');
        photoLabel.className = 'starter-photo-btn';
        photoLabel.textContent = row.photo ? 'Change photo' : 'Add a photo (optional)';
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/*';
        file.className = 'starter-photo';
        file.setAttribute('aria-label', `Photo for piece ${i + 1} (optional)`);
        file.addEventListener('change', async () => {
            const picked = file.files && file.files[0];
            file.value = '';
            if (!picked) return;
            try { row.photo = await compressImage(picked); renderRows(); }
            catch (e) { setMessage('Couldn’t read that photo. You can leave it out and add one later.'); }
        });
        photoLabel.appendChild(file);
        bottom.append(name, photoLabel);
        if (row.photo) {
            const preview = document.createElement('img');
            preview.className = 'starter-photo-preview';
            preview.src = row.photo;
            preview.alt = '';
            bottom.appendChild(preview);
        }
        el.append(top, colors, bottom);
        return el;
    }
    function renderRows() {
        const box = $('starter-rows');
        box.innerHTML = '';
        state.rows.forEach((row, i) => box.appendChild(rowEl(row, i)));
        $('starter-add-row-btn').disabled = state.rows.length >= STARTER_MAX;
        refreshCount();
    }
    // The count line under the pieces; it updates as colors are picked.
    function refreshCount() { $('starter-count').textContent = `${state.rows.filter(r => r.color).length} of up to ${STARTER_MAX} pieces ready`; }

    async function saveStarter() {
        if (state.busy) return;
        const { complete, problems } = validateStarterRows(state.rows);
        if (problems.length || complete.length === 0) {
            setMessage(problems.length ? problems[0].text : 'Pick a color for at least one piece to add it, or press Back.');
            const bad = problems.length ? problems[0].index : 0;
            const target = $('starter-rows').querySelectorAll('.starter-row')[bad];
            const swatch = target && target.querySelector('.swatch input');
            if (swatch) swatch.focus();
            return;
        }
        const items = makeStarterItems(state.rows);
        setBusy(true);
        announce('Adding your pieces…');
        try {
            await Store.addClosetItems(items);
        } catch (e) {
            console.error('Adding the starter pieces failed', e);
            setBusy(false);
            setMessage('Couldn’t add your pieces. Check your connection and try again. Nothing you filled in was lost.');
            $('starter-save-btn').focus();
            return;
        }
        setBusy(false);
        afterAdded(items, 'starter');
    }

    // ---- what happens once pieces were added ----
    function afterAdded(added, kind) {
        const known = new Map((state.closet || []).map(i => [i.id, i]));
        added.forEach(i => known.set(i.id, i));
        const readiness = outfitReadiness([...known.values()]);
        if (readiness.ready) showReady(kind === 'demo'
            ? 'Demo pieces added. They’re samples labeled Demo: they don’t count in your wear stats, and one button removes them all whenever you like. Want to pick a first outfit from them for today?'
            : `Your closet has ${pluralize(known.size, 'piece')} now. That’s enough for The Rack to suggest outfits. Want to pick your first one for today?`);
        else showMissing(readiness);
    }
    function showReady(text) {
        $('first-run-ready-text').textContent = text;
        openModal('ready', () => $('first-run-help-btn'));
        announce('Pieces added. Ready to pick your first outfit.');
    }
    function showMissing(readiness) {
        state.lastMissing = readiness.missing || [];
        $('first-run-missing-text').textContent = readiness.message;
        openModal('missing', () => $('first-run-add-more-btn'));
    }
    function addMore() {
        const missing = ['top', 'bottom'].filter(m => (state.lastMissing || []).includes(m)).map(m => m === 'top' ? 'tops' : 'bottoms');
        resetRows([...missing, ...['bottoms', 'tops', 'shoes'].filter(c => !missing.includes(c))].slice(0, 3));
        showStep('starter');
        const first = $('starter-rows').querySelector('select');
        if (first) first.focus();
    }

    // The offer when the closet becomes ready later (the person added their own photos): a quiet bar, never a window that
    // could land on top of whatever they are doing.
    function maybeOffer(items) {
        if (!state.awaiting || state.offered || !state.decided) return;
        if (!outfitReadiness(items).ready) return;
        state.offered = true;
        state.awaiting = false;
        const bar = $('first-run-offer');
        if (!bar) return;
        bar.classList.remove('hidden');
        announce('You have enough pieces to suggest outfits. Help me choose is ready.');
    }
    function hideOffer() { const bar = $('first-run-offer'); if (bar) bar.classList.add('hidden'); }

    // "Help me choose": to the Planner, today's window, with the ideas already showing, so the first outfit is one press away.
    async function startHelpChoose() {
        closeModal();
        hideOffer();
        const plannerTab = document.querySelector('.nav-btn[data-tab="calendar-view"]');
        if (plannerTab) plannerTab.click();
        let readiness = outfitReadiness(plannerCloset);
        for (let n = 0; !readiness.ready && n < 20; n++) { await sleep(200); readiness = outfitReadiness(plannerCloset); }   // the planner's copy of the closet may be a moment behind
        if (!readiness.ready) { showMissing(readiness); return; }
        openDayForPlanning(today());
        HelpChoose.openForDay(today());
    }

    // ---- demo pieces ----
    function renderDemoBanners(items) {
        const any = (items || []).some(isDemoItem);
        document.querySelectorAll('[data-demo-banner]').forEach(b => b.classList.toggle('hidden', !any));
    }
    async function removeDemo() {
        const counts = planDemoCleanup({ closet: liveCloset, schedule: plannerOutfits, saved: liveSavedOutfits }).counts;
        if (counts.pieces === 0) { announce('There are no demo pieces to remove.'); renderDemoBanners(liveCloset); return; }
        const text = describeDemoRemoval(counts);
        const sure = await confirmDialog({ title: 'Remove demo pieces?', message: text.message, note: text.note, confirmLabel: 'Remove demo pieces', danger: true });
        if (!sure) return;
        try {
            const done = await Store.removeDemoData();
            announce(`Removed ${pluralize(done.pieces, 'demo piece')}. Your own pieces and plans were not touched.`);
        } catch (e) {
            console.error('Removing the demo pieces failed', e);
            await confirmDialog({ title: 'Couldn’t remove the demo pieces', message: 'Something went wrong, and nothing of yours was deleted. Check your connection and try again.', confirmLabel: 'OK', cancelLabel: '', danger: false });
        }
    }

    // ---- wiring ----
    function init() {
        const modal = $('first-run-modal');
        if (!modal) return;
        $('first-run-starter-btn').addEventListener('click', () => start('starter'));
        $('first-run-demo-btn').addEventListener('click', () => start('demo'));
        $('first-run-photos-btn').addEventListener('click', () => start('photos'));
        $('first-run-skip-btn').addEventListener('click', requestClose);
        $('starter-add-row-btn').addEventListener('click', () => {
            if (state.rows.length >= STARTER_MAX) return;
            state.rows.push(newRow('tops'));
            renderRows();
            const selects = $('starter-rows').querySelectorAll('.starter-category');
            selects[selects.length - 1].focus();
        });
        $('starter-save-btn').addEventListener('click', saveStarter);
        $('starter-back-btn').addEventListener('click', () => { showStep('choose'); const b = $('first-run-starter-btn'); if (b) b.focus(); });
        $('starter-rows').addEventListener('change', refreshCount);
        $('first-run-help-btn').addEventListener('click', startHelpChoose);
        $('first-run-notnow-btn').addEventListener('click', () => { closeModal(); announce('OK. Press Help me choose in any day of the Planner when you want ideas.'); });
        $('first-run-add-more-btn').addEventListener('click', addMore);
        $('first-run-close-btn').addEventListener('click', requestClose);
        if ($('first-run-offer-btn')) {
            $('first-run-offer-btn').addEventListener('click', startHelpChoose);
            $('first-run-offer-dismiss-btn').addEventListener('click', hideOffer);
        }
        closeOnBackdrop(modal, requestClose);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalOpen() && ModalDialogs.isOpen(modal)) requestClose();
        });
        // Buttons anywhere on the page that start one of the three ways (the empty Closet, the Demo banners).
        document.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-first-run]');
            if (b && b.closest('#first-run-modal') === null) start(b.dataset.firstRun);
        });
    }
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

    return { notePrefs, noteCloset, start, removeDemo };
})();
