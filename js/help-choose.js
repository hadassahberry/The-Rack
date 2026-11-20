// "Help me choose": the buttons, the suggestion cards and the refinements. The thinking is in js/outfit-suggest.js
// (plain JavaScript on this device: no network, no AI service, no cost).
//
// Nothing is written anywhere until the person presses "Use this outfit": showing, refining and re-running
// suggestions only reads the closet, the forecast already on the device, the calendar and the wear history.
//
// buildDayContext() turns what the app already knows about a day into the input outfit-suggest.js wants. It takes
// its data through `env` (the live app by default) so it can be tested without a page.

// ---- what the app knows about a day ----
function buildDayContext(dateKey, env) {
    const prefs = env.prefs || {};
    const key = (d) => d;
    const hebrewOn = !!prefs.hebrewCalendarEnabled;
    const holidayInfo = (k) => (hebrewOn && env.holidayInfoFor ? env.holidayInfoFor(k) : null);
    const isYomTovOn = (k) => { const h = holidayInfo(k); return !!(h && (h.holidays || []).some(x => x.yomtov)); };
    const dow = (k) => new Date(k + 'T00:00:00').getDay();
    const isSpecial = (k) => hebrewOn && (dow(k) === 5 || dow(k) === 6 || isYomTovOn(k));      // Friday, Shabbos and Yom Tov days

    const dayOutfits = (env.outfitsByDate && env.outfitsByDate[dateKey]) || [];
    const texts = dayOutfits.map(o => String(o.label || '').trim()).filter(Boolean);
    const info = holidayInfo(dateKey);
    ((info && info.holidays) || []).forEach(h => { if (!h.yomtov) texts.push(h.title); });         // Yom Tov itself is a flag below
    (env.otherNotesFor ? env.otherNotesFor(dateKey) : []).forEach(t => texts.push(t));            // public / Christian / Islamic holidays

    const worn = [];
    Object.keys(env.outfitsByDate || {}).forEach(k => {
        (env.outfitsByDate[k] || []).forEach(o => { if (o.worn && o.itemIds && o.itemIds.length) worn.push({ date: k, itemIds: o.itemIds }); });
    });

    const weekendPlanned = [];
    specialRunOthers(dateKey, isSpecial).forEach(k => {
        ((env.outfitsByDate && env.outfitsByDate[k]) || []).forEach(o => { if (o.itemIds && o.itemIds.length) weekendPlanned.push({ date: k, itemIds: o.itemIds }); });
    });

    // Pieces still waiting to be tagged have a guessed category, so they are left out (and the person is told).
    const closet = (env.closet || []).filter(i => i.tagged !== false);
    return {
        skippedUntagged: (env.closet || []).length - closet.length,
        items: closet,
        dateKey,
        weather: prefs.weatherEnabled && env.forecastFor ? env.forecastFor(dateKey) : null,
        texts,
        isShabbat: hebrewOn && dow(dateKey) === 6,
        isYomTov: isYomTovOn(dateKey),
        worn,
        weekendPlanned
    };
}

const HelpChoose = (function () {
    const $ = (id) => document.getElementById(id);
    let state = null;          // { kind: 'day' | 'builder', dateKey, box, button, refine, exclude, result }

    function liveEnv() {
        const location = Location.get();
        const todayKey = isoDateKey(new Date());
        const forecastMap = location && Store.getPrefs().weatherEnabled ? Weather.getForecastMap(location) : {};
        return {
            closet: plannerCloset,
            outfitsByDate: plannerOutfits,
            prefs: Store.getPrefs(),
            holidayInfoFor: (k) => getHolidayInfo(new Date(k + 'T00:00:00'), location, {}),
            forecastFor: (k) => weatherFor(k, forecastMap, todayKey).forecast,
            otherNotesFor: (k) => extraCalendarNotes(new Date(k + 'T00:00:00'), Store.getPrefs(), location).notes.map(n => n.text)
        };
    }

    const freshRefine = () => ({ formalityShift: 0, warmthShift: 0, keepIds: [], text: '' });

    function dayLabel(dateKey) {
        const d = new Date(dateKey + 'T00:00:00');
        return `${WEEKDAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
    }

    function basisText(result, ctx) {
        const bits = [];
        const w = result.need.weather;
        if (w.has) {
            const temp = `${formatTemp(ctx.weather.low)}–${formatTemp(ctx.weather.high, true)}`;
            bits.push(w.snow ? `${temp}, snow` : w.rain ? `${temp}, rain` : temp);
        } else {
            bits.push('no forecast for this day, so the weather wasn’t used');
        }
        result.need.formality.events.slice(0, 3).forEach(e => bits.push(e.text));
        bits.push('nothing worn in the last 7 days');
        return `Based on: ${bits.join(' · ')}.`;
    }

    function run(focusAction) {
        const env = liveEnv();
        const ctx = buildDayContext(state.dateKey, env);
        const result = suggestOutfits(ctx, { ...state.refine, exclude: state.exclude });
        state.result = result;
        state.ctx = ctx;
        render(focusAction);
    }

    // ---- drawing ----
    function button(text, action, cls = 'secondary-btn') {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `${cls} choose-btn`;
        b.dataset.action = action;
        b.textContent = text;
        return b;
    }

    function render(focusAction) {
        const box = state.box;
        const result = state.result;
        box.innerHTML = '';
        box.classList.remove('hidden');

        const head = document.createElement('div');
        head.className = 'choose-head';
        const title = document.createElement('strong');
        title.id = `${box.id}-title`;
        title.tabIndex = -1;
        title.textContent = `Ideas from your closet for ${state.kind === 'builder' ? 'today' : dayLabel(state.dateKey)}`;
        const close = button('Close', 'close', 'link-btn');
        head.append(title, close);
        box.appendChild(head);
        box.setAttribute('aria-labelledby', title.id);

        const basis = document.createElement('p');
        basis.className = 'choose-basis';
        basis.textContent = basisText(result, state.ctx);
        box.appendChild(basis);

        if (result.suggestions.length === 0) {
            const none = document.createElement('p');
            none.className = 'choose-empty';
            none.textContent = result.notes[0] || 'I couldn’t put an outfit together from your closet yet.';
            box.appendChild(none);
        }

        const cards = document.createElement('div');
        cards.className = 'choose-cards';
        const closetById = Object.fromEntries((state.ctx.items || []).map(i => [i.id, i]));
        result.suggestions.forEach((s, n) => {
            const card = document.createElement('article');
            card.className = 'choose-card';
            card.setAttribute('aria-label', `Idea ${n + 1} of ${result.suggestions.length}`);
            const thumbs = document.createElement('div');
            thumbs.className = 'choose-thumbs';
            thumbs.setAttribute('aria-hidden', 'true');
            s.itemIds.forEach(id => { const item = closetById[id]; if (item) thumbs.appendChild(itemThumb(item, 'choose-thumb', '')); });
            const names = document.createElement('p');
            names.className = 'choose-names';
            names.textContent = s.pieces.map(p => p.name).join(' · ');
            const reason = document.createElement('p');
            reason.className = 'choose-reason';
            reason.textContent = s.reason;
            const use = button('Use this outfit', `use:${n}`, 'primary-btn');
            use.setAttribute('aria-label', `Use idea ${n + 1}: ${s.pieces.map(p => p.name).join(', ')}`);
            card.append(thumbs, names, reason, use);
            cards.appendChild(card);
        });
        box.appendChild(cards);

        if (result.suggestions.length) {
            const refine = document.createElement('div');
            refine.className = 'choose-refine';
            refine.setAttribute('role', 'group');
            refine.setAttribute('aria-label', 'Change these ideas');
            refine.append(button('More casual', 'casual'), button('More dressy', 'dressy'), button('Warmer', 'warmer'), button('Lighter', 'lighter'));
            const first = result.suggestions[0];
            // the pieces an outfit is built around: the dress, or the bottom and the top (not its cardigan or coat)
            const main = first.pieces.filter(p => p.category === 'dresses' || p.category === 'bottoms' || (p.category === 'tops' && p.layer !== 'mid')).sort((a, b) => ['dresses', 'bottoms', 'tops'].indexOf(a.category) - ['dresses', 'bottoms', 'tops'].indexOf(b.category)).slice(0, 2);
            main.forEach(p => {
                const kept = state.refine.keepIds.includes(p.id);
                refine.appendChild(button(kept ? `Stop keeping the ${p.name}` : `Keep the ${p.name}, change the rest`, `keep:${p.id}`));
            });
            refine.append(button('Different ideas', 'more'));
            box.appendChild(refine);

            const textRow = document.createElement('div');
            textRow.className = 'choose-text';
            const input = document.createElement('input');
            input.type = 'text';
            input.id = `${box.id}-text`;
            input.maxLength = 80;
            input.value = state.refine.text;
            input.placeholder = 'Anything specific? e.g. teaching then going out';
            input.setAttribute('aria-label', 'Anything specific? (optional)');
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply('text'); } });
            textRow.append(input, button('Update', 'text'));
            box.appendChild(textRow);
        }

        const hasChanges = state.refine.formalityShift || state.refine.warmthShift || state.refine.keepIds.length || state.refine.text || state.exclude.length;
        if (hasChanges) box.appendChild(button('Start over', 'reset', 'link-btn'));

        const notes = [...result.notes.slice(result.suggestions.length === 0 ? 1 : 0)];
        if (result.heard.length) notes.unshift(`I used: ${result.heard.join(', ')}.`);
        if (notes.length) {
            const p = document.createElement('p');
            p.className = 'choose-notes';
            p.textContent = notes.join(' ');
            box.appendChild(p);
        }

        // the cards were redrawn, so put keyboard focus back on what was pressed (or on the heading)
        const target = focusAction && box.querySelector(`[data-action="${focusAction}"]`);
        (target || box.querySelector('.choose-head strong')).focus({ preventScroll: !target });
    }

    // ---- what the buttons do ----
    function apply(action) {
        const r = state.refine;
        const clamp2 = (n) => Math.max(-2, Math.min(2, n));
        if (action === 'casual') r.formalityShift = clamp2(r.formalityShift - 1);
        else if (action === 'dressy') r.formalityShift = clamp2(r.formalityShift + 1);
        else if (action === 'warmer') r.warmthShift = clamp2(r.warmthShift + 1);
        else if (action === 'lighter') r.warmthShift = clamp2(r.warmthShift - 1);
        else if (action === 'text') { const input = state.box.querySelector('input[type="text"]'); r.text = input ? input.value.trim() : ''; state.exclude = []; }
        else if (action === 'more') state.exclude = [...new Set([...state.exclude, ...state.result.suggestions.map(s => s.signature)])];
        else if (action === 'reset') { state.refine = freshRefine(); state.exclude = []; }
        else if (action.startsWith('keep:')) {
            const id = action.slice(5);
            r.keepIds = r.keepIds.includes(id) ? r.keepIds.filter(x => x !== id) : [...r.keepIds, id];
        }
        if (['casual', 'dressy', 'warmer', 'lighter'].includes(action) || action.startsWith('keep:')) state.exclude = [];    // a new direction: start from the best again
        run(action);                           // focus goes back to the button that was pressed (or the heading if it is gone)
    }

    // The only place anything is added: the person picked one.
    function use(n) {
        const s = state.result.suggestions[n];
        if (!s) return;
        const kind = state.kind, button = state.button;
        close(false);
        if (kind === 'builder') {
            outfitBuilderSelectedIds = [...s.itemIds];
            renderCloset();
            renderBuildBar();
            setBuilderMessage(`Picked ${pluralize(s.itemIds.length, 'piece')} for you. Change them if you like, name the outfit and press Save outfit.`);
        } else {
            applySavedOutfit({ id: 'suggestion', name: 'Suggested outfit', itemIds: [...s.itemIds] });     // the same path as a saved outfit: with its notice and Undo
        }
        if (button) button.focus();
    }

    function close(refocus = true) {
        if (!state) return;
        state.box.classList.add('hidden');
        state.box.innerHTML = '';
        const button = state.button;
        state = null;
        if (refocus && button) button.focus();
    }

    function open(kind, button, box, dateKey) {
        state = { kind, dateKey, box, button, refine: freshRefine(), exclude: [], result: null, ctx: null };
        run();
    }

    function reset() {                         // a different day (or window) was opened: nothing carries over
        document.querySelectorAll('.choose-panel').forEach(b => { b.classList.add('hidden'); b.innerHTML = ''; });
        state = null;
    }

    function init() {
        const dayBtn = $('help-choose-btn'), builderBtn = $('build-help-btn');
        if (!dayBtn) return;
        dayBtn.addEventListener('click', () => open('day', dayBtn, $('choose-panel'), selectedDateKey));
        if (builderBtn) builderBtn.addEventListener('click', () => open('builder', builderBtn, $('build-choose-panel'), isoDateKey(new Date())));
        document.querySelectorAll('.choose-panel').forEach(box => {
            box.addEventListener('click', (e) => {
                const b = e.target.closest('button[data-action]');
                if (!b || !state || state.box !== box) return;
                const action = b.dataset.action;
                if (action === 'close') close();
                else if (action.startsWith('use:')) use(Number(action.slice(4)));
                else apply(action);
            });
        });
    }
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

    return { open, close, reset };
})();

if (typeof module !== 'undefined') {
    module.exports = { buildDayContext };
}
