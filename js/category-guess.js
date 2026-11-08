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
    module.exports = { guessCategory, categorySuggestionFor, CATEGORY_WORDS };
}
