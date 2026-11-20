// js/welcome.js (who sees the welcome card), js/help-content.js (the getting-started text) and js/tour.js (the
// "Walk me through this page" tours): the decisions, the wording, and that every tour step points at something real.
const { check, done, assert, loadScript, read } = require('./_harness');
const { shouldShowWelcome, WELCOME_NEW_ACCOUNTS_FROM } = require('../js/welcome.js');
const { HELP_CONTENT } = require('../js/help-content.js');
const { TOURS } = require('../js/tour.js');

const NEW = '2026-11-10T09:30:00Z', OLD = '2026-03-02T12:00:00Z', EMPTY = { closet: 0, planned: 0, saved: 0 };
const show = (o) => shouldShowWelcome({ prefs: {}, creationTime: NEW, counts: EMPTY, ...o });

// ---- who is shown the card ----
check('a brand-new, empty account that has not seen it', () => {
    assert.strictEqual(show({}), true);
    assert.strictEqual(show({ prefs: { welcomeSeen: false } }), true, 'explicit false is the same as absent');
    assert.strictEqual(show({ prefs: { weatherEnabled: false, weekStart: 'mon', repeatLookBack: 5 } }), true, 'other settings do not matter');
});
check('already shown (on any device): never again', () => {
    assert.strictEqual(show({ prefs: { welcomeSeen: true } }), false);
});
check('accounts older than the feature are never shown it, even if they empty their closet', () => {
    assert.strictEqual(show({ creationTime: OLD }), false);
    assert.strictEqual(show({ creationTime: OLD, counts: EMPTY }), false);
    assert.strictEqual(show({ creationTime: new Date(WELCOME_NEW_ACCOUNTS_FROM).toISOString() }), true, 'exactly at the start date counts as new');
    assert.strictEqual(show({ creationTime: new Date(WELCOME_NEW_ACCOUNTS_FROM - 1000).toISOString() }), false);
});
check('an account that already has something is not shown it', () => {
    assert.strictEqual(show({ counts: { closet: 1, planned: 0, saved: 0 } }), false);
    assert.strictEqual(show({ counts: { closet: 0, planned: 1, saved: 0 } }), false);
    assert.strictEqual(show({ counts: { closet: 0, planned: 0, saved: 1 } }), false);
});
check('when anything is unknown, do not show it', () => {
    assert.strictEqual(show({ counts: null }), false);
    assert.strictEqual(show({ counts: undefined }), false);
    for (const creationTime of [undefined, null, 'not a date', '']) assert.strictEqual(show({ creationTime }), false);
    assert.strictEqual(shouldShowWelcome({ prefs: null, creationTime: NEW, counts: EMPTY }), false);
    for (const welcomeSeen of ['yes', 1, null]) assert.strictEqual(show({ prefs: { welcomeSeen } }), false, 'unexpected value ' + welcomeSeen);
});

// ---- the order things happen in ----
function welcome() {
    const sandbox = loadScript('js/welcome.js', { Store: {}, document: undefined }, ['Welcome']);
    return sandbox.Welcome;
}
function rig(o = {}) {
    const log = [];
    return {
        log, deps: {
            accountInfo: () => ({ creationTime: o.creationTime || NEW }),
            readAccountData: async () => { log.push('read'); if (o.readFails) throw new Error('offline'); return o.counts || EMPTY; },
            markSeen: async () => { log.push('markSeen'); if (o.markFails) throw new Error('offline'); },
            show: () => log.push('show')
        }
    };
}
const run = async (o, prefs = {}) => { const W = welcome(); const t = rig(o); const r = await W.consider(prefs, t.deps); return [r, t.log]; };
check('a new empty account: reads, records it as seen BEFORE showing, then shows', async () => {
    assert.deepStrictEqual(await run({}), [true, ['read', 'markSeen', 'show']]);
});
check('only the first call per page load does anything', async () => {
    const W = welcome(); const t = rig();
    assert.strictEqual(await W.consider({}, t.deps), true);
    assert.strictEqual(await W.consider({}, t.deps), false);
    assert.strictEqual(t.log.length, 3);
});
check('an existing or already-shown account costs no reads at all', async () => {
    assert.deepStrictEqual(await run({ creationTime: OLD }), [false, []]);
    assert.deepStrictEqual(await run({}, { welcomeSeen: true }), [false, []]);
});
check('not empty: read, but not shown or recorded; a failed read shows nothing', async () => {
    assert.deepStrictEqual(await run({ counts: { closet: 3, planned: 0, saved: 0 } }), [false, ['read']]);
    assert.deepStrictEqual(await run({ readFails: true }), [false, ['read']]);
});
check('if recording it fails (offline) the card is still shown', async () => {
    const origError = console.error; console.error = () => {};
    try { assert.deepStrictEqual(await run({ markFails: true }), [true, ['read', 'markSeen', 'show']]); } finally { console.error = origError; }
});

// ---- the words ----
check('the welcome steps are exactly the three agreed lines', () => {
    assert.deepStrictEqual(HELP_CONTENT.steps, ['Add clothes to your closet.', 'Choose a day to plan an outfit.', 'Mark outfits as worn to track what you wear.']);
    assert.deepStrictEqual([HELP_CONTENT.welcomeTitle, HELP_CONTENT.helpTitle], ['Welcome to The Rack', 'How to use The Rack']);
});
const details = HELP_CONTENT.details(false);
const allHelp = details.map(x => x.heading + ' ' + x.text).join(' ');
check('the help says planning is not wearing, where Mark as worn lives, and that it feeds Wear stats', () => {
    assert(/Planning an outfit does not record that you wore it/.test(allHelp));
    assert(/open today or a past day in the Planner and press Mark as worn/i.test(allHelp));
    assert(/Wear stats/.test(details.find(x => x.heading === 'Mark it as worn').text));
});
check('the help says Mark as worn needs an outfit with pieces, and mentions Help me choose and where to find help again', () => {
    assert(/outfit that has pieces/.test(details.find(x => x.heading === 'Mark it as worn').text));
    assert(/Help me choose/.test(details.find(x => x.heading === 'Plan an outfit').text));
    assert(/Help button/.test(allHelp) && /Settings/.test(allHelp));
});
check('every help block stays short (the window is a quick guide, not a manual)', () => {
    const longest = details.map(d => ({ heading: d.heading, n: d.text.length })).sort((a, b) => b.n - a.n)[0];
    assert(longest.n <= 330, `${longest.heading} is ${longest.n} characters`);
    assert.strictEqual(details.length, 5);
});
check('the link feature is only mentioned when it exists', () => {
    assert(!/product page/.test(HELP_CONTENT.details(false)[0].text));
    assert(/product page/.test(HELP_CONTENT.details(true)[0].text));
});

// ---- the tours ----
check('a tour for Planner, Closet and Wear stats (and none for Settings)', () => {
    assert.deepStrictEqual(Object.keys(TOURS).sort(), ['analytics-view', 'calendar-view', 'closet-view']);
});
check('each tour is short, and every step has a title, a plain explanation and a way to find its target', () => {
    for (const [page, tour] of Object.entries(TOURS)) {
        assert(tour.steps.length >= 2 && tour.steps.length <= 5, `${page}: ${tour.steps.length} steps`);
        tour.steps.forEach((s, i) => {
            assert(s.title && s.text && typeof s.target === 'function', `${page} step ${i + 1}`);
            assert(s.text.length <= 260, `${page} step ${i + 1} is ${s.text.length} characters`);
        });
    }
});
check('the planner tour says planning is not wearing, and that Mark as worn comes with pieces', () => {
    const plan = TOURS['calendar-view'].steps.find(s => s.title === 'Plan a day');
    assert(/does not count as wearing/.test(plan.text));
    assert(/outfit that has pieces/.test(plan.text) && /Mark as worn/.test(plan.text));
});
check('tour steps only look things up (they never click, save or change anything)', () => {
    const finders = Object.values(TOURS).flatMap(t => t.steps.map(s => s.target.toString())).join('\n');
    assert(!/\.click\(|Store\.|setDoc|addClosetItem|updateDay|dispatchEvent/.test(finders));
});
check('every tour step points at something that exists in the page', () => {
    const html = read('index.html');
    const scripts = ['calendar', 'closet', 'analytics', 'settings', 'navigation', 'tour'].map(n => read(`js/${n}.js`)).join('\n');
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    for (const [page, tour] of Object.entries(TOURS)) {
        tour.steps.forEach((s, i) => {
            const src = s.target.toString();
            for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) assert(ids.has(m[1]), `${page} step ${i + 1}: #${m[1]} is not in index.html`);
            for (const m of src.matchAll(/#([A-Za-z][\w-]*)/g)) assert(ids.has(m[1]), `${page} step ${i + 1}: #${m[1]} is not in index.html`);
            for (const m of src.matchAll(/\.([a-z][\w-]*)/g)) {
                if (['closest', 'find', 'querySelector', 'querySelectorAll', 'getClientRects', 'length', 'getElementById'].includes(m[1])) continue;
                if (!(html.includes(m[1]) || scripts.includes(m[1]))) assert.fail(`${page} step ${i + 1}: .${m[1]} appears nowhere`);
            }
        });
    }
});

done();
