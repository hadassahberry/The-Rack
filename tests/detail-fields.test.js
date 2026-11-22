// The item editor's "More details": each field on its own row with its label above it, and only the details that make sense for
// the piece's category are shown (the rest are hidden entirely, never shown as "Not set").
// Plain Node, no packages: node tests/detail-fields.test.js
const { check, done, assert, read, vm } = require('./_harness');
const { detailFieldApplies, detailFieldsFor, SUGGEST_DETAIL_CATEGORIES, SUGGEST_DETAIL_ORDER } = require('../js/outfit-suggest.js');

const CATEGORIES = ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes', 'accessories'];
const FIELDS = ['warmth', 'formality', 'length', 'fit', 'layer', 'coverage'];

// ================= which details apply =================
check('the rules, exactly as asked: length, footwear, layer, fit, and warmth/formality', () => {
    const wants = {
        length: ['dresses', 'bottoms'],
        coverage: ['shoes'],
        layer: ['tops', 'outerwear'],
        fit: ['tops', 'bottoms', 'dresses'],
        warmth: ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes'],
        formality: ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes']
    };
    FIELDS.forEach(f => assert.deepStrictEqual(CATEGORIES.filter(c => detailFieldApplies(f, c)), CATEGORIES.filter(c => wants[f].includes(c)), f));
});
check('what each category shows, in editor order', () => {
    assert.deepStrictEqual(detailFieldsFor('tops'), ['warmth', 'formality', 'fit', 'layer']);
    assert.deepStrictEqual(detailFieldsFor('bottoms'), ['warmth', 'formality', 'length', 'fit']);
    assert.deepStrictEqual(detailFieldsFor('dresses'), ['warmth', 'formality', 'length', 'fit']);
    assert.deepStrictEqual(detailFieldsFor('outerwear'), ['warmth', 'formality', 'layer']);
    assert.deepStrictEqual(detailFieldsFor('shoes'), ['warmth', 'formality', 'coverage']);
    assert.deepStrictEqual(detailFieldsFor('accessories'), [], 'nothing applies to an accessory: the whole section is hidden');
});
check('what does NOT show: length never for tops, shoes or accessories; footwear only for shoes; fit never for shoes or accessories', () => {
    for (const c of ['tops', 'shoes', 'accessories', 'outerwear']) assert(!detailFieldsFor(c).includes('length'), 'length for ' + c);
    for (const c of CATEGORIES.filter(c => c !== 'shoes')) assert(!detailFieldsFor(c).includes('coverage'), 'footwear for ' + c);
    for (const c of ['shoes', 'accessories', 'outerwear']) assert(!detailFieldsFor(c).includes('fit'), 'fit for ' + c);
    for (const c of ['bottoms', 'dresses', 'shoes', 'accessories']) assert(!detailFieldsFor(c).includes('layer'), 'layer for ' + c);
    assert(!detailFieldsFor('accessories').some(f => f === 'warmth' || f === 'formality'));
});
check('an unknown category or field shows nothing', () => {
    for (const c of [undefined, null, '', 'hats', 5]) assert.deepStrictEqual(detailFieldsFor(c), []);
    assert.strictEqual(detailFieldApplies('nonsense', 'tops'), false);
    assert.deepStrictEqual([...SUGGEST_DETAIL_ORDER].sort(), [...Object.keys(SUGGEST_DETAIL_CATEGORIES)].sort());
});
check('every category the app has is covered by the rules', () => {
    assert(/const CATEGORIES = \['tops', 'bottoms', 'outerwear', 'shoes', 'dresses', 'accessories'\]/.test(read('js/closet.js')));
    CATEGORIES.forEach(c => assert(Array.isArray(detailFieldsFor(c))));
});

// ================= the layout: one field per row =================
const html = read('index.html');
const details = /<details id="modal-details"[\s\S]*?<\/details>/.exec(html)[0];
check('each detail is its own block with its label and its dropdown, in editor order', () => {
    const wrappers = [...details.matchAll(/<div class="detail-field" id="detail-(\w+)">([\s\S]*?)\n                <\/div>/g)];
    assert.deepStrictEqual(wrappers.map(m => m[1]), FIELDS);
    wrappers.forEach(([, name, inner]) => {
        assert.strictEqual((inner.match(/<label /g) || []).length, 1, name + ': exactly one label');
        assert.strictEqual((inner.match(/<select /g) || []).length, 1, name + ': exactly one dropdown');
        assert(new RegExp(`<label for="modal-${name}">[^<]+</label>`).test(inner), name + ': the label points at its own dropdown');
        assert(new RegExp(`<select id="modal-${name}">`).test(inner), name);
    });
});
check('nothing in the section sits outside a field block: no loose label or dropdown to wrap against another', () => {
    const outside = details.replace(/<div class="detail-field"[\s\S]*?\n                <\/div>/g, '');
    assert(!/<label|<select/.test(outside), outside);
    assert((details.match(/<label /g) || []).length === 6 && (details.match(/<select /g) || []).length === 6);
});
check('the labels say what the field is, with no "shoes only" qualifier (it is only shown for shoes)', () => {
    const labels = Object.fromEntries([...details.matchAll(/<label for="modal-(\w+)">([^<]+)<\/label>/g)].map(m => [m[1], m[2]]));
    assert.deepStrictEqual(labels, { warmth: 'Warmth', formality: 'Formality', length: 'Length', fit: 'Fit', layer: 'Layer', coverage: 'Footwear' });
});
check('the section tells the owner that only the details that make sense are shown', () => {
    assert(/Only the details that make sense for this kind of piece are shown\./.test(details));
});
check('the stylesheet puts each field in a column (label above its dropdown), full width, one per row', () => {
    const css = read('css/components.css');
    assert(/\.modal-details \.detail-field \{[^}]*display: flex;[^}]*flex-direction: column;/.test(css));
    assert(/\.modal-details \.detail-field select \{[^}]*width: 100%;/.test(css));
    assert(/\.modal-details \.detail-field label \{[^}]*font-weight: 600;/.test(css));
});
check('every field id is still unique and the dropdowns keep their choices (including Not set)', () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.strictEqual(new Set(ids).size, ids.length);
    FIELDS.forEach(f => assert(new RegExp(`<select id="modal-${f}">\\s*<option value="">Not set</option>`).test(details), f));
});

// ================= the editor =================
function makeEditor() {
    const mk = () => { const c = new Set(); return { classList: { toggle: (k, f) => { if (f) c.add(k); else c.delete(k); }, contains: (k) => c.has(k) } }; };
    const els = { 'modal-details': mk() };
    FIELDS.forEach(f => { els['detail-' + f] = mk(); });
    const src = read('js/closet.js');
    const from = src.indexOf('function updateDetailFields'), to = src.indexOf('// The values currently in the edit form.');
    assert(from > 0 && to > from);
    const S = require('../js/outfit-suggest.js');
    const ctx = vm.createContext({ document: { getElementById: (id) => els[id] }, detailFieldsFor: S.detailFieldsFor });
    vm.runInContext(src.slice(from, to) + '\nthis.api = { update: updateDetailFields, shown: detailShown };', ctx);
    const view = () => ({ shown: FIELDS.filter(f => ctx.api.shown(f)), sectionHidden: els['modal-details'].classList.contains('hidden') });
    return { api: ctx.api, view };
}
check('choosing a category shows exactly its details and hides the rest entirely', () => {
    const e = makeEditor();
    const expected = { tops: ['warmth', 'formality', 'fit', 'layer'], bottoms: ['warmth', 'formality', 'length', 'fit'], dresses: ['warmth', 'formality', 'length', 'fit'], outerwear: ['warmth', 'formality', 'layer'], shoes: ['warmth', 'formality', 'coverage'] };
    for (const [category, fields] of Object.entries(expected)) { e.api.update(category); assert.deepStrictEqual(e.view(), { shown: fields, sectionHidden: false }, category); }
});
check('an accessory shows no details at all: the whole "More details" section is hidden', () => {
    const e = makeEditor();
    e.api.update('accessories');
    assert.deepStrictEqual(e.view(), { shown: [], sectionHidden: true });
    e.api.update('tops');
    assert.strictEqual(e.view().sectionHidden, false, 'and it comes back for a top');
});
check('changing the category back and forth only toggles what is shown', () => {
    const e = makeEditor();
    e.api.update('shoes'); assert(e.api.shown('coverage') && !e.api.shown('fit'));
    e.api.update('tops'); assert(!e.api.shown('coverage') && e.api.shown('fit') && e.api.shown('layer'));
    e.api.update('dresses'); assert(e.api.shown('length') && !e.api.shown('layer'));
});
check('wiring: the category dropdown updates the section, the editor does it when it opens, and "open if something is set" counts only shown details', () => {
    const src = read('js/closet.js');
    assert(/getElementById\('modal-category'\)\.addEventListener\('change', \(\) => \{ showCategoryNote\(\{ text: '' \}\); updateDetailFields\(document\.getElementById\('modal-category'\)\.value\); \}\);/.test(src));
    const open = src.slice(src.indexOf('function openEditModal'), src.indexOf('// The line under the Category field'));
    assert(open.indexOf("document.getElementById('modal-category').value = suggestion.category") < open.indexOf('updateDetailFields('), 'after the category is set');
    assert(/updateDetailFields\(document\.getElementById\('modal-category'\)\.value\);/.test(open));
    assert(/if \(document\.getElementById\(id\)\.value !== '' && detailShown\(field\)\) anyDetail = true;/.test(open));
});
check('saving writes only the details that are shown; a hidden one keeps whatever the piece already had (nothing is cleared or invented)', () => {
    const src = read('js/closet.js');
    const patch = src.slice(src.indexOf('async function saveEditModal'), src.indexOf('async function deleteEditingItem'));
    FIELDS.forEach(f => assert(new RegExp(`\\.\\.\\.\\(detailShown\\('${f}'\\) \\? \\{ ${f}: document\\.getElementById\\('modal-${f}'\\)\\.value`).test(patch), f + ' is written only when shown'));
    assert(!/^\s+(warmth|formality|length|fit|layer|coverage): document/m.test(patch), 'no detail is written unconditionally');
    assert(/tagged: true/.test(patch));
});
check('the values are still read and refilled for every field (so a hidden one is not lost when the editor opens)', () => {
    const src = read('js/closet.js');
    FIELDS.forEach(f => { assert(new RegExp(`${f}: 'modal-${f}'`).test(src)); assert(new RegExp(`${f}: document\\.getElementById\\('modal-${f}'\\)\\.value`).test(src.slice(src.indexOf('function readEditForm')))); });
});

done();
