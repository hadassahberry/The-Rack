// js/save-state.js: "Saving... / Saved / Couldn't save - try again". "Saved" is shown only after the server has
// confirmed a write, an older answer can never mark a newer edit saved, and a retry never duplicates anything.
const { check, done, assert } = require('./_harness');
const { createSaveTracker, SAVE_TEXT } = require('../js/save-state.js');

// a tracker with a manual clock, and writes that are settled by hand
function rig(slowAfterMs = 6000) {
    const timers = [], log = [];
    const t = createSaveTracker({
        slowAfterMs,
        setTimer: (fn, ms) => { const h = { fn, ms, live: true }; timers.push(h); return h; },
        clearTimer: (h) => { h.live = false; },
        onChange: (s) => log.push(s.status + (s.slow ? '+slow' : ''))
    });
    const write = () => { let ok, no; const p = new Promise((res, rej) => { ok = res; no = rej; }); return { p, ok, no, op: () => p }; };
    const tick = () => timers.filter(h => h.live).forEach(h => { h.live = false; h.fn(); });
    return { t, log, write, tick };
}
const flush = () => new Promise(r => setImmediate(r));
const FAILED = { status: 'failed', slow: false, failedCount: 1, savedAt: 0 };

check('a plain success: saving, then saved', async () => {
    const r = rig(); const w = r.write();
    assert.strictEqual(r.t.state().status, 'idle');
    const p = r.t.run('day:1', w.op);
    assert.strictEqual(r.t.state().status, 'saving');
    w.ok(); await p;
    assert.strictEqual(r.t.state().status, 'saved');
    assert.deepStrictEqual(r.log, ['saving', 'saved']);
});
check('rapid edits: an older write finishing never marks a newer one saved', async () => {
    const r = rig(); const a = r.write(), b = r.write(), c = r.write();
    const pa = r.t.run('day:1', a.op), pb = r.t.run('day:1', b.op), pc = r.t.run('day:1', c.op);
    a.ok(); await pa; assert.strictEqual(r.t.state().status, 'saving');
    b.ok(); await pb; assert.strictEqual(r.t.state().status, 'saving');
    c.ok(); await pc; assert.strictEqual(r.t.state().status, 'saved');
    assert.strictEqual(r.log.filter(x => x === 'saved').length, 1, 'saved exactly once, at the very end');
});
check('answers arriving out of order', async () => {
    const r = rig(); const x = r.write(), y = r.write();
    const px = r.t.run('day:1', x.op), py = r.t.run('day:1', y.op);
    y.ok(); await py; assert.strictEqual(r.t.state().status, 'saving');
    x.ok(); await px; assert.strictEqual(r.t.state().status, 'saved');
});
check('a failure is reported, with what to retry', async () => {
    const r = rig(); const w = r.write(); let told = null;
    const p = r.t.run('day:1', w.op, { onFail: (e, latest) => { told = [e.message, latest]; } });
    w.no(new Error('offline')); await p;
    assert.deepStrictEqual(r.t.state(), FAILED);
    assert.deepStrictEqual(told, ['offline', true]);
});
check('retry writes the same thing once; a double click does not write twice', async () => {
    const r = rig(); let calls = 0; const attempts = [];
    const op = () => { calls++; const w = r.write(); attempts.push(w); return w.p; };
    const p1 = r.t.run('day:1', op); attempts[0].no(new Error('x')); await p1;
    assert.strictEqual(r.t.state().status, 'failed');
    const a = r.t.retryFailed(), b = r.t.retryFailed();
    assert.strictEqual(r.t.state().status, 'saving');
    attempts[1].ok(); await a; await b;
    assert.strictEqual(calls, 2);
    assert.strictEqual(r.t.state().status, 'saved');
});
check('a retry that fails again stays failed, and a later one can succeed', async () => {
    const r = rig(); const at = []; const op = () => { const w = r.write(); at.push(w); return w.p; };
    const p1 = r.t.run('k', op); at[0].no(new Error('1')); await p1;
    const p2 = r.t.retryFailed(); at[1].no(new Error('2')); await p2;
    assert.strictEqual(r.t.state().status, 'failed');
    const p3 = r.t.retryFailed(); at[2].ok(); await p3;
    assert.strictEqual(r.t.state().status, 'saved');
});
check('an older failure that a newer write replaced does not count', async () => {
    const r = rig(); const o = r.write(), n = r.write(); const seen = [];
    const po = r.t.run('day:1', o.op, { onFail: (e, latest) => seen.push(latest) }), pn = r.t.run('day:1', n.op);
    o.no(new Error('old')); await po; n.ok(); await pn;
    assert.strictEqual(r.t.state().status, 'saved');
    assert.deepStrictEqual(seen, [false]);
});
check('the newest write failing is a failure, even after an older one succeeded', async () => {
    const r = rig(); const o = r.write(), n = r.write();
    const po = r.t.run('day:1', o.op), pn = r.t.run('day:1', n.op);
    o.ok(); await po; n.no(new Error('new')); await pn;
    assert.strictEqual(r.t.state().status, 'failed');
});
check('different things are tracked separately, and only the failed one is retried', async () => {
    const r = rig(); const d1 = r.write(), d2 = r.write();
    const p1 = r.t.run('day:1', d1.op), p2 = r.t.run('day:2', d2.op);
    d1.no(new Error('a')); await p1; d2.ok(); await p2;
    assert.deepStrictEqual(r.t.state(), FAILED);
    r.t.retryFailed();
    assert.strictEqual(r.t.state().status, 'saving');
});
check('offline: a write that never answers is "saving", then "still saving", never "saved"', async () => {
    const r = rig(6000); const w = r.write();
    r.t.run('day:1', w.op);
    assert.strictEqual(r.log.slice(-1)[0], 'saving');
    r.tick();
    assert.strictEqual(r.log.slice(-1)[0], 'saving+slow');
    assert(!r.log.includes('saved'));
    w.ok(); await flush();
    assert.strictEqual(r.t.state().status, 'saved');
    assert.strictEqual(r.t.state().slow, false);
});
check('an operation that throws straight away is a failure too', async () => {
    const r = rig(); await r.t.run('k', () => { throw new Error('boom'); });
    assert.strictEqual(r.t.state().status, 'failed');
});
check('no "still saving" note after a quick save', async () => {
    const r = rig(); const w = r.write(); const p = r.t.run('k', w.op); w.ok(); await p; r.tick();
    assert(!r.log.some(x => x.includes('slow')));
});

check('"Saved" is news only right after a save', async () => {
    const r = rig();
    assert.deepStrictEqual([r.t.state().status, r.t.state().savedAt], ['idle', 0]);
    let w = r.write(); const p = r.t.run('k', w.op); w.ok(); await p;
    assert.strictEqual(r.t.state().status, 'saved');
    assert(r.t.state().savedAt > 0, 'with the time it was confirmed');
    r.t.clearSaved();
    assert.deepStrictEqual([r.t.state().status, r.t.state().savedAt], ['idle', 0], 'opening a fresh window clears an old "Saved"');
    const n = r.log.length; r.t.clearSaved();
    assert.strictEqual(r.log.length, n, 'nothing to clear: nothing happens');
});
check('clearSaved never hides a save in progress or a failure', async () => {
    let r = rig(); let w = r.write(); r.t.run('k', w.op); r.t.clearSaved();
    assert.strictEqual(r.t.state().status, 'saving');
    w.ok(); await flush();
    assert.strictEqual(r.t.state().status, 'saved');
    r = rig(); w = r.write(); const p = r.t.run('k', w.op); w.no(new Error('x')); await p; r.t.clearSaved();
    assert.strictEqual(r.t.state().status, 'failed');
});
check('forget() drops a failure that was dealt with some other way', async () => {
    const r = rig(); const w = r.write(); const p = r.t.run('k', w.op); w.no(new Error('x')); await p;
    r.t.forget('k');
    assert.notStrictEqual(r.t.state().status, 'failed');
    assert.deepStrictEqual(await r.t.retryFailed(), [], 'nothing left to retry');
});
check('the words shown', () => {
    assert.strictEqual(SAVE_TEXT.saving, 'Saving…');
    assert.strictEqual(SAVE_TEXT.saved, 'Saved');
    assert.strictEqual(SAVE_TEXT.failed, 'Couldn’t save –');
    assert(/still waiting for the connection/.test(SAVE_TEXT.slow) && /keep this page open/.test(SAVE_TEXT.slow));
});

done();
