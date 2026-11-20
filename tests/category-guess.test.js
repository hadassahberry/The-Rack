// js/category-guess.js: the category suggested from an item's name (only ever a suggestion).
const { check, done, assert, same } = require('./_harness');
const { guessCategory, categorySuggestionFor, CATEGORY_WORDS } = require('../js/category-guess.js');

check('plain clothing words are guessed', () => {
    const cases = { 'Black pleated midi skirt': 'bottoms', 'Floral summer dress': 'dresses', 'Navy button-down shirt': 'tops',
        'White sneakers': 'shoes', 'Wool coat': 'outerwear', 'Silk scarf': 'accessories', 'Blue jeans': 'bottoms', 'Linen tank': 'tops' };
    for (const [name, want] of Object.entries(cases)) assert.strictEqual(guessCategory(name), want, name);
});
check('the LAST clothing word names the garment', () => {
    assert.strictEqual(guessCategory('Sweater dress'), 'dresses');
    assert.strictEqual(guessCategory('Dress shirt'), 'tops');
    assert.strictEqual(guessCategory('Jean jacket'), 'outerwear');
    assert.strictEqual(guessCategory('Stripe sweater'), 'tops');
});
check('case, punctuation and file-style names do not matter', () => {
    assert.strictEqual(guessCategory('BLACK SKIRT'), 'bottoms');
    assert.strictEqual(guessCategory('t-shirt'), 'tops');
    assert.strictEqual(guessCategory('navy_pencil_skirt'), 'bottoms');
    assert.strictEqual(guessCategory('  Boots!! '), 'shoes');
});
check('no guess is better than a wrong one', () => {
    assert.strictEqual(guessCategory(''), null);
    assert.strictEqual(guessCategory(null), null);
    assert.strictEqual(guessCategory(undefined), null);
    assert.strictEqual(guessCategory('Favourite thing'), null);
    assert.strictEqual(guessCategory('IMG_20260101'), null);
    assert.strictEqual(guessCategory('top and skirt set'), null);
    assert.strictEqual(guessCategory('jacket with pants'), null);
    assert.strictEqual(guessCategory('shirt + jeans'), null);
    assert.strictEqual(guessCategory('shirt/skirt'), null);
    assert.strictEqual(guessCategory('outfit with dress and heels'), null);
});
check('several words from the SAME category still guess it', () => {
    assert.strictEqual(guessCategory('top and blouse'), 'tops');
});
check('words only count whole (a word inside a longer one is not a match)', () => {
    assert.strictEqual(guessCategory('Capital letters'), null);               // not "cap"
    assert.strictEqual(guessCategory('Shirtwaist'), null);
});
check('every listed word maps to exactly one category', () => {
    const seen = {};
    for (const [cat, words] of Object.entries(CATEGORY_WORDS)) words.forEach(w => { assert(!seen[w], `${w} in ${seen[w]} and ${cat}`); seen[w] = cat; });
    assert.strictEqual(Object.keys(CATEGORY_WORDS).length, 6);
});

check('the editor starts as a suggestion until the owner saves', () => {
    same(categorySuggestionFor({ category: 'bottoms', tagged: true }, 'tops'), { category: 'bottoms', kind: '', text: '' });
    const guessed = categorySuggestionFor({ category: 'bottoms', tagged: false, categoryGuess: 'name' }, 'tops');
    assert.strictEqual(guessed.kind, 'guess');
    assert.strictEqual(guessed.category, 'bottoms');
    assert(/We guessed Bottoms from the name\. Please check it\./.test(guessed.text));
    const recent = categorySuggestionFor({ category: 'tops', tagged: false }, 'shoes');
    assert.strictEqual(recent.kind, 'recent');
    assert.strictEqual(recent.category, 'shoes');
    assert(/Same as the last item you tagged \(Shoes\)/.test(recent.text));
    const unset = categorySuggestionFor({ category: 'tops', tagged: false }, null);
    assert.strictEqual(unset.kind, 'unset');
    assert(/Not chosen yet/.test(unset.text));
});
check('a guess beats "same as the last one", and an unknown last category is ignored', () => {
    assert.strictEqual(categorySuggestionFor({ category: 'dresses', tagged: false, categoryGuess: 'name' }, 'shoes').kind, 'guess');
    assert.strictEqual(categorySuggestionFor({ category: 'tops', tagged: false }, 'nonsense').kind, 'unset');
});

done();
