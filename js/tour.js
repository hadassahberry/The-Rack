// The ? Help button and the short "Walk me through this page" tours.
//
// A tour only POINTS at real, visible controls and explains one thing about each. It never clicks
// them or calls anything that saves data, so taking a tour cannot create clothes or plans or mark
// anything worn. While it runs the page behind it is blocked (like a dialog: nothing can be pressed by
// accident, Tab stays on the tour's own buttons, and Esc or "Skip tour" always ends it). It stops by
// itself if the person navigates away, and focus goes back to the ? button.

const TOURS = {
    'calendar-view': {
        steps: [
            { target: () => document.getElementById('view-switcher'), title: 'Choose how much to see',
              text: 'Switch between Week, 2 weeks and Month.' },
            { target: () => document.querySelector('.month-nav'), title: 'Move around',
              text: 'Use the arrows to go to earlier or later dates. Press Today to jump back to today.' },
            { target: () => document.querySelector('#month-grid .month-cell.today') || document.querySelector('#month-grid .month-cell:not(.not-current)'),
              title: 'Plan a day',
              text: 'Click a day, or press Enter on it, to open it. There you add pieces from your closet and give the outfit an activity. On today or a past day you can also press Mark as worn. Planning an outfit does not count as wearing it.' },
            { target: () => document.getElementById('add-clothes-btn'), title: 'Add clothes first',
              text: 'You plan outfits from your closet, so start with + Add clothes.' }
        ]
    },
    'closet-view': {
        steps: [
            { target: () => document.getElementById('add-clothes-btn'), title: 'Add a piece',
              text: 'Use + Add clothes to upload or take a photo.' },
            { target: () => document.getElementById('category-tabs'), title: 'Find things',
              text: 'Filter by category here, and by season with the menu above.' },
            { target: () => [...document.querySelectorAll('.build-trigger')].find(b => b.getClientRects().length), title: 'Build an outfit',
              text: 'Tap pieces, name the outfit and save it. Then you can apply it to any day in the Planner.' },
            { target: () => document.querySelector('#full-closet-grid .closet-card'), title: 'Open a piece',
              text: 'Click a piece to change its name, category or how its photo is framed.' },
            { target: () => !document.querySelector('#full-closet-grid .closet-card') ? document.getElementById('full-closet-grid') : null, title: 'Your clothes appear here',
              text: 'Nothing is here yet. Add some with + Add clothes and they will show up in this space.' }
        ]
    },
    'analytics-view': {
        steps: [
            { target: () => { const n = document.getElementById('stat-total-wears'); return n ? n.closest('.stat-card') : null; }, title: 'Total item wears',
              text: 'This counts each piece in an outfit you marked as worn. Planning an outfit does not count; you mark outfits as worn in the Planner.' },
            { target: () => { const n = document.getElementById('wear-unmarked'); return n && !n.classList.contains('hidden') ? n : null; }, title: 'Plans nobody marked',
              text: 'Past plans you never marked as worn are not counted. You can mark them here, or open that day in the Planner.' },
            { target: () => document.getElementById('analytics-most-worn'), title: 'Most worn pieces',
              text: 'Your most-worn pieces appear here once you have marked some outfits as worn.' }
        ]
    }
};

const Tour = (function () {
    const $ = (id) => document.getElementById(id);
    let active = null;           // { steps, index, viewId, layer, card, spot, ... } while a tour runs

    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isShown = (el) => {
        if (!el || !el.isConnected || !el.getClientRects().length) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const currentViewId = () => { const v = document.querySelector('.view-section.active'); return v ? v.id : null; };
    const tourForCurrentPage = () => TOURS[currentViewId()] || null;

    function build() {
        const layer = document.createElement('div');
        layer.id = 'tour-layer';
        layer.innerHTML = `
            <div class="tour-spotlight" aria-hidden="true"></div>
            <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" tabindex="-1">
                <p class="tour-progress" id="tour-progress"></p>
                <h3 id="tour-title"></h3>
                <p id="tour-text" class="tour-text" role="status" aria-live="polite"></p>
                <div class="tour-actions">
                    <button type="button" class="secondary-btn" id="tour-back">Back</button>
                    <button type="button" class="primary-btn" id="tour-next">Next</button>
                    <button type="button" class="link-btn" id="tour-skip">Skip tour</button>
                </div>
            </div>`;
        document.body.appendChild(layer);
        return layer;
    }

    // Phones, and any screen where the floating card would take up a big share of the height (large text, a short
    // window), show the explanation as a panel along the bottom instead, so it never has to sit on the control.
    function useSheet(card) {
        if (document.documentElement.clientWidth <= 640) { card.classList.add('is-sheet'); return true; }
        card.classList.remove('is-sheet');
        const sheet = card.offsetHeight > window.innerHeight * 0.4;
        card.classList.toggle('is-sheet', sheet);
        return sheet;
    }

    // ---- placing the highlight and the explanation ----
    function place() {
        if (!active) return;
        const target = active.target;
        const card = active.card, spot = active.spot;
        if (!isShown(target)) { spot.style.display = 'none'; return; }
        const pad = 6, vw = document.documentElement.clientWidth, vh = window.innerHeight;
        const r = target.getBoundingClientRect();
        spot.style.display = 'block';
        spot.style.left = `${r.left - pad}px`; spot.style.top = `${r.top - pad}px`;
        spot.style.width = `${r.width + pad * 2}px`; spot.style.height = `${r.height + pad * 2}px`;

        const sheet = useSheet(card);
        if (sheet) { card.style.left = ''; card.style.top = ''; return; }
        const w = card.offsetWidth, h = card.offsetHeight, gap = 12;
        const clampLeft = (x) => Math.min(Math.max(12, x), Math.max(12, vw - w - 12));
        const clampTop = (y) => Math.min(Math.max(12, y), Math.max(12, vh - h - 12));
        let top, left = clampLeft(r.left);
        if (r.bottom + pad + gap + h <= vh - 12) top = r.bottom + pad + gap;                // below the control
        else if (r.top - pad - gap - h >= 12) top = r.top - pad - gap - h;                  // above it
        else if (r.right + pad + gap + w <= vw - 12) { left = r.right + pad + gap; top = clampTop(r.top); }       // beside it (a tall control, such as a day)
        else if (r.left - pad - gap - w >= 12) { left = r.left - pad - gap - w; top = clampTop(r.top); }
        else top = clampTop(vh - h - 12);                                                   // nowhere beside it: along the bottom
        card.style.top = `${top}px`;
        card.style.left = `${left}px`;
    }

    // Scrolls so the control is fully in view and not hidden behind the explanation.
    function bringIntoView() {
        const t = active.target, card = active.card;
        const vw = document.documentElement.clientWidth, vh = window.innerHeight;
        const sheet = useSheet(card);
        const r = t.getBoundingClientRect();
        const topLimit = 12, pad = 6, gap = 12;
        const bottomLimit = sheet ? vh - card.offsetHeight - 20 : vh - 12;
        const room = bottomLimit - topLimit;
        let desiredTop;
        if (r.height >= room) desiredTop = topLimit;                                  // taller than the space: start at its top
        else desiredTop = topLimit + (room - r.height) / (sheet ? 2 : 3);             // otherwise roughly centred in what's visible
        if (!sheet) {
            // Leave room for the explanation BELOW the control when it fits; if the control is too tall for that,
            // put it at the top and the explanation goes beside it (see place()).
            const maxTop = vh - 12 - card.offsetHeight - gap - pad - r.height - pad;
            const minTop = topLimit + pad;
            desiredTop = maxTop >= minTop ? Math.min(Math.max(desiredTop, minTop), maxTop) : minTop;
        }
        const delta = r.top - desiredTop;
        if (Math.abs(delta) > 2) window.scrollBy({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    function schedulePlace() {
        if (!active || active.raf) return;
        active.raf = requestAnimationFrame(() => { if (active) { active.raf = 0; place(); } });
    }

    // ---- moving between steps ----
    // Finds the next step in direction `dir` whose control is actually on screen; steps whose control isn't
    // there are skipped, never pointed at blank space.
    function goTo(index, dir) {
        let i = index;
        while (i >= 0 && i < active.steps.length) {
            const el = active.steps[i].target();
            if (isShown(el)) { render(i, el); return true; }
            i += dir;
        }
        return false;
    }

    function render(i, el) {
        const step = active.steps[i];
        active.index = i; active.target = el;
        // Numbered by the steps that can actually be shown right now, so a skipped step never leaves a gap.
        const shown = active.steps.map((s, j) => j === i || isShown(s.target()));
        const total = shown.filter(Boolean).length;
        const position = shown.slice(0, i + 1).filter(Boolean).length;
        $('tour-progress').textContent = `Step ${position} of ${total}`;
        $('tour-title').textContent = step.title;
        $('tour-text').textContent = step.text;
        const last = position === total;
        $('tour-back').hidden = i === 0;
        $('tour-next').textContent = last ? 'Done' : 'Next';
        $('tour-skip').hidden = last;
        // if the button that had focus has just been hidden, keep focus on a visible one
        const focused = document.activeElement;
        if (!focused || focused === document.body || focused.hidden || !active.card.contains(focused)) $('tour-next').focus();
        bringIntoView();
        place();
    }

    function next() { if (!goTo(active.index + 1, 1)) stop(); }
    function back() { goTo(active.index - 1, -1); }

    // ---- starting and stopping ----
    async function start() {
        if (active) return;
        const viewId = currentViewId();
        const tour = TOURS[viewId];
        if (!tour) return;
        // Only steps whose control is on screen right now are part of this tour.
        const steps = tour.steps.filter(s => isShown(s.target()));
        if (steps.length === 0) {
            await confirmDialog({ title: 'Nothing to point at yet', message: 'This page doesn’t have anything to show yet. Try Getting started in the Help menu.', confirmLabel: 'OK', cancelLabel: '', danger: false });
            return;
        }
        const layer = build();
        // Temporary empty space at the end of the page, so even a control near the bottom (or on a short page) can be
        // scrolled up far enough to leave room for its explanation. Removed when the tour ends.
        const spacer = document.createElement('div');
        spacer.id = 'tour-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        spacer.style.height = '70vh';
        document.body.appendChild(spacer);
        active = { steps, index: 0, viewId, layer, spacer, card: layer.querySelector('.tour-card'), spot: layer.querySelector('.tour-spotlight'), target: null, raf: 0, cleanups: [] };

        $('tour-next').addEventListener('click', next);
        $('tour-back').addEventListener('click', back);
        $('tour-skip').addEventListener('click', () => stop());
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); } };
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', schedulePlace);
        window.addEventListener('scroll', schedulePlace, true);
        // Anything that moves the person off this page ends the tour.
        const watcher = new MutationObserver(() => {
            if (active && (currentViewId() !== active.viewId || $('app-shell').classList.contains('hidden'))) stop();
        });
        document.querySelectorAll('.view-section').forEach(v => watcher.observe(v, { attributes: true, attributeFilter: ['class'] }));
        watcher.observe($('app-shell'), { attributes: true, attributeFilter: ['class'] });
        const onNav = () => stop();
        window.addEventListener('popstate', onNav);
        window.addEventListener('hashchange', onNav);
        active.cleanups.push(() => {
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', schedulePlace);
            window.removeEventListener('scroll', schedulePlace, true);
            window.removeEventListener('popstate', onNav);
            window.removeEventListener('hashchange', onNav);
            watcher.disconnect();
        });

        // The page behind is blocked, focus goes to the tour, and ending it returns focus to the ? button.
        ModalDialogs.open(active.card, { initialFocus: $('tour-next'), returnTo: () => $('help-btn') });
        goTo(0, 1);
    }

    function stop() {
        if (!active) return;
        const a = active;
        active = null;
        a.cleanups.forEach(fn => fn());
        if (a.raf) cancelAnimationFrame(a.raf);
        ModalDialogs.close(a.card);                          // first, so focus can go back to the ? button; then remove the tour
        a.layer.remove();
        a.spacer.remove();
    }

    function isRunning() { return !!active; }

    return { start, stop, isRunning, available: () => !!tourForCurrentPage() };
})();

// ---- the ? Help button and its menu ----
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const btn = $('help-btn'), list = $('help-menu-list'), wrap = $('help-menu');
    if (!btn) return;
    const tourItem = $('help-tour-btn'), startItem = $('help-start-btn');
    const visibleItems = () => [tourItem, startItem].filter(i => !i.hidden);

    function setOpen(open) {
        list.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', String(open));
        if (open) {
            tourItem.hidden = !Tour.available();                 // Settings has no tour: just "Getting started"
            visibleItems()[0].focus();
        }
    }
    btn.addEventListener('click', () => setOpen(list.classList.contains('hidden')));
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) setOpen(false); });
    wrap.addEventListener('focusout', (e) => { if (!list.classList.contains('hidden') && e.relatedTarget && !wrap.contains(e.relatedTarget)) setOpen(false); });
    list.addEventListener('keydown', (e) => {
        const items = visibleItems(), i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.focus(); }
    });
    tourItem.addEventListener('click', () => { setOpen(false); Tour.start(); });
    startItem.addEventListener('click', () => { setOpen(false); Welcome.openHelp(); });
});

if (typeof module !== 'undefined') {
    module.exports = { TOURS };
}
