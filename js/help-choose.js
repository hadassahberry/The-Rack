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

    // Demo pieces are only used while the person's own pieces can't make an outfit yet (suggestionPool, js/outfit-suggest.js).
    // Pieces still waiting to be tagged have a guessed category, so they are left out (and the person is told).
    const pool = suggestionPool(env.closet || []);
    const closet = pool.filter(i => i.tagged !== false);
    return {
        skippedUntagged: pool.length - closet.length,
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

// What to tell the person when they pressed a refinement and the ideas did not change. '' when something did change.
//   action: 'casual' | 'dressy' | 'warmer' | 'lighter' | 'keep' | 'text' | 'more';  clamped: the setting was already at its limit.
function refinementOutcome({ action, before, after, clamped }) {
    const limit = { casual: 'casual', dressy: 'dressy', warmer: 'warm', lighter: 'light' };           // "as casual as I'll go"
    const wanted = { casual: 'more casual', dressy: 'more dressy', warmer: 'warmer', lighter: 'lighter' };   // "anything warmer"
    if (clamped && limit[action]) return `That’s as ${limit[action]} as I’ll go, so these are the same ideas.`;
    const a = [...(before || [])].sort().join('|'), b = [...(after || [])].sort().join('|');
    if (a !== b) return '';
    if (wanted[action]) return `I couldn’t find anything ${wanted[action]} in your closet, so these are still the best matches.`;
    if (action === 'keep') return 'Nothing else in your closet works with that piece, so these are the same ideas.';
    if (action === 'text') return 'That didn’t change my ideas: these are still the best matches.';
    if (action === 'more') return 'I don’t have any different ideas. This is everything I can put together from your closet.';
    return '';
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

    // After a refinement button: if the ideas are the same as before, say so (instead of quietly showing the same choices).
    function noteIfUnchanged(mine, shown) {
        const cmp = mine.compare;
        mine.compare = null;
        if (!cmp) return;
        mine.sameNote = refinementOutcome({ action: cmp.action, before: cmp.before, after: shown.map(s => s.signature), clamped: cmp.clamped });
    }

    // One line about the day for the visual check (it is told the occasion and the weather, nothing else about the person).
    function dayLine(ctx, result) {
        const bits = [];
        const w = result.need.weather;
        if (w.has && ctx.weather) bits.push(`${Math.round(ctx.weather.high)}F high${w.snow ? ', snow' : w.rain ? ', rain' : ''}`);
        result.need.formality.events.slice(0, 3).forEach(e => bits.push(e.text));
        return bits.join('; ');
    }

    // The rules pick the candidates; if the visual check is on, it judges them (one call) and may veto or re-rank
    // them. If it is off, unavailable or fails, the rules' own ranking is shown, as it always was.
    async function run(focusAction) {
        const mine = state;
        const env = liveEnv();
        const ctx = buildDayContext(mine.dateKey, env);
        const deps = liveVisionDeps();
        const visionOn = deps.enabled();
        const result = suggestOutfits(ctx, { ...mine.refine, exclude: mine.exclude, max: visionOn ? 5 : 3 });    // a few extra, so a vetoed one can be replaced
        mine.ctx = ctx;
        mine.visionNote = '';
        mine.vetoNote = '';
        mine.sameNote = '';
        if (!visionOn || result.suggestions.length === 0) {
            mine.result = result;
            noteIfUnchanged(mine, result.suggestions.slice(0, 3));
            render(focusAction);
            return;
        }

        const token = ++mine.token;
        mine.result = result;
        renderChecking();
        const closetById = Object.fromEntries((ctx.items || []).map(i => [i.id, i]));
        const check = await runVisionCheck({ suggestions: result.suggestions, closetById, context: dayLine(ctx, result), deps, cache: mine.cache });
        if (state !== mine || mine.token !== token) return;                       // closed, or run again, while it was checking
        mine.cache = check.verdicts;
        if (check.sent) mine.sent = true;
        const final = finalizeSuggestions(result.suggestions, check, { show: 3 });        // vetoed and re-ranked, or the rules' own ranking if the check didn't work
        mine.result = { ...result, suggestions: final.shown };
        mine.vetoNote = final.vetoNote;
        mine.visionNote = final.visionNote;
        noteIfUnchanged(mine, final.shown);
        render(focusAction);
    }

    function renderChecking() {
        const box = state.box;
        box.innerHTML = '';
        box.classList.remove('hidden');
        const head = document.createElement('div');
        head.className = 'choose-head';
        const title = document.createElement('strong');
        title.id = `${box.id}-title`;
        title.tabIndex = -1;
        title.textContent = `Ideas from your closet for ${state.kind === 'builder' ? 'today' : dayLabel(state.dateKey)}`;
        head.append(title, button('Close', 'close', 'link-btn'));
        box.appendChild(head);
        box.setAttribute('aria-labelledby', title.id);
        const p = document.createElement('p');
        p.className = 'choose-checking';
        p.setAttribute('role', 'status');
        p.textContent = 'Checking how these look together…';
        box.appendChild(p);
        box.appendChild(privacyNote());
        title.focus({ preventScroll: true });
    }

    function privacyNote() {
        const p = document.createElement('p');
        p.className = 'choose-privacy';
        p.textContent = 'To check how they look together, photos of the pieces in these ideas are sent to Google’s Gemini AI. ' +
            'Only those photos, and only when you press Help me choose. On Google’s free tier, Google may use them to improve its products.';
        return p;
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
            let past = null;
            if (s.past) {                                                // a combination you actually wore about 3-4 weeks ago
                past = document.createElement('p');
                past.className = 'choose-past';
                past.textContent = s.past.text;
            }
            let demo = null;
            if (s.itemIds.some(id => closetById[id] && closetById[id].demo === true)) {       // sample pieces from the first-run setup: say so
                demo = document.createElement('p');
                demo.className = 'choose-demo';
                demo.append(demoBadge(), document.createTextNode(' Includes demo pieces: sample pieces, not part of your own closet.'));
            }
            let look = null;
            if (s.vision && s.vision.reason) {                           // what the visual check said about these pieces together
                look = document.createElement('p');
                look.className = 'choose-look' + (s.flagged ? ' is-flagged' : '');
                look.textContent = (s.flagged ? 'May not look right together: ' : 'Looks good together: ') + s.vision.reason;
            }
            const use = button('Use this outfit', `use:${n}`, 'primary-btn');
            use.setAttribute('aria-label', `Use idea ${n + 1}: ${s.pieces.map(p => p.name).join(', ')}`);
            card.append(thumbs, names, reason);
            if (past) card.appendChild(past);
            if (demo) card.appendChild(demo);
            if (look) card.appendChild(look);
            card.appendChild(use);
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
            const main = first.pieces.filter(p => p.category === 'dresses' || p.category === 'bottoms' || p.category === 'tops').sort((a, b) => ['dresses', 'bottoms', 'tops'].indexOf(a.category) - ['dresses', 'bottoms', 'tops'].indexOf(b.category)).slice(0, 2);
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
        if (state.vetoNote) notes.push(state.vetoNote);
        if (state.visionNote) notes.push(state.visionNote);
        if (state.sameNote) notes.unshift(state.sameNote);
        if (result.heard.length) notes.unshift(`I used: ${result.heard.join(', ')}.`);
        if (notes.length) {
            const p = document.createElement('p');
            p.className = 'choose-notes';
            p.textContent = notes.join(' ');
            box.appendChild(p);
        }
        if (state.sent) box.appendChild(privacyNote());

        // the cards were redrawn, so put keyboard focus back on what was pressed (or on the heading)
        const target = focusAction && box.querySelector(`[data-action="${focusAction}"]`);
        (target || box.querySelector('.choose-head strong')).focus({ preventScroll: !target });
    }

    // ---- what the buttons do ----
    function apply(action) {
        const r = state.refine;
        const clamp2 = (n) => Math.max(-2, Math.min(2, n));
        const before = state.result ? state.result.suggestions.map(s => s.signature) : [];
        const was = { f: r.formalityShift, w: r.warmthShift };
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
        const kind = ['casual', 'dressy', 'warmer', 'lighter', 'more', 'text'].includes(action) ? action : (action.startsWith('keep:') ? 'keep' : '');
        const clamped = (action === 'casual' || action === 'dressy') ? was.f === r.formalityShift : (action === 'warmer' || action === 'lighter') ? was.w === r.warmthShift : false;
        state.compare = kind ? { action: kind, before, clamped } : null;
        run(action);                           // focus goes back to the button that was pressed (or the heading if it is gone)
    }

    // Outfits already planned on the day that this idea could take the place of: the highlighted one first, never one
    // marked as worn (that is a record). (Pure of the page apart from reading plannerOutfits / activeOutfitId.)
    function replaceableOutfits(dateKey) {
        const day = (plannerOutfits[dateKey] || []).filter(o => o.itemIds.length > 0 && !o.worn);
        return day.sort((a, b) => (b.id === activeOutfitId) - (a.id === activeOutfitId));
    }
    const dayHasPieces = (dateKey) => (plannerOutfits[dateKey] || []).some(o => o.itemIds.length > 0);

    // The person picked one. For the builder it fills the selection. For a day: if the day already has pieces planned they
    // are asked whether to replace the planned outfit or add this one as another (nothing is decided for them); an
    // identical outfit that is already planned is just reported, as with a saved outfit.
    function use(n) {
        const s = state.result.suggestions[n];
        if (!s) return;
        if (state.kind === 'day' && dayHasPieces(state.dateKey) && !alreadyPlanned(state.dateKey, s.itemIds)) { askReplaceOrAdd(n); return; }
        commit(n, 'auto', null);
    }

    function alreadyPlanned(dateKey, itemIds) {
        return (plannerOutfits[dateKey] || []).some(o => o.itemIds.length > 0 && sameItemSet(o.itemIds, itemIds));
    }

    // The only place anything is added to the planner (or the builder). mode: 'auto' | 'add' | 'replace'.
    function commit(n, mode, targetId) {
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
            applySavedOutfit({ id: 'suggestion', name: 'Suggested outfit', itemIds: [...s.itemIds] }, { mode, targetId });     // the same path as a saved outfit: with its notice and Undo
            const notice = document.getElementById('apply-status');
            if (notice && notice.scrollIntoView) notice.scrollIntoView({ block: 'nearest' });                                 // so the notice and its Undo are seen
        }
        if (button) button.focus();
    }

    function askReplaceOrAdd(n) {
        const card = state.box.querySelectorAll('.choose-card')[n];
        if (!card) return;
        const old = card.querySelector('.choose-ask');
        if (old) old.remove();
        const ask = document.createElement('div');
        ask.className = 'choose-ask';
        ask.setAttribute('role', 'group');
        const q = document.createElement('p');
        q.className = 'choose-ask-text';
        q.id = `${state.box.id}-ask-${n}`;
        q.textContent = 'This day already has an outfit planned. What should I do with this idea?';
        ask.setAttribute('aria-labelledby', q.id);
        ask.appendChild(q);
        const targets = replaceableOutfits(state.dateKey);
        if (targets.length) {
            const t = targets[0];
            const label = t.label ? `your “${t.label}” outfit` : 'the planned outfit';
            ask.appendChild(button(`Replace ${label}`, `replace:${n}:${t.id}`, 'primary-btn'));
        }
        ask.appendChild(button('Add as another outfit', `another:${n}`, targets.length ? 'secondary-btn' : 'primary-btn'));
        ask.appendChild(button('Cancel', `cancelask:${n}`, 'link-btn'));
        card.querySelector('[data-action^="use:"]').hidden = true;
        card.appendChild(ask);
        ask.querySelector('button').focus();
    }

    function cancelAsk(n) {
        const card = state.box.querySelectorAll('.choose-card')[n];
        if (!card) return;
        const ask = card.querySelector('.choose-ask'); if (ask) ask.remove();
        const use = card.querySelector('[data-action^="use:"]'); use.hidden = false; use.focus();
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
        state = { kind, dateKey, box, button, refine: freshRefine(), exclude: [], result: null, ctx: null, token: 0, cache: {}, sent: false, visionNote: '', vetoNote: '', sameNote: '', compare: null };
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
                else if (action.startsWith('replace:')) { const [, n, id] = action.split(':'); commit(Number(n), 'replace', id); }
                else if (action.startsWith('another:')) commit(Number(action.slice(8)), 'add', null);
                else if (action.startsWith('cancelask:')) cancelAsk(Number(action.slice(10)));
                else apply(action);
            });
        });
    }
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

    // The first-run offer: Help me choose for one day, opened inside that day's planning window.
    function openForDay(dateKey) {
        const dayBtn = $('help-choose-btn');
        if (!dayBtn || !$('choose-panel')) return false;
        open('day', dayBtn, $('choose-panel'), dateKey);
        return true;
    }

    return { open, close, reset, openForDay };
})();

if (typeof module !== 'undefined') {
    module.exports = { buildDayContext, refinementOutcome };
}
