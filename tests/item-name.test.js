// js/item-name.js: tidy names made from file names and product titles (never from names a person types).
const { check, done, assert } = require('./_harness');
const { stripFileExtension, cleanItemName, nameFromFilename, nameFromProductTitle, brandOfHost } = require('../js/item-name.js');

check('file extensions come off, numbers that only look like one stay', () => {
    assert.strictEqual(stripFileExtension('shirt.jpg'), 'shirt');
    assert.strictEqual(stripFileExtension('shirt.JPEG'), 'shirt');
    assert.strictEqual(stripFileExtension('a.b.webp'), 'a.b');
    assert.strictEqual(stripFileExtension('size 8.5'), 'size 8.5');
    assert.strictEqual(stripFileExtension('no extension'), 'no extension');
    assert.strictEqual(stripFileExtension(null), '');
    assert.strictEqual(stripFileExtension(undefined), '');
});
check('underscores become spaces, spacing collapses, hyphens stay, Each Word Is Capitalized', () => {
    assert.strictEqual(cleanItemName('navy_button-down   shirt'), 'Navy Button-Down Shirt');
    assert.strictEqual(cleanItemName('  black   pleated skirt '), 'Black Pleated Skirt');
    assert.strictEqual(cleanItemName('high-waisted_jeans'), 'High-Waisted Jeans');
    assert.strictEqual(cleanItemName('(blue) dress'), '(Blue) Dress');
});
check('a word with its own capitals is left alone; an ALL CAPS name is title-cased', () => {
    assert.strictEqual(cleanItemName('iPhone case'), 'iPhone Case');
    assert.strictEqual(cleanItemName('McKinney tee'), 'McKinney Tee');
    assert.strictEqual(cleanItemName('NAVY SHIRT'), 'Navy Shirt');
    assert.strictEqual(cleanItemName('T-shirt'), 'T-Shirt');
});
check('stray hyphens at the ends are noise; empty input gives nothing', () => {
    assert.strictEqual(cleanItemName('-blue shirt-'), 'Blue Shirt');
    assert.strictEqual(cleanItemName(''), '');
    assert.strictEqual(cleanItemName('___'), '');
    assert.strictEqual(cleanItemName(null), '');
});
check('names are never shortened (they used to be cut at 20 characters)', () => {
    const long = 'a_very_long_name_for_a_navy_blue_wool_pleated_midi_skirt_with_pockets.jpg';
    const out = nameFromFilename(long);
    assert.strictEqual(out, 'A Very Long Name For A Navy Blue Wool Pleated Midi Skirt With Pockets');
    assert(out.length > 20);
});
check('a file name that leaves nothing falls back', () => {
    assert.strictEqual(nameFromFilename('___.jpg'), 'Item');
    assert.strictEqual(nameFromFilename('.jpg'), 'Item');
    assert.strictEqual(nameFromFilename('', 'Piece'), 'Piece');
    assert.strictEqual(nameFromFilename('navy_button-down shirt.jpg'), 'Navy Button-Down Shirt');
});

check('the brand of a host', () => {
    assert.strictEqual(brandOfHost('www.uniqlo.com'), 'uniqlo');
    assert.strictEqual(brandOfHost('shop.example.co.uk'), 'example');
    assert.strictEqual(brandOfHost('example.com'), 'example');
    assert.strictEqual(brandOfHost('localhost'), 'localhost');
    assert.strictEqual(brandOfHost(''), '');
});
check('product titles lose the store name but keep colours and details', () => {
    assert.strictEqual(nameFromProductTitle('Womens Oxford Shirt | UNIQLO US', { siteName: 'UNIQLO US', host: 'www.uniqlo.com' }), 'Womens Oxford Shirt');
    assert.strictEqual(nameFromProductTitle('Navy Shirt – Example Co.', { siteName: 'Example Co.', host: 'example.com' }), 'Navy Shirt');
    assert.strictEqual(nameFromProductTitle('Shirt - Navy', { siteName: 'Example Co.', host: 'example.com' }), 'Shirt - Navy');
    assert.strictEqual(nameFromProductTitle('Linen Dress | Some Shop', {}), 'Linen Dress');              // an unrecognised short tail after a pipe
});
check('a title that would be left empty is kept whole; trademarks and blanks are tidied', () => {
    assert.strictEqual(nameFromProductTitle('Example', { siteName: 'Example', host: 'example.com' }), 'Example');
    assert.strictEqual(nameFromProductTitle('Classic Tee® | Example', { siteName: 'Example' }), 'Classic Tee');
    assert.strictEqual(nameFromProductTitle('   ', {}), '');
    assert.strictEqual(nameFromProductTitle(null), '');
});

done();
