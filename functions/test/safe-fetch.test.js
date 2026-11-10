const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const zlib = require('zlib');
const { safeGet } = require('../lib/safe-fetch');

// A local server stands in for "the internet". Names under .test.example are mapped to it (or to a
// private address) by a fake DNS; the fake "is this address public?" says yes only to 127.0.0.1.
function startServer(handler) {
    return new Promise((resolve) => {
        const requests = [];
        const server = http.createServer((req, res) => { requests.push({ url: req.url, headers: req.headers }); handler(req, res, requests); });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests, close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) }));
    });
}

function env(port, extra = {}) {
    const lookups = [];
    const table = { 'shop.test.example': '127.0.0.1', 'cdn.test.example': '127.0.0.1', 'private.test.example': '10.0.0.5', 'mixed.test.example': ['127.0.0.1', '10.0.0.5'] };
    return {
        lookups,
        options: {
            allowedPorts: [port],
            isAllowedAddress: (a) => a === '127.0.0.1',
            lookup: (host, opts, cb) => {
                lookups.push(host);
                const v = table[host];
                if (!v) return cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
                cb(null, [].concat(v).map(address => ({ address, family: 4 })));
            },
            totalTimeoutMs: 3000, idleTimeoutMs: 1500,
            ...extra
        }
    };
}
const rejectsWith = async (p, code) => assert.rejects(p, (e) => e.code === code, `expected ${code}`);
const html = (res, body = '<html>ok</html>', type = 'text/html; charset=utf-8') => { res.writeHead(200, { 'content-type': type }); res.end(body); };

test('fetches a page and reports the final address', async () => {
    const s = await startServer((req, res) => html(res, '<title>Hi</title>'));
    try {
        const { options } = env(s.port);
        const r = await safeGet(`http://shop.test.example:${s.port}/p/1?x=1#frag`, options);
        assert.equal(r.status, 200); assert.equal(r.contentType, 'text/html'); assert.equal(r.body.toString(), '<title>Hi</title>');
        assert.equal(r.finalUrl, `http://shop.test.example:${s.port}/p/1?x=1`);
    } finally { await s.close(); }
});

test('follows redirects, re-checking each one', async () => {
    const s = await startServer((req, res) => {
        if (req.url === '/a') { res.writeHead(302, { location: '/b' }); return res.end(); }
        if (req.url === '/b') { res.writeHead(301, { location: `http://cdn.test.example:${s.port}/c` }); return res.end(); }
        html(res, 'arrived');
    });
    try {
        const e = env(s.port);
        const r = await safeGet(`http://shop.test.example:${s.port}/a`, e.options);
        assert.equal(r.body.toString(), 'arrived'); assert.match(r.finalUrl, /cdn\.test\.example.*\/c$/);
        assert.deepEqual(e.lookups, ['shop.test.example', 'shop.test.example', 'cdn.test.example'], 'each hop is resolved (and checked) once');
    } finally { await s.close(); }
});

test('a redirect to a host that resolves to a private address is refused, and never contacted', async () => {
    const s = await startServer((req, res) => { res.writeHead(302, { location: `http://private.test.example:${s.port}/secret` }); res.end(); });
    try {
        await rejectsWith(safeGet(`http://shop.test.example:${s.port}/`, env(s.port).options), 'BLOCKED_ADDRESS');
        assert.equal(s.requests.length, 1, 'only the first, public, host was contacted');
    } finally { await s.close(); }
});

test('redirects to IP addresses, other schemes, credentials, odd ports or internal names are refused', async () => {
    for (const target of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'ftp://shop.test.example/x',
        'https://user:pw@shop.test.example/x', 'http://localhost/x', 'http://intranet/x', 'http://[::1]/x', 'http://shop.test.example:6379/x']) {
        const s = await startServer((req, res) => { res.writeHead(302, { location: target }); res.end(); });
        try { await rejectsWith(safeGet(`http://shop.test.example:${s.port}/`, env(s.port).options), 'UNSAFE_REDIRECT'); }
        finally { await s.close(); }
    }
});

test('a redirect loop stops', async () => {
    const s = await startServer((req, res) => { res.writeHead(302, { location: '/again' }); res.end(); });
    try { await rejectsWith(safeGet(`http://shop.test.example:${s.port}/`, { ...env(s.port).options, maxRedirects: 4 }), 'TOO_MANY_REDIRECTS'); expectAtMost(s.requests.length, 5); }
    finally { await s.close(); }
});
function expectAtMost(n, max) { assert.ok(n <= max, `${n} requests, expected at most ${max}`); }

test('only the accepted content type is read', async () => {
    const s = await startServer((req, res) => html(res, '%PDF-1.4', 'application/pdf'));
    try {
        await rejectsWith(safeGet(`http://shop.test.example:${s.port}/`, {
            ...env(s.port).options, accept: (t) => t === 'text/html', badTypeCode: 'NOT_A_PAGE', badTypeMessage: 'x'
        }), 'NOT_A_PAGE');
    } finally { await s.close(); }
});

test('too large: refused from the declared length, and cut off when it is not declared', async () => {
    const big = Buffer.alloc(300000, 97);
    const s = await startServer((req, res) => {
        if (req.url === '/declared') return html(res, big);
        res.writeHead(200, { 'content-type': 'text/html', 'transfer-encoding': 'chunked' });   // no length: it just keeps coming
        const iv = setInterval(() => res.write(big.subarray(0, 50000)), 1);
        res.on('close', () => clearInterval(iv));
    });
    try {
        const o = { ...env(s.port).options, maxBytes: 100000 };
        await rejectsWith(safeGet(`http://shop.test.example:${s.port}/declared`, o), 'TOO_LARGE');
        await rejectsWith(safeGet(`http://shop.test.example:${s.port}/endless`, o), 'TOO_LARGE');
    } finally { await s.close(); }
});

test('a compressed "bomb" is cut off by what it expands to, not by what was sent', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 0));       // ~20 KB on the wire, 20 MB when opened
    assert.ok(bomb.length < 100 * 1024);
    const s = await startServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end(bomb); });
    try { await rejectsWith(safeGet(`http://shop.test.example:${s.port}/`, { ...env(s.port).options, maxBytes: 1024 * 1024 }), 'TOO_LARGE'); }
    finally { await s.close(); }
});

test('gzip, deflate and brotli pages are read normally', async () => {
    const text = '<title>Compressed</title>' + 'x'.repeat(5000);
    for (const [enc, fn] of [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]]) {
        const s = await startServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': enc }); res.end(fn(Buffer.from(text))); });
        try { assert.equal((await safeGet(`http://shop.test.example:${s.port}/`, env(s.port).options)).body.toString(), text, enc); }
        finally { await s.close(); }
    }
});

test('an unknown content encoding is refused', async () => {
    const s = await startServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'compress' }); res.end('x'); });
    try { await rejectsWith(safeGet(`http://shop.test.example:${s.port}/`, env(s.port).options), 'NETWORK'); }
    finally { await s.close(); }
});

test('a server that stalls is given up on', async () => {
    const s = await startServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<html>'); /* and then nothing */ });
    try {
        const t0 = Date.now();
        await rejectsWith(safeGet(`http://shop.test.example:${s.port}/`, { ...env(s.port).options, totalTimeoutMs: 600, idleTimeoutMs: 5000 }), 'TIMEOUT');
        assert.ok(Date.now() - t0 < 2500, 'gave up on time');
    } finally { await s.close(); }
});

test('HTTP errors become explainable reasons', async () => {
    const cases = { 401: 'LOGIN_REQUIRED', 403: 'BLOCKED', 429: 'BLOCKED', 404: 'NOT_FOUND', 410: 'NOT_FOUND', 500: 'HTTP_ERROR', 503: 'HTTP_ERROR' };
    for (const [status, code] of Object.entries(cases)) {
        const s = await startServer((req, res) => { res.writeHead(Number(status), { 'content-type': 'text/html' }); res.end('no'); });
        try { await rejectsWith(safeGet(`http://shop.test.example:${s.port}/`, env(s.port).options), code); }
        finally { await s.close(); }
    }
});

test('unknown hosts, and hosts with ANY private address, are refused', async () => {
    const s = await startServer((req, res) => html(res));
    try {
        await rejectsWith(safeGet(`http://nowhere.test.example:${s.port}/`, env(s.port).options), 'DNS_FAILED');
        await rejectsWith(safeGet(`http://private.test.example:${s.port}/`, env(s.port).options), 'BLOCKED_ADDRESS');
        await rejectsWith(safeGet(`http://mixed.test.example:${s.port}/`, env(s.port).options), 'BLOCKED_ADDRESS');
        assert.equal(s.requests.length, 0, 'nothing was requested');
    } finally { await s.close(); }
});

test('the connection goes to the address that was checked, not to a second look-up', async () => {
    const s = await startServer((req, res) => html(res, 'there'));
    try {
        const e = env(s.port);
        // "shop.test.example" exists ONLY in our fake DNS. The real network stack could never find it, so
        // this works only because the socket is opened to the address we already validated.
        assert.equal((await safeGet(`http://shop.test.example:${s.port}/`, e.options)).body.toString(), 'there');
        assert.equal(e.lookups.length, 1, 'resolved exactly once');
    } finally { await s.close(); }
});

test('no cookies or credentials are sent; a Referer only when asked for', async () => {
    const s = await startServer((req, res) => html(res));
    try {
        await safeGet(`http://shop.test.example:${s.port}/`, env(s.port).options);
        await safeGet(`http://shop.test.example:${s.port}/`, { ...env(s.port).options, headers: { Referer: 'https://shop.test.example/p/1' } });
        const [a, b] = s.requests.map(r => r.headers);
        for (const h of [a, b]) { assert.equal(h.cookie, undefined); assert.equal(h.authorization, undefined); assert.match(h['user-agent'], /TheRackImporter/); }
        assert.equal(a.referer, undefined); assert.equal(b.referer, 'https://shop.test.example/p/1');
    } finally { await s.close(); }
});

test('with the real rules, local and private targets are refused outright', async () => {
    const s = await startServer((req, res) => html(res, 'SECRET'));
    try {
        await rejectsWith(safeGet(`http://127.0.0.1:${s.port}/`, { allowedPorts: [s.port] }), 'BLOCKED_HOST');
        await rejectsWith(safeGet(`http://localhost:${s.port}/`, { allowedPorts: [s.port] }), 'BLOCKED_HOST');
        // a public-looking NAME that points at a private address, with the real address check:
        const lookup = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
        await rejectsWith(safeGet(`http://evil.example.com:${s.port}/`, { allowedPorts: [s.port], lookup }), 'BLOCKED_ADDRESS');
        assert.equal(s.requests.length, 0, 'the local server was never touched');
    } finally { await s.close(); }
});
