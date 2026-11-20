// The visual check for "Help me choose": after the rule-based engine (js/outfit-suggest.js) has picked candidate
// outfits from pieces the person owns, the photos of those pieces are sent, in ONE call, to a vision model (Google
// Gemini, through the Firebase function in /functions) that judges whether the pieces actually go together:
// patterns, colours, formality, proportions, the overall look. The verdicts only ever VETO or RE-RANK the
// candidates; the engine still decides what is a candidate (weather, formality, recency, Shabbos).
//
// It must never break the feature: if the check is off, offline, slow, busy or fails for any reason, the
// rule-based ranking is shown as it always was, with a line saying the visual check wasn't available.
//
// What is sent, and when: only the photos (small copies) and names of the pieces in the candidate outfits, and one
// line about the day, only when the person presses "Help me choose" (or a button that re-runs it). Verdicts are
// remembered for the open panel, so re-running with the same candidates does not call again.
//
// The first half is pure (no page, no network) so it can be tested on its own; the model call is replaceable.

const VISION_VETO_SCORE = 4;           // a score at or below this, or a clash flag, vetoes an outfit
const VISION_TIE_BUCKET = 3;           // rule scores within a bucket this wide count as a tie, and the vision score decides
const VISION_MAX_PHOTO = 320;          // px: the longer side of each photo that is sent
const VISION_TIMEOUT_MS = 12000;

// ---- the request ----
// suggestions: engine suggestions [{ signature, itemIds, ... }];  closetById: { id: item };
// photos: { pieceId: 'data:image/jpeg;base64,...' } (already shrunk);  context: one line about the day.
// An outfit with a piece that has no usable photo can't be judged, so it is left out and reported as unjudged.
function buildJudgeRequest(suggestions, closetById, photos, context) {
    const outfits = [], pieces = [], idBySignature = {}, unjudged = [];
    const seen = new Set();
    suggestions.forEach((s, i) => {
        const usable = s.itemIds.every(id => closetById[id] && photos[id]);
        if (!usable || s.itemIds.length < 2) { unjudged.push(s.signature); return; }
        const id = 'o' + (i + 1);
        idBySignature[s.signature] = id;
        outfits.push({ id, pieces: [...s.itemIds] });
        s.itemIds.forEach(pid => {
            if (seen.has(pid)) return;
            seen.add(pid);
            const item = closetById[pid];
            pieces.push({ id: pid, category: item.category, name: String(item.name || item.category).slice(0, 60), image: photos[pid] });
        });
    });
    return { payload: { outfits, pieces, context: String(context || '').slice(0, 200) }, idBySignature, unjudged };
}

// ---- turning verdicts into a final list ----
// verdicts: { signature: { score, clash, reason } } (an outfit with no verdict was not checked: it is neither
// vetoed nor praised). Returns { shown, vetoed, note }:
//   vetoed  clash, or score <= VISION_VETO_SCORE: dropped
//   order   rule score in buckets of 3 (so an engine tie is a tie), then the vision score, then the rule score
//   if fewer than two pass, the least-bad vetoed ideas fill up to two, marked `flagged`, so the person still gets
//   something (and is told what looked wrong) rather than an empty panel
function applyVerdicts(suggestions, verdicts, { show = 3 } = {}) {
    const verdictOf = (s) => (verdicts && verdicts[s.signature]) || null;
    const isVetoed = (v) => !!v && (v.clash === true || v.score <= VISION_VETO_SCORE);
    const decorate = (s, flagged) => { const v = verdictOf(s); return { ...s, vision: v ? { score: v.score, clash: !!v.clash, reason: v.reason || '', checked: true } : null, flagged: !!flagged }; };
    const bucket = (s) => Math.floor(s.score / VISION_TIE_BUCKET);
    const visionScore = (s) => { const v = verdictOf(s); return v ? v.score : 5; };               // not checked: middling
    const byQuality = (a, b) => bucket(b) - bucket(a) || visionScore(b) - visionScore(a) || b.score - a.score || (a.signature < b.signature ? -1 : 1);

    const passing = suggestions.filter(s => !isVetoed(verdictOf(s))).sort(byQuality);
    const vetoed = suggestions.filter(s => isVetoed(verdictOf(s))).sort((a, b) => visionScore(b) - visionScore(a) || b.score - a.score);
    let shown = passing.slice(0, show).map(s => decorate(s, false));
    let note = '';
    if (vetoed.length) note = vetoed.length === 1 ? 'I left out 1 idea that didn’t look right together.' : `I left out ${vetoed.length} ideas that didn’t look right together.`;
    if (shown.length < Math.min(2, show) && vetoed.length) {
        const fill = vetoed.slice(0, Math.min(2, show) - shown.length).map(s => decorate(s, true));
        shown = [...shown, ...fill];
        note = 'Most of my ideas didn’t look right together, so these are the closest. The notes say what looked off.';
    }
    return { shown, vetoed: vetoed.map(s => s.signature), note };
}

// The final list for the panel, whatever happened to the check: with good verdicts, vetoed and re-ranked; with
// anything else (off, offline, busy, failed), exactly the rules' own ranking, plus a line saying so.
function finalizeSuggestions(suggestions, check, { show = 3 } = {}) {
    if (check && check.status === 'ok') {
        const applied = applyVerdicts(suggestions, check.verdicts, { show });
        return { shown: applied.shown, vetoNote: applied.note, visionNote: check.note || '', checked: true };
    }
    return { shown: suggestions.slice(0, show), vetoNote: '', visionNote: (check && check.note) || '', checked: false };
}

const VISION_NOTES = {
    off: '',
    offline: 'You’re offline, so I couldn’t check how these look together. These ideas are based on your pieces’ details only.',
    unavailable: 'I couldn’t check how these look together just now, so these ideas are based on your pieces’ details only.',
    unjudged: 'Some pieces have no photo I could check, so those ideas are based on details only.'
};

// ---- the whole check ----
// deps (all replaceable, which is how the tests run it with no page, no network):
//   enabled()        is the visual check switched on?
//   online()         is the device online?
//   prepare(item)    -> Promise<dataURL|null>: a small copy of the piece's photo
//   call(payload)    -> Promise<{ verdicts: [{ outfit, score, clash, reason }] }>
//   timeoutMs
// cache: { signature: verdict } of what was already judged in this panel (those are not sent again).
// Returns { status, verdicts (by signature, including cached), sent (a call was made), note }.
//   status: 'off' | 'offline' | 'ok' | 'unavailable'
async function runVisionCheck({ suggestions, closetById, context, deps, cache = {} }) {
    const base = { verdicts: { ...cache }, sent: false, note: '' };
    if (!deps.enabled()) return { ...base, status: 'off' };
    const todo = suggestions.filter(s => !cache[s.signature]);
    if (todo.length === 0) return { ...base, status: 'ok' };                          // everything was judged already
    if (!deps.online()) return { ...base, status: 'offline', note: VISION_NOTES.offline };

    try {
        const photos = {};
        const ids = [...new Set(todo.flatMap(s => s.itemIds))];
        await Promise.all(ids.map(async (id) => { try { const p = closetById[id] && await deps.prepare(closetById[id]); if (p) photos[id] = p; } catch (e) { /* no photo: that outfit is not judged */ } }));
        const { payload, idBySignature, unjudged } = buildJudgeRequest(todo, closetById, photos, context);
        if (payload.outfits.length === 0) return { ...base, status: 'unavailable', note: VISION_NOTES.unavailable };

        const timeoutMs = deps.timeoutMs || VISION_TIMEOUT_MS;
        let timer;
        const reply = await Promise.race([
            deps.call(payload),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })
        ]).finally(() => clearTimeout(timer));

        const byOutfit = {};
        ((reply && reply.verdicts) || []).forEach(v => { if (v && typeof v.outfit === 'string' && Number.isFinite(Number(v.score))) byOutfit[v.outfit] = v; });
        const verdicts = { ...cache };
        Object.entries(idBySignature).forEach(([signature, outfitId]) => {
            const v = byOutfit[outfitId];
            if (v) verdicts[signature] = { score: Math.min(10, Math.max(0, Math.round(Number(v.score)))), clash: v.clash === true, reason: String(v.reason || '').slice(0, 160) };
        });
        const gotAny = Object.keys(idBySignature).some(sg => verdicts[sg]);
        if (!gotAny) return { ...base, sent: true, status: 'unavailable', note: VISION_NOTES.unavailable };
        return { verdicts, sent: true, status: 'ok', note: unjudged.length ? VISION_NOTES.unjudged : '' };
    } catch (e) {
        return { ...base, sent: true, status: 'unavailable', note: VISION_NOTES.unavailable };           // busy, down, slow, refused...: the rules' ranking stands
    }
}

// ---- in the page ----
// A small JPEG copy of a piece's photo (the framed square if there is one), so only a few tens of KB leave the device.
function shrinkPhoto(item, maxSide = VISION_MAX_PHOTO) {
    const src = item.thumb || item.image;
    return new Promise((resolve) => {
        if (!src || typeof document === 'undefined') { resolve(null); return; }
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const g = canvas.getContext('2d');
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, canvas.width, canvas.height);
            g.drawImage(img, 0, 0, canvas.width, canvas.height);
            try { resolve(canvas.toDataURL('image/jpeg', 0.7)); } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

async function callJudgeServer(payload) {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
    await waitForFirebase();
    const call = httpsCallable(getFunctions(window.Firebase.app, 'us-central1'), 'judgeOutfits');
    const result = await call(payload);
    return result.data;
}

function liveVisionDeps() {
    return {
        enabled: () => typeof featureEnabled === 'function' && featureEnabled('visionCheck'),
        online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
        prepare: shrinkPhoto,
        call: callJudgeServer,
        timeoutMs: VISION_TIMEOUT_MS
    };
}

if (typeof module !== 'undefined') {
    module.exports = { buildJudgeRequest, applyVerdicts, finalizeSuggestions, runVisionCheck, VISION_VETO_SCORE, VISION_TIE_BUCKET, VISION_NOTES };
}
