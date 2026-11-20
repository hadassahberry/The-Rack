// js/colors.js: the colour tagged on a new item (from a colour word in its name, else from the photo).
const { check, done, assert } = require('./_harness');
const Colors = require('../js/colors.js');

check('a colour word in the name is found', () => {
    assert.strictEqual(Colors.colorFromName('Navy Dress'), '#1f2a52');
    assert.strictEqual(Colors.colorFromName('dark brown boots'), '#4e2f1f');
    assert.strictEqual(Colors.colorFromName('Light blue shirt'), '#9cc4ee');
    assert.strictEqual(Colors.colorFromName('off white tee'), '#efe9dd');
    assert.strictEqual(Colors.colorFromName('blue'), '#2f6fd0');
});
check('a longer colour name wins over a colour word inside it ("navy blue" is not "blue")', () => {
    assert.deepStrictEqual(Colors.colorsInName('navy blue skirt'), ['#1f2a52']);
});
check('every distinct colour is listed in the order it appears', () => {
    assert.deepStrictEqual(Colors.colorsInName('Navy blue and red'), ['#1f2a52', '#c62828']);
    assert.deepStrictEqual(Colors.colorsInName('Black_White-top'), ['#222222', '#f5f5f5']);
});
check('look-alike words and empty text give nothing', () => {
    assert.deepStrictEqual(Colors.colorsInName('Redwood table'), []);
    assert.deepStrictEqual(Colors.colorsInName('blueberry'), []);
    assert.deepStrictEqual(Colors.colorsInName(''), []);
    assert.deepStrictEqual(Colors.colorsInName(null), []);
    assert.strictEqual(Colors.colorFromName('dress'), null);
});
check('of several named colours, the one closest to the photo is used', () => {
    assert.strictEqual(Colors.closestColor(['#ff0000', '#00ff00'], '#fe1010'), '#ff0000');
    assert.strictEqual(Colors.closestColor(['#ff0000', '#00ff00'], '#10fe10'), '#00ff00');
    assert.strictEqual(Colors.closestColor(['#ff0000', '#00ff00'], null), '#ff0000', 'no photo colour: the first');
    assert.strictEqual(Colors.closestColor(['#ff0000'], '#0000ff'), '#ff0000');
    assert.strictEqual(Colors.closestColor([], '#0000ff'), null);
});
check('every named colour is a valid hex colour', () => {
    for (const [name, hex] of Object.entries(Colors.COLOR_NAMES)) assert(/^#[0-9a-f]{6}$/.test(hex), `${name}: ${hex}`);
});

// ---- the colour of the garment in a photo ----
const frame = (size, bg, fg, inner) => {            // a plain background with a square garment in the middle
    const data = new Uint8ClampedArray(size * size * 4);
    const lo = Math.floor((size - inner) / 2), hi = lo + inner;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const c = (x >= lo && x < hi && y >= lo && y < hi) ? fg : bg, i = (y * size + x) * 4;
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
    return data;
};
check('the garment wins over a plain background', () => {
    const hex = Colors.dominantColorFromPixels(frame(40, [240, 240, 240], [200, 30, 30], 16), 40);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    assert(r > 150 && g < 80 && b < 80, hex);
});
check('a photo that is one colour all over gives that colour', () => {
    assert.strictEqual(Colors.dominantColorFromPixels(frame(10, [200, 30, 30], [200, 30, 30], 4), 10), '#c81e1e');
    assert.strictEqual(Colors.dominantColorFromPixels(frame(10, [250, 250, 250], [250, 250, 250], 4), 10), '#fafafa');
});
check('a fully transparent picture gives no colour', () => {
    assert.strictEqual(Colors.dominantColorFromPixels(new Uint8ClampedArray(10 * 10 * 4), 10), null);
});

done();
