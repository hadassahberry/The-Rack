// sw.js: the service worker that lets the installed app open without a connection. Run here against a fake
// browser (no real worker, cache or network): what it pre-caches, which requests it touches, and how.
const { check, done, assert, read, vm } = require('./_harness');

function boot() {
    const listeners = {};
    const cacheStore = new Map();                   // cache name -> Map(url -> response)
    const added = [];
    const openCache = (name) => {
        if (!cacheStore.has(name)) cacheStore.set(name, new Map());
        const m = cacheStore.get(name);
        return Promise.resolve({
            add: (url) => { if (/missing/.test(url)) return Promise.reject(new Error('404')); added.push(url); const abs = new URL(url, 'https://rack.example/').href; m.set(abs, { url: abs, body: 'cached ' + url }); return Promise.resolve(); },
            put: (req, res) => { m.set(typeof req === 'string' ? req : req.url, res); return Promise.resolve(); }
        });
    };
    const events = { waited: [], skipped: 0, claimed: 0 };
    const caches = {
        open: openCache,
        keys: () => Promise.resolve([...cacheStore.keys()]),
        delete: (k) => { cacheStore.delete(k); return Promise.resolve(true); },
        match: (req) => { const url = new URL(typeof req === 'string' ? req : req.url, 'https://rack.example/').href; for (const m of cacheStore.values()) if (m.has(url)) return Promise.resolve(m.get(url)); return Promise.resolve(undefined); }
    };
    const self = {
        location: { origin: 'https://rack.example' },
        addEventListener: (type, fn) => { listeners[type] = fn; },
        skipWaiting: () => { events.skipped++; },
        clients: { claim: () => { events.claimed++; return Promise.resolve(); } }
    };
    const Response = { error: () => ({ error: true }) };
    const sandbox = vm.createContext({ self, caches, Response, URL, Promise, fetch: () => Promise.reject(new Error('offline')), console });
    vm.runInContext(read('sw.js'), sandbox, { filename: 'sw.js' });
    return { listeners, caches, cacheStore, added, events, sandbox };
}
const fetchEvent = (req) => { const e = { request: req, responded: undefined, respondWith(p) { this.responded = p; } }; return e; };
const request = (url, over = {}) => ({ url, method: 'GET', mode: 'cors', ...over });
const response = (ok = true) => ({ ok, clone() { return { ...this, cloned: true }; } });

check('on install it pre-caches the app shell (a missing file never blocks the install) and takes over at once', async () => {
    const w = boot();
    const ev = { waitUntil(p) { this.p = p; } };
    w.listeners.install(ev); await ev.p;
    assert(w.added.includes('index.html') && w.added.includes('js/app.js') && w.added.includes('css/components.css'));
    assert.strictEqual(w.events.skipped, 1);
});
check('on activate it deletes older caches and claims open pages', async () => {
    const w = boot();
    w.cacheStore.set('old-cache', new Map());
    const inst = { waitUntil(p) { this.p = p; } }; w.listeners.install(inst); await inst.p;
    const ev = { waitUntil(p) { this.p = p; } };
    w.listeners.activate(ev); await ev.p;
    assert.deepStrictEqual([...w.cacheStore.keys()], ['rack-shell-v1']);
    assert.strictEqual(w.events.claimed, 1);
});
check('requests that are not its business are left completely alone', () => {
    const w = boot();
    for (const req of [request('https://rack.example/x', { method: 'POST' }), request('https://api.open-meteo.com/v1/forecast'), request('https://rack.example/__/auth/handler')]) {
        const ev = fetchEvent(req); w.listeners.fetch(ev);
        assert.strictEqual(ev.responded, undefined, req.url);
    }
});
check('network first: online you always get the newest file, and a copy is kept for offline', async () => {
    const w = boot();
    w.sandbox.fetch = () => Promise.resolve(response());
    const ev = fetchEvent(request('https://rack.example/js/app.js')); w.listeners.fetch(ev);
    const res = await ev.responded;
    assert.strictEqual(res.ok, true);
    await new Promise(r => setImmediate(r));
    assert(w.cacheStore.get('rack-shell-v1').has('https://rack.example/js/app.js'));
});
check('a failed response is not cached', async () => {
    const w = boot();
    w.sandbox.fetch = () => Promise.resolve(response(false));
    const ev = fetchEvent(request('https://rack.example/js/app.js')); w.listeners.fetch(ev);
    await ev.responded; await new Promise(r => setImmediate(r));
    assert(!w.cacheStore.has('rack-shell-v1') || !w.cacheStore.get('rack-shell-v1').has('https://rack.example/js/app.js'));
});
check('addresses with a query string are never kept (password-reset links carry one-time codes)', async () => {
    const w = boot();
    w.sandbox.fetch = () => Promise.resolve(response());
    const ev = fetchEvent(request('https://rack.example/reset-password.html?oobCode=SECRET')); w.listeners.fetch(ev);
    await ev.responded; await new Promise(r => setImmediate(r));
    const kept = w.cacheStore.get('rack-shell-v1');
    assert(!kept || ![...kept.keys()].some(k => /oobCode/.test(k)));
});
check('offline: the saved copy is used; a page navigation falls back to the app; anything else gets an error', async () => {
    const w = boot();
    const inst = { waitUntil(p) { this.p = p; } }; w.listeners.install(inst); await inst.p;
    w.sandbox.fetch = () => Promise.reject(new Error('offline'));
    const saved = fetchEvent(request('https://rack.example/index.html')); w.listeners.fetch(saved);
    assert.strictEqual((await saved.responded).body, 'cached index.html');
    const nav = fetchEvent(request('https://rack.example/some/page', { mode: 'navigate' })); w.listeners.fetch(nav);
    assert.strictEqual((await nav.responded).body, 'cached index.html');
    const other = fetchEvent(request('https://rack.example/not-cached.js')); w.listeners.fetch(other);
    assert.strictEqual((await other.responded).error, true);
});

done();
