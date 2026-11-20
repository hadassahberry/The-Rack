// The page's own wiring, checked as text (no browser): every script exists, is cached for offline use and loads in a
// workable order; every element the scripts look up exists; the item editor's fields match what the code reads,
// saves and what "Help me choose" understands; and the files only for developers are not published.
const { check, done, assert, read, fs, path, root, loadScript } = require('./_harness');

const html = read('index.html');
const sw = read('sw.js');
const scriptsInPage = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'([^']+)'/g)].map(m => m[1]);
const idsInPage = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// ---- scripts and the offline cache ----
check('every script the page loads exists', () => {
    assert(scriptsInPage.length > 30);
    scriptsInPage.forEach(f => assert(fs.existsSync(path.join(root, f)), f + ' is missing'));
});
check('every script is in the service worker\'s offline list (a new file left out would not work offline)', () => {
    const missing = scriptsInPage.filter(f => !shell.includes(f));
    assert.deepStrictEqual(missing, [], 'not cached: ' + missing.join(', '));
});
check('everything in the offline list exists, and the list has no duplicates', () => {
    shell.filter(f => f !== './').forEach(f => assert(fs.existsSync(path.join(root, f)), f + ' is listed but missing'));
    assert.strictEqual(new Set(shell).size, shell.length, 'duplicates in SHELL');
    ['index.html', 'manifest.webmanifest', 'css/variables.css', 'css/layout.css', 'css/components.css'].forEach(f => assert(shell.includes(f), f));
});
check('the stylesheets the page loads are all cached too', () => {
    [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].forEach(m => assert(shell.includes(m[1]), m[1]));
});
check('scripts load in an order that works (a file that uses another one\'s names comes after it)', () => {
    const at = (f) => { const i = scriptsInPage.indexOf(f); assert(i >= 0, f + ' is not loaded'); return i; };
    const before = (a, b) => assert(at(a) < at(b), `${a} must load before ${b}`);
    before('js/state.js', 'js/auth.js');
    before('js/dialog.js', 'js/confirm.js');
    before('js/confirm.js', 'js/save-state.js');
    for (const user of ['js/calendar.js', 'js/closet.js', 'js/settings.js']) before('js/save-state.js', user);
    before('js/view-range.js', 'js/calendar.js');
    before('js/apply-outfit.js', 'js/calendar.js');
    before('js/calendar-access.js', 'js/calendar.js');
    before('js/calendars.js', 'js/calendar.js');
    before('js/activities.js', 'js/activity-combo.js');
    before('js/item-name.js', 'js/closet.js');
    before('js/category-guess.js', 'js/closet.js');
    before('js/photo-frame.js', 'js/closet.js');
    before('js/colors.js', 'js/closet.js');
    before('js/outfit-suggest.js', 'js/help-choose.js');
    before('js/help-content.js', 'js/welcome.js');
    before('js/closet.js', 'js/help-choose.js');
    before('js/calendar.js', 'js/help-choose.js');
});

// ---- elements the scripts look up ----
check('every element a script looks up by id exists in the page', () => {
    const own = { 'reset-password.js': 'reset-password.html' };            // that script runs on its own page
    const dynamic = new Set(['tour-progress', 'tour-title', 'tour-text', 'tour-back', 'tour-next', 'tour-skip']);   // built by js/tour.js
    const problems = [];
    fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).forEach(f => {
        const src = read('js/' + f);
        const pageIds = own[f] ? new Set([...read(own[f]).matchAll(/\bid="([^"]+)"/g)].map(m => m[1])) : idsInPage;
        for (const m of src.matchAll(/(?:getElementById|\$)\('([A-Za-z0-9_-]+)'\)/g)) {
            if (!pageIds.has(m[1]) && !dynamic.has(m[1])) problems.push(`${f}: #${m[1]}`);
        }
    });
    assert.deepStrictEqual(problems, []);
});
check('no id appears twice in the page', () => {
    const all = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const dupes = all.filter((id, i) => all.indexOf(id) !== i);
    assert.deepStrictEqual(dupes, []);
});
check('every label points at a real field', () => {
    const problems = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map(m => m[1]).filter(id => !idsInPage.has(id));
    assert.deepStrictEqual(problems, []);
    const bad = [...html.matchAll(/aria-(?:controls|labelledby|describedby)="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)).filter(id => !idsInPage.has(id));
    assert.deepStrictEqual(bad, [], 'aria references to missing ids');
});

// ---- the item editor ----
const optionValues = (id) => {
    const m = new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
    assert(m, id + ' not found');
    return [...m[1].matchAll(/<option value="([^"]*)"/g)].map(o => o[1]);
};
check('the item editor has every field, including the optional ones for Help me choose', () => {
    for (const id of ['modal-name', 'modal-category', 'modal-occasion', 'modal-season', 'modal-color', 'modal-warmth', 'modal-formality', 'modal-length', 'modal-fit', 'modal-layer', 'save-item-btn', 'cancel-item-btn', 'edit-close-btn', 'delete-item-btn', 'edit-save-status', 'modal-details']) {
        assert(idsInPage.has(id), id);
    }
    assert(/<details id="modal-details"/.test(html) && /More details \(optional\)/.test(html));
});
check('the optional fields offer "Not set" and only values Help me choose understands', () => {
    const S = loadScript('js/outfit-suggest.js', {}, ['SUGGEST_LENGTHS', 'SUGGEST_FITS', 'SUGGEST_LAYERS']);
    assert.deepStrictEqual(optionValues('modal-warmth'), ['', '1', '2', '3', '4', '5']);
    assert.deepStrictEqual(optionValues('modal-formality'), ['', '1', '2', '3', '4', '5']);
    assert.deepStrictEqual(optionValues('modal-length'), ['', ...JSON.parse(JSON.stringify(S.SUGGEST_LENGTHS))]);
    assert.deepStrictEqual(optionValues('modal-fit'), ['', ...JSON.parse(JSON.stringify(S.SUGGEST_FITS))]);
    assert.deepStrictEqual(optionValues('modal-layer'), ['', ...JSON.parse(JSON.stringify(S.SUGGEST_LAYERS))]);
});
check('the category, occasion and season choices match what the rest of the app expects', () => {
    assert.deepStrictEqual(optionValues('modal-category'), ['tops', 'bottoms', 'outerwear', 'shoes', 'dresses', 'accessories']);
    assert.deepStrictEqual(optionValues('modal-occasion'), ['casual', 'work', 'formal', 'workout']);
    assert.deepStrictEqual(optionValues('modal-season'), ['all-season', 'summer', 'winter']);
    assert(/const CATEGORIES = \['tops', 'bottoms', 'outerwear', 'shoes', 'dresses', 'accessories'\]/.test(read('js/closet.js')));
});
check('the editor reads, saves and refills the same fields (unset is saved as null so it is estimated again)', () => {
    const closet = read('js/closet.js');
    for (const f of ['warmth', 'formality', 'length', 'fit', 'layer']) {
        assert(new RegExp(`${f}: 'modal-${f}'`).test(closet), `${f} is refilled when the editor opens`);
        assert(new RegExp(`${f}: document\\.getElementById\\('modal-${f}'\\)\\.value`).test(closet), `${f} is part of "did anything change?"`);
    }
    const patch = closet.slice(closet.indexOf('async function saveEditModal'), closet.indexOf('async function deleteEditingItem'));
    assert(/warmth: document\.getElementById\('modal-warmth'\)\.value === '' \? null : Number/.test(patch));
    assert(/formality: document\.getElementById\('modal-formality'\)\.value === '' \? null : Number/.test(patch));
    for (const f of ['length', 'fit', 'layer']) assert(new RegExp(`${f}: document\\.getElementById\\('modal-${f}'\\)\\.value \\|\\| null`).test(patch), f);
    assert(/tagged: true/.test(patch), 'saving still confirms the item');
});
check('the editor waits for the server before closing, and keeps what was typed on failure', () => {
    const closet = read('js/closet.js');
    const save = closet.slice(closet.indexOf('async function saveEditModal'), closet.indexOf('async function deleteEditingItem'));
    assert(/closetSaves\.run\('item:' \+ id/.test(save));
    assert(/if \(!ok\) return;/.test(save), 'stays open on failure');
    assert(save.indexOf('closeEditModal()') > save.indexOf('if (!ok) return;'), 'closes only after a confirmed save');
});

// ---- Help me choose buttons ----
check('Help me choose is offered in the day window and in the outfit builder, with a place for the ideas', () => {
    for (const id of ['help-choose-btn', 'choose-panel', 'build-help-btn', 'build-choose-panel']) assert(idsInPage.has(id), id);
    assert(/id="choose-panel"[^>]*role="region"/.test(html));
});

// ---- what is published ----
check('files only for developers are not published with the site', () => {
    const cfg = JSON.parse(read('firebase.json'));
    const ignore = cfg.hosting.ignore;
    assert(ignore.includes('functions/**'));
    assert(ignore.includes('tests/**'), 'tests/ should not be served from the live site');
});

done();
