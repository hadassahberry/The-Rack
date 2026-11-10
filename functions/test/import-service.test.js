const test = require('node:test');
const assert = require('node:assert/strict');
const { sniffImageType } = require('../lib/image-sniff');
const { previewProduct, fetchImage, validateCandidates } = require('../lib/import-service');
const { ImportError } = require('../lib/errors');

const bytes = (...b) => Buffer.from(b);
const JPEG = Buffer.concat([bytes(0xff, 0xd8, 0xff, 0xe0), Buffer.alloc(40, 1)]);
const PNG = Buffer.concat([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), Buffer.alloc(40, 2)]);

test('pictures are recognised by their bytes', () => {
    assert.equal(sniffImageType(JPEG), 'image/jpeg');
    assert.equal(sniffImageType(PNG), 'image/png');
    assert.equal(sniffImageType(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)])), 'image/gif');
    assert.equal(sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)])), 'image/webp');
    assert.equal(sniffImageType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(20)])), 'image/avif');
});

test('things that are not accepted pictures are refused, whatever they claim to be', () => {
    assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
    assert.equal(sniffImageType(Buffer.from('<!doctype html><html><body>login</body></html>')), null);
    assert.equal(sniffImageType(Buffer.from('%PDF-1.7 ......................')), null);
    assert.equal(sniffImageType(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60)])), null, 'a program');
    assert.equal(sniffImageType(Buffer.alloc(5)), null); assert.equal(sniffImageType(null), null); assert.equal(sniffImageType(Buffer.alloc(0)), null);
});

// ---- the service, with a fake network ------------------------------------------------------------

const page = (html, extra = {}) => ({ finalUrl: 'https://shop.example.com/p/1', status: 200, contentType: 'text/html', charset: 'utf-8', body: Buffer.from(html), ...extra });
const publicLookup = (table = {}) => (host, o, cb) => {
    const a = table[host] || '93.184.216.34';
    if (a === 'FAIL') return cb(new Error('ENOTFOUND'));
    cb(null, [].concat(a).map(address => ({ address, family: address.includes(':') ? 6 : 4 })));
};

test('preview: returns the title and only the candidates that are safe for the browser to load', async () => {
    const html = `<meta property="og:title" content="Navy Shirt"><script type="application/ld+json">{"@type":"Product","name":"Navy Shirt","image":[
        "https://cdn.example.com/ok.jpg","http://cdn.example.com/plain-http.jpg","https://cdn.example.com:8443/odd-port.jpg","https://10.0.0.5/ip.jpg",
        "https://intranet/a.jpg","https://private.example.com/b.jpg","https://gone.example.com/c.jpg","https://mixed.example.com/d.jpg"]}</script>`;
    const r = await previewProduct({ url: 'https://shop.example.com/p/1' }, {
        safeGet: async () => page(html),
        lookup: publicLookup({ 'private.example.com': '10.1.2.3', 'gone.example.com': 'FAIL', 'mixed.example.com': ['93.184.216.34', '127.0.0.1'] })
    });
    assert.equal(r.title, 'Navy Shirt'); assert.equal(r.host, 'shop.example.com');
    assert.deepEqual(r.candidates.map(c => c.url), ['https://cdn.example.com/ok.jpg']);
});

test('preview: a page with no usable picture still returns its title (so the form can be pre-filled)', async () => {
    const r = await previewProduct({ url: 'https://shop.example.com/p/1' }, { safeGet: async () => page('<title>Wool Coat</title>'), lookup: publicLookup() });
    assert.equal(r.title, 'Wool Coat'); assert.deepEqual(r.candidates, []);
});

test('preview: sign-in and bot-check pages are reported as such', async () => {
    const login = '<title>Sign in</title><input type="password">';
    await assert.rejects(previewProduct({ url: 'x' }, { safeGet: async () => page(login, { finalUrl: 'https://shop.example.com/account/login' }), lookup: publicLookup() }), e => e.code === 'LOGIN_REQUIRED');
    await assert.rejects(previewProduct({ url: 'x' }, { safeGet: async () => page('<title>Just a moment...</title>'), lookup: publicLookup() }), e => e.code === 'BLOCKED');
});

test('preview: asks the fetcher for a small HTML page only, and passes failures through', async () => {
    let seen;
    await previewProduct({ url: 'https://shop.example.com/p/1' }, { safeGet: async (u, o) => { seen = o; return page('<title>x</title>'); }, lookup: publicLookup() });
    assert.equal(seen.maxBytes, 2 * 1024 * 1024); assert.equal(seen.accept('text/html'), true); assert.equal(seen.accept('image/png'), false); assert.equal(seen.accept('application/pdf'), false);
    await assert.rejects(previewProduct({ url: 'x' }, { safeGet: async () => { throw new ImportError('NOT_FOUND', 'nope'); } }), e => e.code === 'NOT_FOUND');
});

test('preview: decodes pages in other character sets', async () => {
    const latin1 = Buffer.from('<title>Café Sweater</title>', 'latin1');
    const r = await previewProduct({ url: 'x' }, { safeGet: async () => page('', { body: latin1, charset: 'iso-8859-1' }), lookup: publicLookup() });
    assert.equal(r.title, 'Café Sweater');
});

test('image: returns validated picture bytes, and sends the page as Referer', async () => {
    let seen;
    const r = await fetchImage({ url: 'https://cdn.example.com/a.jpg', pageUrl: 'https://shop.example.com/p/1?utm=1#x' }, {
        safeGet: async (u, o) => { seen = o; return { finalUrl: u, status: 200, contentType: 'image/jpeg', body: JPEG }; }
    });
    assert.equal(r.contentType, 'image/jpeg'); assert.equal(r.bytes, JPEG.length); assert.equal(Buffer.from(r.base64, 'base64').equals(JPEG), true);
    assert.equal(seen.headers.Referer, 'https://shop.example.com/p/1?utm=1');
    assert.equal(seen.maxBytes, 4 * 1024 * 1024);
    assert.equal(seen.accept('image/png'), true); assert.equal(seen.accept('text/html'), false); assert.equal(seen.accept('image/svg+xml'), false);
});

test('image: a bad or private page address is simply not sent as a Referer', async () => {
    for (const pageUrl of ['http://127.0.0.1/x', 'javascript:alert(1)', 'https://u:p@shop.example.com/', 'nonsense', undefined]) {
        let seen;
        await fetchImage({ url: 'https://cdn.example.com/a.jpg', pageUrl }, { safeGet: async (u, o) => { seen = o; return { body: PNG, contentType: 'image/png' }; } });
        assert.deepEqual(seen.headers, {}, String(pageUrl));
    }
});

test('image: a server that LABELS something an image but sends something else is refused', async () => {
    for (const body of [Buffer.from('<html>login</html>'), Buffer.from('<svg onload=alert(1)>'), Buffer.from('%PDF-1.7 .....................')]) {
        await assert.rejects(fetchImage({ url: 'https://cdn.example.com/a.jpg' }, { safeGet: async () => ({ body, contentType: 'image/jpeg' }) }), e => e.code === 'NOT_AN_IMAGE');
    }
});

test('candidate validation can be told to allow http (used only by tests with a local server)', async () => {
    const out = await validateCandidates([{ url: 'http://cdn.example.com/a.jpg' }], { lookup: publicLookup(), allowHttp: true, allowedPorts: [80, 443] });
    assert.equal(out.length, 1);
});

test('candidate validation gives up on a host that never answers', async () => {
    const t0 = Date.now();
    const out = await validateCandidates([{ url: 'https://slow.example.com/a.jpg' }], { lookup: () => { /* never calls back */ }, checkMs: 150 });
    assert.deepEqual(out, []); assert.ok(Date.now() - t0 < 1500);
});

test('candidate validation checks each host once', async () => {
    let n = 0;
    await validateCandidates([1, 2, 3].map(i => ({ url: `https://cdn.example.com/${i}.jpg` })), { lookup: (h, o, cb) => { n++; cb(null, [{ address: '93.184.216.34', family: 4 }]); } });
    assert.equal(n, 1);
});
