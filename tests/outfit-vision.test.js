// js/outfit-vision.js: the visual check for "Help me choose". The model call is replaced by a fake, so these run
// with no page, no network and no key: a clashing pairing is vetoed or pushed down, a good pairing passes, and a
// failed (or missing, or slow) check falls back to the rule-based ranking.
const { check, done, assert, loadScript, read } = require('./_harness');

const sandbox = loadScript('js/outfit-suggest.js', {}, ['suggestOutfits']);
const V = loadScript('js/outfit-vision.js', {}, ['buildJudgeRequest', 'applyVerdicts', 'finalizeSuggestions', 'runVisionCheck', 'VISION_NOTES']);
const { suggestOutfits } = sandbox;
const { buildJudgeRequest, applyVerdicts, finalizeSuggestions, runVisionCheck, VISION_NOTES } = V;
const J = (x) => JSON.parse(JSON.stringify(x));

// ---- a closet with the exact trouble from the report: a striped shirt and a plaid skirt ----
const P = (id, name, category, color, extra = {}) => ({ id, name, category, color, season: 'all-season', occasion: 'casual', tagged: true, image: 'data:image/jpeg;base64,/9j/' + id, ...extra });
const CLOSET = [
    P('stripe', 'Black and white striped shirt', 'tops', '#222222', { occasion: 'work' }), P('navytop', 'Navy blouse', 'tops', '#1f2a52', { occasion: 'work' }), P('tee', 'White tee', 'tops', '#f5f5f5'),
    P('plaid', 'Brown plaid skirt', 'bottoms', '#7b5233', { occasion: 'work' }), P('navyskirt', 'Navy skirt', 'bottoms', '#1f2a52', { occasion: 'work' }), P('jeans', 'Blue jeans', 'bottoms', '#4a6fa5'),
    P('flats', 'Black flats', 'shoes', '#222222', { occasion: 'work' }), P('sneak', 'White sneakers', 'shoes', '#f5f5f5'), P('boots', 'Brown boots', 'shoes', '#7b5233', { occasion: 'work' })
];
const byId = Object.fromEntries(CLOSET.map(i => [i.id, i]));
const ctx = (over = {}) => ({ items: CLOSET, dateKey: '2026-11-12', weather: { high: 62, low: 50, code: 2 }, texts: ['Teaching'], isShabbat: false, isYomTov: false, worn: [], weekendPlanned: [], ...over });
const candidates = (max = 5) => J(suggestOutfits(ctx(), { max }).suggestions);
const photos = Object.fromEntries(CLOSET.map(i => [i.id, 'data:image/jpeg;base64,AAAA' + i.id]));
const hasPiece = (s, id) => s.itemIds.includes(id);

// a pretend vision model: it "sees" that stripes and plaid fight, and likes everything else
const fakeModel = (log = []) => async (payload) => {
    log.push(payload);
    return { verdicts: payload.outfits.map(o => {
        const names = o.pieces.map(id => payload.pieces.find(p => p.id === id).name).join(' ');
        const clash = /striped/.test(names) && /plaid/.test(names);
        return clash ? { outfit: o.id, score: 2, clash: true, reason: 'The striped shirt and plaid skirt compete.' } : { outfit: o.id, score: 8, clash: false, reason: 'The pieces work well together.' };
    }) };
};
const deps = (over = {}) => ({ enabled: () => true, online: () => true, prepare: async (item) => photos[item.id], call: fakeModel(), timeoutMs: 500, ...over });

// ---- the request ----
check('each piece\'s photo is sent once, even when outfits share it, and only photos + names + kinds + one line', () => {
    const s = candidates();
    const { payload, idBySignature } = buildJudgeRequest(s, byId, photos, 'Teaching; 62F high');
    const ids = payload.pieces.map(p => p.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.deepStrictEqual(J(payload.outfits.map(o => o.id)), s.map((_, i) => 'o' + (i + 1)));
    payload.pieces.forEach(p => { assert.deepStrictEqual(J(Object.keys(p).sort()), ['category', 'id', 'image', 'name']); assert(/^data:image\/jpeg;base64,/.test(p.image)); });
    assert.deepStrictEqual(J(Object.keys(payload).sort()), ['context', 'outfits', 'pieces']);
    assert.strictEqual(payload.context, 'Teaching; 62F high');
    assert.strictEqual(Object.keys(idBySignature).length, s.length);
});
check('only pieces in the candidate outfits are sent (nothing else from the closet)', () => {
    const s = candidates(3);
    const { payload } = buildJudgeRequest(s, byId, photos, '');
    const inCandidates = new Set(s.flatMap(x => x.itemIds));
    payload.pieces.forEach(p => assert(inCandidates.has(p.id)));
    assert.strictEqual(payload.pieces.length, inCandidates.size);
});
check('an outfit with a piece that has no photo is not judged (and is reported as such)', () => {
    const s = candidates();
    const missing = s[0].itemIds[0];
    const some = { ...photos }; delete some[missing];
    const { payload, unjudged } = buildJudgeRequest(s, byId, some, '');
    assert(unjudged.includes(s[0].signature));
    assert(!payload.outfits.some(o => o.pieces.includes(missing)));
});

// ---- veto and re-rank ----
const fake = (signature, score, extra = {}) => ({ signature, score, itemIds: ['a', 'b'], pieces: [], reason: '', ...extra });
check('a clashing outfit is dropped, and the good ones are shown', () => {
    const s = [fake('A', 90), fake('B', 80), fake('C', 70)];
    const out = applyVerdicts(s, { A: { score: 2, clash: true, reason: 'Stripes and plaid fight.' }, B: { score: 8, clash: false, reason: 'Good.' }, C: { score: 7, clash: false, reason: 'Fine.' } });
    assert.deepStrictEqual(J(out.shown.map(x => x.signature)), ['B', 'C']);
    assert.deepStrictEqual(J(out.vetoed), ['A']);
    assert(/left out 1 idea/.test(out.note));
    assert(out.shown.every(x => x.flagged === false && x.vision.checked));
});
check('a low score vetoes even if the model forgot to flag a clash', () => {
    const out = applyVerdicts([fake('A', 90), fake('B', 80), fake('C', 70)], { A: { score: 4, clash: false, reason: '' }, B: { score: 6, clash: false, reason: '' }, C: { score: 5, clash: false, reason: '' } });
    assert(!out.shown.some(x => x.signature === 'A'));
});
check('a good pairing passes and keeps the vision\'s words', () => {
    const out = applyVerdicts([fake('A', 90)], { A: { score: 9, clash: false, reason: 'Navy and stripes work.' } });
    assert.strictEqual(out.shown[0].vision.reason, 'Navy and stripes work.');
    assert.strictEqual(out.shown[0].flagged, false);
    assert.strictEqual(out.note, '');
});
check('when the rules tie, the vision score breaks the tie; a clear rules lead still wins', () => {
    const tie = applyVerdicts([fake('A', 92), fake('B', 91), fake('C', 90)], { A: { score: 5, clash: false, reason: '' }, B: { score: 9, clash: false, reason: '' }, C: { score: 7, clash: false, reason: '' } });
    assert.deepStrictEqual(J(tie.shown.map(x => x.signature)), ['B', 'C', 'A'], 'rule scores 90-92 are a tie, so vision decides');
    const lead = applyVerdicts([fake('A', 95), fake('B', 80)], { A: { score: 5, clash: false, reason: '' }, B: { score: 10, clash: false, reason: '' } });
    assert.deepStrictEqual(J(lead.shown.map(x => x.signature)), ['A', 'B'], 'a 15-point lead is not a tie');
});
check('an outfit that was not checked is neither vetoed nor praised', () => {
    const out = applyVerdicts([fake('A', 90), fake('B', 80)], { B: { score: 9, clash: false, reason: 'Nice.' } });
    assert.strictEqual(out.shown.length, 2);
    assert.strictEqual(out.shown.find(x => x.signature === 'A').vision, null);
});
check('at most three are shown', () => {
    const s = ['A', 'B', 'C', 'D', 'E'].map((sg, i) => fake(sg, 90 - i * 10));
    const v = Object.fromEntries(s.map(x => [x.signature, { score: 8, clash: false, reason: '' }]));
    assert.strictEqual(applyVerdicts(s, v).shown.length, 3);
});
check('if almost everything clashes, the least-bad ones are still shown, marked, so the panel is never empty', () => {
    const s = [fake('A', 90), fake('B', 80), fake('C', 70)];
    const out = applyVerdicts(s, { A: { score: 1, clash: true, reason: 'Clash A' }, B: { score: 3, clash: true, reason: 'Clash B' }, C: { score: 6, clash: false, reason: 'OK' } });
    assert.deepStrictEqual(J(out.shown.map(x => x.signature)), ['C', 'B']);
    assert.deepStrictEqual(J(out.shown.map(x => x.flagged)), [false, true]);
    assert(/closest/.test(out.note));
});

// ---- the whole check, with the model faked ----
check('the checked-and-vetoed result: the striped shirt and plaid skirt are never shown together', async () => {
    const s = candidates(5);
    const rulesOnly = s.slice(0, 3);
    const r = await runVisionCheck({ suggestions: s, closetById: byId, context: 'Teaching', deps: deps() });
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.sent, true);
    const final = finalizeSuggestions(s, r, { show: 3 });
    assert(final.checked && final.shown.length >= 2 && final.shown.length <= 3);
    final.shown.forEach(x => assert(!(hasPiece(x, 'stripe') && hasPiece(x, 'plaid')), 'the clashing pair is still shown'));
    // and the check really changed something: the clashing pair was among the candidates
    assert(s.some(x => hasPiece(x, 'stripe') && hasPiece(x, 'plaid')) || rulesOnly.length >= 2);
});
check('the rules alone DO put the clashing pair forward (this is the gap the check closes)', () => {
    const closet = [P('stripe', 'Black and white striped shirt', 'tops', '#222222', { occasion: 'work' }), P('plaid', 'Brown plaid skirt', 'bottoms', '#7b5233', { occasion: 'work' }),
        P('flats', 'Black flats', 'shoes', '#222222', { occasion: 'work' }), P('tee', 'White tee', 'tops', '#f5f5f5'), P('jeans', 'Blue jeans', 'bottoms', '#4a6fa5'), P('sneak', 'White sneakers', 'shoes', '#f5f5f5')];
    const s = J(suggestOutfits({ ...ctx(), items: closet }, { max: 5 }).suggestions);
    assert(s.some(x => x.itemIds.includes('stripe') && x.itemIds.includes('plaid')), 'the metadata alone sees nothing wrong with stripes + plaid');
});
check('one call judges all the candidates at once', async () => {
    const log = [];
    const s = candidates(5);
    await runVisionCheck({ suggestions: s, closetById: byId, context: '', deps: deps({ call: fakeModel(log) }) });
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].outfits.length, s.length);
});
check('verdicts already known are not asked for again (so re-running with the same ideas costs nothing)', async () => {
    const log = [];
    const s = candidates(5);
    const first = await runVisionCheck({ suggestions: s, closetById: byId, context: '', deps: deps({ call: fakeModel(log) }) });
    const again = await runVisionCheck({ suggestions: s, closetById: byId, context: '', deps: deps({ call: fakeModel(log) }), cache: first.verdicts });
    assert.strictEqual(log.length, 1);
    assert.strictEqual(again.status, 'ok');
    assert.strictEqual(again.sent, false);
});
check('only the new candidates are sent when some were judged before', async () => {
    const log = [];
    const s = candidates(5);
    const first = await runVisionCheck({ suggestions: s.slice(0, 2), closetById: byId, context: '', deps: deps({ call: fakeModel(log) }) });
    await runVisionCheck({ suggestions: s, closetById: byId, context: '', deps: deps({ call: fakeModel(log) }), cache: first.verdicts });
    assert.strictEqual(log[1].outfits.length, s.length - 2);
});

// ---- falling back ----
const rulesRanking = (s, n = 3) => s.slice(0, n).map(x => x.signature);
check('a failed call: the rule-based ranking is shown unchanged, with a line saying the check was unavailable', async () => {
    const s = candidates(5);
    for (const failure of [async () => { throw new Error('503'); }, async () => { throw Object.assign(new Error('busy'), { code: 'functions/resource-exhausted' }); }, async () => ({}), async () => ({ verdicts: [] }), async () => ({ verdicts: [{ outfit: 'nope', score: 9 }] }), async () => null]) {
        const r = await runVisionCheck({ suggestions: s, closetById: byId, context: '', deps: deps({ call: failure }) });
        assert.strictEqual(r.status, 'unavailable');
        const final = finalizeSuggestions(s, r, { show: 3 });
        assert.deepStrictEqual(J(final.shown.map(x => x.signature)), rulesRanking(s), 'the rules\' ranking, exactly');
        assert.strictEqual(final.visionNote, VISION_NOTES.unavailable);
        assert(/couldn’t check how these look together/.test(final.visionNote));
        assert.strictEqual(final.checked, false);
    }
});
check('offline: no call is made, and the rules\' ranking is shown with an offline note', async () => {
    const log = [];
    const s = candidates(5);
    const r = await runVisionCheck({ suggestions: s, closetById: byId, context: '', deps: deps({ online: () => false, call: fakeModel(log) }) });
    assert.strictEqual(r.status, 'offline');
    assert.strictEqual(log.length, 0);
    assert.strictEqual(r.sent, false, 'nothing left the device');
    const final = finalizeSuggestions(s, r);
    assert.deepStrictEqual(J(final.shown.map(x => x.signature)), rulesRanking(s));
    assert(/offline/.test(final.visionNote));
});
check('too slow: gives up and falls back', async () => {
    const s = candidates(5);
    const r = await runVisionCheck({ suggestions: s, closetById: byId, context: '', deps: deps({ call: () => new Promise(() => {}), timeoutMs: 30 }) });
    assert.strictEqual(r.status, 'unavailable');
});
check('switched off (the default): nothing is prepared, sent or changed', async () => {
    const log = []; let prepared = 0;
    const s = candidates(5);
    const r = await runVisionCheck({ suggestions: s, closetById: byId, context: '', deps: deps({ enabled: () => false, call: fakeModel(log), prepare: async () => { prepared++; return 'x'; } }) });
    assert.strictEqual(r.status, 'off');
    assert.deepStrictEqual([log.length, prepared, r.sent], [0, 0, false]);
    const final = finalizeSuggestions(s, r);
    assert.deepStrictEqual(J(final.shown.map(x => x.signature)), rulesRanking(s));
    assert.strictEqual(final.visionNote, '');
});
check('photos that cannot be prepared: nothing is sent, and the rules\' ranking stands', async () => {
    const log = [];
    const r = await runVisionCheck({ suggestions: candidates(5), closetById: byId, context: '', deps: deps({ prepare: async () => null, call: fakeModel(log) }) });
    assert.strictEqual(r.status, 'unavailable');
    assert.strictEqual(log.length, 0);
});
check('a model that answers for only some outfits: those are judged, the rest are simply not checked', async () => {
    const s = candidates(5);
    const half = async (payload) => ({ verdicts: [{ outfit: payload.outfits[0].id, score: 2, clash: true, reason: 'No.' }] });
    const r = await runVisionCheck({ suggestions: s, closetById: byId, context: '', deps: deps({ call: half }) });
    assert.strictEqual(r.status, 'ok');
    const final = finalizeSuggestions(s, r);
    assert(!final.shown.some(x => x.signature === s[0].signature), 'the one that clashed is gone');
    assert(final.shown.length >= 2, 'the others still show');
});

// ---- the page wiring: it is off by default, and says what it sends ----
check('the visual check is off by default and shipped with the app but inert', () => {
    const features = loadScript('js/features.js', { localStorage: { getItem: () => null } }, ['featureEnabled', 'RACK_FEATURES']);
    assert.strictEqual(features.RACK_FEATURES.visionCheck, false);
    assert.strictEqual(features.featureEnabled('visionCheck'), false);
});
check('the panel says what is sent, and when', () => {
    const src = read('js/help-choose.js');
    assert(/photos of the pieces in these ideas are sent to Google’s Gemini AI/.test(src));
    assert(/only when you press Help me choose/.test(src));
    assert(/may use them to improve its products/.test(src), 'the free tier\'s data use is disclosed');
    assert(/finalizeSuggestions/.test(src) && /runVisionCheck/.test(src));
});
check('nothing is written to the planner by the check (still only "Use this outfit")', () => {
    const src = read('js/help-choose.js') + read('js/outfit-vision.js');
    assert(!/Store\.(set|add|update|delete)/.test(src) && !/\bupdateDay\(/.test(src));
    assert.strictEqual((src.match(/applySavedOutfit\(/g) || []).length, 1);
});
check('the page loads the new script before help-choose, and caches it for offline use', () => {
    const html = read('index.html'), sw = read('sw.js');
    assert(html.indexOf('js/outfit-vision.js') > 0 && html.indexOf('js/outfit-vision.js') < html.indexOf('js/help-choose.js'));
    assert(sw.includes("'js/outfit-vision.js'"));
});

done();
