// A cheap, honest guess at an item's category from its name (file names are often
// product names: "Black pleated midi skirt", "Floral summer dress"). It is only ever a
// SUGGESTION: the app shows it as a guess, keeps the item "needs tagging", and treats the
// category as confirmed only when the owner saves the item.
//
// The word that names the garment is nearly always the last clothing word ("Stripe
// Sweater", "Sweater Dress", "Dress Shirt", "Jean Jacket"), so the LAST matching word wins.
// A name that lists several things ("top and skirt set") or has no clothing word at all
// gets no guess, because a wrong guess is worse than none.

const CATEGORY_WORDS = {
    tops: ['shirt', 'shirts', 'tee', 'tees', 'tshirt', 'blouse', 'blouses', 'top', 'tops', 'sweater', 'sweaters',
        'sweatshirt', 'hoodie', 'hoodies', 'pullover', 'tank', 'cami', 'camisole', 'tunic', 'polo', 'turtleneck',
        'crewneck', 'jumper', 'bodysuit', 'henley', 'cardigan', 'cardigans'],
    bottoms: ['skirt', 'skirts', 'jeans', 'jean', 'pants', 'pant', 'trousers', 'trouser', 'leggings', 'legging',
        'shorts', 'culottes', 'slacks', 'chinos', 'joggers', 'sweatpants', 'skort', 'palazzo', 'capris', 'jeggings'],
    dresses: ['dress', 'dresses', 'gown', 'jumpsuit', 'romper', 'sundress'],
    outerwear: ['coat', 'coats', 'jacket', 'jackets', 'blazer', 'blazers', 'parka', 'trench', 'puffer', 'windbreaker',
        'raincoat', 'cape', 'poncho', 'shacket', 'bomber', 'anorak', 'overcoat', 'vest', 'gilet'],
    shoes: ['shoe', 'shoes', 'sneaker', 'sneakers', 'boot', 'boots', 'heel', 'heels', 'sandal', 'sandals', 'flats',
        'loafer', 'loafers', 'pumps', 'slippers', 'clogs', 'oxfords', 'mules', 'trainers', 'wedges', 'espadrilles', 'booties'],
    accessories: ['scarf', 'scarves', 'hat', 'hats', 'cap', 'beanie', 'belt', 'belts', 'bag', 'bags', 'purse',
        'handbag', 'tote', 'backpack', 'gloves', 'glove', 'mittens', 'sunglasses', 'necklace', 'earrings', 'bracelet',
        'watch', 'tie', 'ties', 'headband', 'jewelry', 'wallet', 'shawl', 'bow']
};

const WORD_TO_CATEGORY = {};
Object.entries(CATEGORY_WORDS).forEach(([category, words]) => words.forEach(w => { WORD_TO_CATEGORY[w] = category; }));

// 'tops' | 'bottoms' | 'dresses' | 'outerwear' | 'shoes' | 'accessories', or null for "no idea".
function guessCategory(name) {
    const lower = String(name || '').toLowerCase();
    const words = lower.match(/[a-z]+/g) || [];                 // "t-shirt" -> t, shirt
    const hits = words.map(w => WORD_TO_CATEGORY[w]).filter(Boolean);
    if (hits.length === 0) return null;
    const several = new Set(hits).size > 1;
    // "top and skirt set", "jacket with pants", "outfit": more than one thing, so no guess.
    if (several && /\b(and|with|plus|set|pair|outfit|combo)\b|[+&/]/.test(lower)) return null;
    return hits[hits.length - 1];
}

// ---- the pattern, guessed from the name ----
// A name often already says it ("Navy striped tee", "Floral midi dress", "Houndstooth blazer"). Like the category guess this is
// only ever a SUGGESTION: the editor pre-fills the Pattern field with it, says so, and nothing is saved until the owner saves the
// item (and they can change it first). It is never applied to a piece that already has a pattern saved, and it never guesses a
// pattern's STRENGTH (bold or subtle): the name can't say that.
// A name with two different pattern words ("striped floral top") gets no guess, and so does one with no pattern word at all.
// Words that only sound like patterns are left out on purpose: "flowy" is not floral, and "rose" is a color. "Houndstooth",
// polka dots, paisley, checks, animal prints and the like have no choice of their own, so they suggest "Other pattern".
const PATTERN_WORDS = {
    striped: ['stripe', 'stripes', 'striped', 'stripey', 'stripy', 'pinstripe', 'pinstripes', 'pinstriped', 'breton'],
    plaid: ['plaid', 'plaids', 'tartan', 'tartans'],
    floral: ['floral', 'florals', 'flower', 'flowers', 'flowered', 'blossom', 'blossoms', 'botanical', 'ditsy'],
    other: ['houndstooth', 'herringbone', 'paisley', 'polka', 'dot', 'dots', 'dotted', 'polkadot', 'gingham', 'check', 'checks',
        'checked', 'checkered', 'chequered', 'argyle', 'chevron', 'leopard', 'cheetah', 'zebra', 'snakeskin', 'camo', 'camouflage',
        'dye', 'geometric', 'abstract', 'ikat', 'batik', 'toile', 'print', 'printed', 'patterned'],
    solid: ['solid']
};
const WORD_TO_PATTERN = {};
Object.entries(PATTERN_WORDS).forEach(([pattern, words]) => words.forEach(w => { WORD_TO_PATTERN[w] = pattern; }));
const PATTERN_CHOICES = ['solid', 'striped', 'plaid', 'floral', 'other'];                 // the values the Pattern field can hold
const PATTERN_LABELS = { solid: 'Solid', striped: 'Striped', plaid: 'Plaid', floral: 'Floral', other: 'Other pattern' };

// { pattern, word } for the pattern the name suggests ('solid' | 'striped' | 'plaid' | 'floral' | 'other') and the word that said
// so, or null for no idea (no pattern word, or words that point to different patterns).
function guessPattern(name) {
    const words = String(name || '').toLowerCase().match(/[a-z]+/g) || [];                // "pin-striped" -> pin, striped; "tie_dye" -> tie, dye
    const hits = words.filter(w => WORD_TO_PATTERN[w]);
    if (hits.length === 0) return null;
    const patterns = new Set(hits.map(w => WORD_TO_PATTERN[w]));
    if (patterns.size > 1) return null;                                                    // "striped floral": the name does not settle it
    return { pattern: WORD_TO_PATTERN[hits[0]], word: hits[0] };
}

// What the editor's Pattern field STARTS as, and whether that is only a suggestion.
//   name: the item's name (or what is typed now)   saved: the pattern stored on the item, or undefined when the field was never set
// kind: 'saved' (a pattern is already saved: it always wins, even if the name says something else)
//     | 'decided' (the field exists but is Unknown: the owner already said Unknown, so the name never overrides it)
//     | 'guess' (the field was NEVER SET and the name says a pattern) | 'none' (never set, and the name says nothing)
// Only an ABSENT field is "never set". null, "unknown", an empty string or anything unrecognised is a decision already made (an
// explicit Unknown is stored as null), and is never replaced by a suggestion.
// Nothing returned here is ever saved by itself: it is what the form shows until the owner presses Save.
function patternSuggestionFor(name, saved) {
    const stored = typeof saved === 'string' ? saved.trim().toLowerCase() : '';
    if (PATTERN_CHOICES.includes(stored)) return { pattern: stored, kind: 'saved', word: '', text: '' };
    if (saved !== undefined) return { pattern: '', kind: 'decided', word: '', text: '' };
    const guess = guessPattern(name);
    if (!guess) return { pattern: '', kind: 'none', word: '', text: '' };
    return {
        pattern: guess.pattern, kind: 'guess', word: guess.word,
        text: `Suggested “${PATTERN_LABELS[guess.pattern]}” from the name (“${guess.word}”). Please check it.`
    };
}

const CATEGORY_LABELS = { tops: 'Tops', bottoms: 'Bottoms', outerwear: 'Outerwear', shoes: 'Shoes', dresses: 'Dresses', accessories: 'Accessories' };

// What the editor's Category field STARTS as for an item, and whether that is only a
// suggestion. Nothing returned here is ever saved or counted as confirmed: it is what the
// form shows until the owner presses Save.
//   item: { category, tagged, categoryGuess? }   lastTagged: the category confirmed on the
//   last item tagged in this session (or null).
// kind: '' (already confirmed, no note) | 'guess' | 'recent' | 'unset'
function categorySuggestionFor(item, lastTagged) {
    if (item.tagged) return { category: item.category, kind: '', text: '' };
    if (item.categoryGuess) {
        return { category: item.category, kind: 'guess',
            text: `We guessed ${CATEGORY_LABELS[item.category] || item.category} from the name. Please check it.` };
    }
    if (lastTagged && CATEGORY_LABELS[lastTagged]) {
        return { category: lastTagged, kind: 'recent',
            text: `Same as the last item you tagged (${CATEGORY_LABELS[lastTagged]}). Please check it.` };
    }
    return { category: item.category, kind: 'unset', text: 'Not chosen yet. Please pick the category.' };
}

if (typeof module !== 'undefined') {
    module.exports = { guessCategory, categorySuggestionFor, CATEGORY_WORDS, guessPattern, patternSuggestionFor, PATTERN_WORDS, PATTERN_CHOICES };
}
