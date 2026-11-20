// js/link-import.js: the person's side of "Add from a link": what was pasted, and what is said when it goes wrong.
const { check, done, assert, read } = require('./_harness');
const L = require('../js/link-import.js');

const norm = (t) => L.normalizeLinkInput(t);

check('empty input is asked for again, not guessed at', () => {
    assert.deepStrictEqual(norm(''), { ok: false, reason: 'EMPTY' });
    assert.deepStrictEqual(norm('   '), { ok: false, reason: 'EMPTY' });
    assert.deepStrictEqual(norm(null), { ok: false, reason: 'EMPTY' });
    assert.deepStrictEqual(norm(undefined), { ok: false, reason: 'EMPTY' });
});
check('a bare address gets https://, and the #fragment is dropped', () => {
    assert.deepStrictEqual(norm('store.com/item'), { ok: true, url: 'https://store.com/item' });
    assert.deepStrictEqual(norm('www.store.co.uk/x?y=1'), { ok: true, url: 'https://www.store.co.uk/x?y=1' });
    assert.deepStrictEqual(norm('https://store.com/item?id=1#top'), { ok: true, url: 'https://store.com/item?id=1' });
    assert.deepStrictEqual(norm('http://store.com'), { ok: true, url: 'http://store.com/' });
    assert.deepStrictEqual(norm('  HTTPS://STORE.COM/X  '), { ok: true, url: 'https://store.com/X' });
});
check('only http and https are accepted', () => {
    assert.strictEqual(norm('ftp://store.com/x').reason, 'UNSUPPORTED_SCHEME');
    assert.strictEqual(norm('javascript:alert(1)').reason, 'UNSUPPORTED_SCHEME');
    assert.strictEqual(norm('file:///etc/passwd').reason, 'UNSUPPORTED_SCHEME');
    assert.strictEqual(norm('data:text/html,hi').reason, 'UNSUPPORTED_SCHEME');
});
check('a username or password in the address is refused (and never sent anywhere)', () => {
    assert.strictEqual(norm('https://user:pw@store.com/x').reason, 'CREDENTIALS_IN_URL');
    assert.strictEqual(norm('https://user@store.com/x').reason, 'CREDENTIALS_IN_URL');
});
check('things that are not addresses', () => {
    for (const t of ['not a url', 'store', 'a.b', 'https://localhost/x', 'https://store.com/a b', '//store.com/x', 'http://']) {
        const r = norm(t);
        assert(!r.ok && r.reason === 'INVALID_URL', `${t} -> ${JSON.stringify(r)}`);
    }
});

check('every reason has a plain-language message', () => {
    for (const [reason, m] of Object.entries(L.IMPORT_MESSAGES)) {
        assert(typeof m.text === 'string' && m.text.length > 15, reason);
        assert(/[.!?]$/.test(m.text), `${reason} should read as a sentence`);
        assert(!/https?:\/\//.test(m.text), `${reason} must not echo an address`);
    }
    assert.strictEqual(Object.keys(L.IMPORT_MESSAGES).length, 25);
});
check('an unknown reason falls back to the general message', () => {
    assert.strictEqual(L.importMessage('NOPE'), L.IMPORT_MESSAGES.INTERNAL);
    assert.strictEqual(L.importMessage(undefined), L.IMPORT_MESSAGES.INTERNAL);
});
check('a problem with the address itself is marked "fix the link"; others offer "upload a photo instead"', () => {
    for (const r of ['EMPTY', 'INVALID_URL', 'UNSUPPORTED_SCHEME', 'CREDENTIALS_IN_URL', 'BLOCKED_HOST', 'BLOCKED_ADDRESS', 'UNSAFE_REDIRECT', 'NOT_A_PAGE', 'DNS_FAILED']) assert.strictEqual(L.IMPORT_MESSAGES[r].fixLink, true, r);
    for (const r of ['NOT_FOUND', 'LOGIN_REQUIRED', 'BLOCKED', 'NO_IMAGE', 'TIMEOUT', 'NETWORK']) {
        assert(!L.IMPORT_MESSAGES[r].fixLink, r);
        assert(/upload a photo/i.test(L.IMPORT_MESSAGES[r].text), `${r} should offer the upload`);
    }
    assert(/won’t be added twice/.test(L.IMPORT_MESSAGES.SAVE_FAILED.text), 'a retry cannot duplicate');
});
check('every reason the server function can give has a message here', () => {
    const files = ['functions/index.js', 'functions/lib/url-guard.js', 'functions/lib/safe-fetch.js', 'functions/lib/product-page.js', 'functions/lib/import-service.js', 'functions/lib/image-sniff.js'];
    const codes = new Set();
    files.forEach(f => { for (const m of read(f).matchAll(/new ImportError\('([A-Z_]+)'/g)) codes.add(m[1]); });
    assert(codes.size > 10, 'found the server reasons');
    // BAD_REQUEST is the server refusing a malformed call, which the page never sends; it reads as the general message
    codes.delete('BAD_REQUEST');
    const missing = [...codes].filter(c => !L.IMPORT_MESSAGES[c]);
    assert.deepStrictEqual(missing, [], 'reasons with no message: ' + missing.join(', '));
});
check('errors from the server call become one of those reasons', () => {
    assert.strictEqual(L.reasonFromError({ reason: 'NO_IMAGE' }), 'NO_IMAGE');
    assert.strictEqual(L.reasonFromError({ details: { reason: 'BLOCKED' } }), 'BLOCKED');
    assert.strictEqual(L.reasonFromError({ code: 'functions/unauthenticated' }), 'UNAUTHENTICATED');
    assert.strictEqual(L.reasonFromError({ code: 'functions/resource-exhausted' }), 'RATE_LIMITED');
    assert.strictEqual(L.reasonFromError({ code: 'functions/not-found' }), 'SERVICE_UNAVAILABLE', 'not deployed yet');
    assert.strictEqual(L.reasonFromError(null), 'SERVICE_UNAVAILABLE');
    assert.strictEqual(L.reasonFromError({ reason: 'bogus' }), 'SERVICE_UNAVAILABLE');
    assert.strictEqual(L.reasonFromError(new Error('offline')), 'SERVICE_UNAVAILABLE');
});
check('a saved photo must stay well under the 1 MB document limit', () => {
    assert(L.MAX_STORED_IMAGE_CHARS < 1000000 && L.MAX_STORED_IMAGE_CHARS >= 500000);
});
check('the saved item is independent and a retry reuses the same id (so it can never be added twice)', () => {
    const src = read('js/link-import.js');
    assert(/id: newItemId\(\)/.test(src) && /id: mine\.id/.test(src), 'the item id is made once when the window opens and reused on every save');
    assert(/sourceUrl/.test(src), 'the source address is kept as plain text');
    assert(!/imageUrl\s*:/.test(src), 'nothing refers to the store\'s image afterwards');
});

done();
