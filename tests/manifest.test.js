// manifest.webmanifest and the service worker's offline list, for installing the app and packaging it for Google Play
// (Trusted Web Activity): the manifest is valid and complete, its pictures really exist at the sizes it claims,
// every icon is cached for offline use, and Digital Asset Links name the Android app (com.therack).
const { check, done, assert, read, fs, path, root } = require('./_harness');

const raw = read('manifest.webmanifest');
const manifest = JSON.parse(raw);                                  // throws (and fails the run) if it is not valid JSON
const sw = read('sw.js');
const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'([^']+)'/g)].map(m => m[1]);

// the real size of a PNG, read from its header (so a screenshot that is not the size it claims is caught)
function pngSize(file) {
    const b = fs.readFileSync(path.join(root, file));
    assert.strictEqual(b.toString('latin1', 1, 4), 'PNG', file + ' is not a PNG');
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

check('the manifest is valid JSON and is the one the page links to', () => {
    assert.strictEqual(typeof manifest, 'object');
    assert(/<link rel="manifest" href="manifest\.webmanifest">/.test(read('index.html')));
});
check('the existing fields are unchanged', () => {
    assert.strictEqual(manifest.name, 'The Rack');
    assert.strictEqual(manifest.short_name, 'The Rack');
    assert.strictEqual(manifest.description, 'Your digital closet and outfit planner.');
    assert.strictEqual(manifest.start_url, './');
    assert.strictEqual(manifest.scope, './');
    assert.strictEqual(manifest.display, 'standalone');
    assert.strictEqual(manifest.background_color, '#f7ece5');
    assert.strictEqual(manifest.theme_color, '#7d2a44');
    assert.strictEqual(manifest.icons.length, 4);
});
check('id is the start URL, and the app is portrait', () => {
    assert.strictEqual(manifest.id, manifest.start_url);
    assert.strictEqual(manifest.orientation, 'portrait');
});
check('the language and text direction are stated, and match the page', () => {
    assert.strictEqual(manifest.lang, 'en');
    assert.strictEqual(manifest.dir, 'ltr');
    assert(/<html lang="en"/.test(read('index.html')), 'the page says the same language');
    assert(!/<html[^>]*\sdir="rtl"/.test(read('index.html')), 'and is not right-to-left');
});
check('the theme color in the page matches the manifest', () => {
    assert(new RegExp(`<meta name="theme-color" content="${manifest.theme_color}">`).test(read('index.html')));
});

check('icons: 192 and 512, "any" and "maskable", each a real PNG of the size it claims', () => {
    const key = (i) => `${i.sizes} ${i.purpose}`;
    assert.deepStrictEqual(manifest.icons.map(key).sort(), ['192x192 any', '192x192 maskable', '512x512 any', '512x512 maskable']);
    manifest.icons.forEach(i => {
        assert.strictEqual(i.type, 'image/png');
        assert.strictEqual(pngSize(i.src), i.sizes, i.src);
    });
});
check('every icon in the manifest (the two maskable ones included) is pre-cached by the service worker', () => {
    manifest.icons.forEach(i => assert(shell.includes(i.src), i.src + ' is not in the offline list'));
    assert(shell.includes('icons/icon-maskable-192.png') && shell.includes('icons/icon-maskable-512.png'));
});

check('screenshots: real PNGs of exactly the size they claim, with labels', () => {
    assert(Array.isArray(manifest.screenshots) && manifest.screenshots.length >= 2);
    manifest.screenshots.forEach(s => {
        assert.strictEqual(s.type, 'image/png');
        assert.strictEqual(pngSize(s.src), s.sizes, `${s.src} is ${pngSize(s.src)}, the manifest says ${s.sizes}`);
        assert(typeof s.label === 'string' && s.label.length > 5, 'a label for ' + s.src);
    });
});
check('screenshots: both phone ("narrow") and wide pictures, with the closet and the planner each', () => {
    const narrow = manifest.screenshots.filter(s => s.form_factor === 'narrow'), wide = manifest.screenshots.filter(s => s.form_factor === 'wide');
    assert(narrow.length >= 2 && wide.length >= 2);
    assert.strictEqual(narrow.length + wide.length, manifest.screenshots.length, 'every screenshot says which kind of screen it is for');
    for (const group of [narrow, wide]) {
        assert.strictEqual(new Set(group.map(s => s.sizes)).size, 1, 'all pictures of one form factor are the same size');
        assert(group.some(s => /planner/.test(s.src)) && group.some(s => /closet/.test(s.src)));
    }
});
check('screenshot sizes follow the install-dialog rules: each side 320-3840, never more than 2.3 times as long as wide; narrow is taller than wide, wide is wider than tall', () => {
    manifest.screenshots.forEach(s => {
        const [w, h] = s.sizes.split('x').map(Number);
        assert(w >= 320 && w <= 3840 && h >= 320 && h <= 3840, s.src);
        assert(Math.max(w, h) / Math.min(w, h) <= 2.3, s.src);
        if (s.form_factor === 'narrow') assert(h > w, s.src); else assert(w > h, s.src);
    });
});
check('the screenshots are the real app (not blank): each has more than a flat color of data', () => {
    manifest.screenshots.forEach(s => assert(fs.statSync(path.join(root, s.src)).size > 20000, s.src));
});

check('Digital Asset Links: assetlinks.json is in standard Trusted Web Activity form, for the package com.therack, with well-formed SHA-256 fingerprints', () => {
    const links = JSON.parse(fs.readFileSync(path.join(root, '.well-known', 'assetlinks.json'), 'utf8'));
    assert(Array.isArray(links) && links.length === 1, 'one statement');
    assert.deepStrictEqual(links[0].relation, ['delegate_permission/common.handle_all_urls']);
    assert.strictEqual(links[0].target.namespace, 'android_app');
    assert.strictEqual(links[0].target.package_name, 'com.therack');
    const prints = links[0].target.sha256_cert_fingerprints;
    assert(Array.isArray(prints) && prints.length >= 1);
    prints.forEach(p => assert(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(p), 'a SHA-256 fingerprint is 32 hex bytes separated by colons: ' + p));
});
check('the Android project uses the same package name as the assetlinks file, and the signing key is never published or committed', () => {
    const twa = JSON.parse(fs.readFileSync(path.join(root, 'android', 'twa-manifest.json'), 'utf8'));
    assert.strictEqual(twa.packageId, 'com.therack');
    assert.strictEqual(twa.host, 'the-rack-5787.web.app');
    assert.strictEqual(twa.webManifestUrl, 'https://the-rack-5787.web.app/manifest.webmanifest');
    assert(!/pass/i.test(JSON.stringify(twa)), 'no password in twa-manifest.json');
    const ignore = read('.gitignore'), hosting = JSON.parse(read('firebase.json')).hosting.ignore;
    const lines = ignore.split(String.fromCharCode(10)).map(l => l.trim());
    assert(lines.includes('*.keystore') && lines.includes('*.jks') && lines.includes('android/*'), 'git ignores keystores and the android folder');
    assert(hosting.includes('android/**'), 'hosting never publishes android/');
    assert(!hosting.includes('**/.*'), 'hosting must not ignore .well-known');
    const readme = read('README.md');
    assert(/Digital Asset Links/.test(readme) && /package name/.test(readme) && /SHA-256/.test(readme) && /Bubblewrap/.test(readme) && /Play App Signing/.test(readme));
});

done();
