// Save-state feedback: "Saving…", "Saved", or "Couldn’t save – try again", next to whatever autosaves.
//
// What "saved" means here: Firestore only finishes a write (the promise resolves) once the SERVER has
// accepted it. While the device is offline the write waits in memory and the promise stays pending, so
// "Saved" is never shown for something that has only been kept on this device. After a few seconds of
// waiting the line says so ("still waiting for the connection"), and a failure says "try again".
//
// The tracker is plain logic (tested on its own in node):
//   - every write is run with a KEY naming what it writes (a day, an item, a setting);
//   - the state is "saving" while ANY write is still pending, so an older write finishing can never
//     mark a newer edit saved; "saved" only when nothing is pending and nothing failed;
//   - a failure counts only if no newer write to the same key has started since (that newer write
//     replaces it), and a later success on the same key clears it;
//   - "try again" re-runs only what failed, with the very same data: each write names one document by
//     a fixed id, so running it again overwrites rather than duplicates anything.

function createSaveTracker({ slowAfterMs = 6000, setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {} } = {}) {
    let pending = 0, seq = 0, saved = false, slow = false, timer = null;
    const newest = new Map();      // key -> the newest write started for it
    const failed = new Map();      // key -> { seq, retry }

    function state() {
        return {
            status: pending > 0 ? 'saving' : failed.size ? 'failed' : saved ? 'saved' : 'idle',
            slow: pending > 0 && slow,
            failedCount: failed.size
        };
    }
    const emit = () => onChange(state());

    function run(key, op, opts = {}) {
        const mine = ++seq;
        newest.set(key, mine);
        failed.delete(key);                                   // this attempt replaces an earlier failure of the same thing
        if (pending === 0) {
            slow = false;
            timer = setTimer(() => { timer = null; if (pending > 0) { slow = true; emit(); } }, slowAfterMs);
        }
        pending++;
        saved = false;
        emit();
        let attempt;
        try { attempt = Promise.resolve(op()); } catch (e) { attempt = Promise.reject(e); }
        const retry = opts.retry || op;
        return attempt.then(() => settle(true), (err) => settle(false, err));

        function settle(ok, err) {
            pending--;
            const latest = newest.get(key) === mine;          // false: a newer write to the same thing has started
            if (!ok && latest) failed.set(key, { seq: mine, retry, opts });
            if (pending === 0) {
                if (timer) { clearTimer(timer); timer = null; }
                slow = false;
                saved = failed.size === 0;
            }
            emit();
            try { (ok ? opts.onOk : opts.onFail) && (ok ? opts.onOk(latest) : opts.onFail(err, latest)); } catch (e) { console.error(e); }
            return ok;
        }
    }

    // Runs again whatever failed. (A failure is removed the moment its retry starts, so a second click is a no-op.)
    function retryFailed() {
        const todo = [...failed.entries()];
        return Promise.all(todo.map(([key, f]) => run(key, f.retry, { ...f.opts, retry: f.retry })));
    }

    // Drops a failure the person has dealt with some other way (so "try again" won't repeat it).
    function forget(key) {
        if (failed.delete(key) && pending === 0) saved = false;
        emit();
    }

    return { run, retryFailed, forget, state, isBusy: () => pending > 0, isSlow: () => pending > 0 && slow };
}

// ---- the visible line ----
const SAVE_TEXT = {
    saving: 'Saving…',
    slow: 'Saving… still waiting for the connection. This finishes when you’re back online, so keep this page open.',
    saved: 'Saved',
    failed: 'Couldn’t save –'
};

// el: an empty <p role="status" aria-live="polite" class="save-status">. Returns { render(state) }.
function createSaveStatusView(el, { onRetry, savedForMs = 4000 } = {}) {
    let textEl = null, retryBtn = null, fadeTimer = null;
    function ensure() {
        if (textEl) return;
        textEl = document.createElement('span');
        textEl.className = 'save-status-text';
        retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'link-btn save-status-retry';
        retryBtn.textContent = 'try again';
        retryBtn.setAttribute('aria-label', 'Try saving again');
        retryBtn.addEventListener('click', () => onRetry && onRetry());
        el.append(textEl, ' ', retryBtn);
    }
    function render(s) {
        ensure();
        if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
        const key = s.status === 'saving' && s.slow ? 'slow' : s.status;
        el.dataset.state = s.status;
        el.classList.toggle('hidden', s.status === 'idle');
        el.classList.toggle('is-error', s.status === 'failed');
        textEl.textContent = SAVE_TEXT[key] || '';
        retryBtn.classList.toggle('hidden', s.status !== 'failed');
        if (s.status === 'saved' && savedForMs) {
            fadeTimer = setTimeout(() => { if (el.dataset.state === 'saved') el.classList.add('hidden'); }, savedForMs);
        }
    }
    return { render };
}

// Leaving the page while a write is still waiting for the server would lose it, so the browser is asked to confirm.
// Only once a save has been waiting long enough to be "slow" (a normal save finishes long before anyone can leave).
const slowSaveTrackers = [];
function warnBeforeLeavingWhileSaving(tracker) {
    slowSaveTrackers.push(tracker);
}
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (e) => {
        if (slowSaveTrackers.some(t => t.isSlow())) { e.preventDefault(); e.returnValue = ''; }
    });
}

if (typeof module !== 'undefined') {
    module.exports = { createSaveTracker, SAVE_TEXT };
}
