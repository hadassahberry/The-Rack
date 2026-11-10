// Turning a file name (or, later, text from a link such as a product title) into a tidy item name.
// Pure functions with no page access, so they can be tested on their own and reused by the
// link-import flow.
//
// This is ONLY for names the app derives by itself from something that was just brought in
// ("navy_button-down_shirt.jpg"). A name a person types or edits is never run through it, and
// existing items are never renamed. Nothing here shortens a name: the full text is kept (how much
// of it is DISPLAYED is a CSS matter: cards wrap and clamp, with a "Show full name" link).

const IMAGE_EXTENSION = /\.[A-Za-z0-9]{1,5}$/;      // ".jpg", ".jpeg", ".webp", ".heic"...

// Drops a trailing file extension. Only something that looks like one (1-5 letters/digits with at
// least one letter) is removed, so a name that merely ends in a number ("size 8.5") stays whole.
function stripFileExtension(fileName) {
    const text = String(fileName == null ? '' : fileName);
    const match = text.match(IMAGE_EXTENSION);
    return match && /[A-Za-z]/.test(match[0]) ? text.slice(0, -match[0].length) : text;
}

// Tidies text into a name:
//   - underscores become spaces and runs of whitespace collapse to one space;
//   - hyphens are kept (they are meaningful: "button-down"), except stray ones at the very ends;
//   - Each Word Is Capitalized, including each part of a hyphenated word:
//       "navy button-down shirt" -> "Navy Button-Down Shirt"
//     A word that already has a capital in it is left as it was ("iPhone", "McKinney", "T-shirt"
//     becomes "T-Shirt"), unless the whole name is in capitals ("NAVY SHIRT"), which is title-cased.
// Returns '' when nothing is left.
function cleanItemName(text) {
    const spaced = String(text == null ? '' : text)
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[\s-]+|[\s-]+$/g, '');                 // a leading/trailing hyphen is noise, not part of the name
    if (!spaced) return '';

    const wholeNameIsCapitals = /\p{Lu}/u.test(spaced) && !/\p{Ll}/u.test(spaced);
    // Split into words and the separators between them (spaces and hyphens), keeping both.
    return spaced.split(/([\s-]+)/).map(part => {
        if (!part || /^[\s-]+$/.test(part)) return part;
        if (wholeNameIsCapitals) return capitalizeFirstLetter(part.toLowerCase());
        if (/\p{Lu}/u.test(part)) return part;            // already has its own capitals: leave it
        return capitalizeFirstLetter(part);
    }).join('');
}

// Capitalizes the first letter of a word, skipping opening punctuation: "(blue)" -> "(Blue)".
function capitalizeFirstLetter(word) {
    return word.replace(/^([^\p{L}\p{N}]*)(\p{L})/u, (_, lead, letter) => lead + letter.toUpperCase());
}

// A new upload's name: "navy_button-down_shirt.jpg" -> "Navy Button-Down Shirt". When nothing
// usable is left (a file called "___.jpg"), the fallback is used.
function nameFromFilename(fileName, fallback = 'Item') {
    return cleanItemName(stripFileExtension(fileName)) || fallback;
}

// ---- Names from a product page (the "Add from a link" import) ----------------------------------

const alnum = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// The brand-ish part of a host name: "www.uniqlo.com" -> "uniqlo", "shop.example.co.uk" -> "example".
function brandOfHost(host) {
    const labels = String(host || '').toLowerCase().replace(/^www\d?\./, '').split('.').filter(Boolean);
    if (labels.length < 2) return labels[0] || '';
    const sld = ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(labels[labels.length - 2]) && labels.length > 2 ? labels.length - 3 : labels.length - 2;
    return labels[Math.max(sld, 0)];
}

// A page title usually ends with the store's name: "Womens Oxford Shirt | UNIQLO US",
// "Navy Shirt – Example Co.". Removes that part and tidies the rest like any derived name.
//   - a piece separated by " | " that is just a short tail is dropped even if we don't recognise it;
//   - a piece separated by " - " / " – " / " — " / " · " is only dropped when it matches the store's
//     name, its brand or its web address (so "Shirt - Navy" keeps its colour);
//   - if that would leave nothing, the whole title is kept.
// The result is only a suggestion: it fills the Name field, which the person can change.
function nameFromProductTitle(title, { siteName = '', brand = '', host = '' } = {}) {
    const whole = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
    if (!whole) return '';
    const known = [siteName, brand, brandOfHost(host)].map(alnum).filter(k => k.length >= 3);
    const isStore = (piece) => { const p = alnum(piece); return p.length > 0 && known.some(k => p === k || p.includes(k) || (k.length >= 5 && k.includes(p) && p.length >= 4)); };

    let pieces = whole.split(/\s+\|\s+|\s+[-–—·•]\s+/);
    const piped = /\s\|\s/.test(whole);
    if (pieces.length > 1) {
        const kept = pieces.filter((p, i) => !(i > 0 && isStore(p)) && !(i === 0 && pieces.length > 1 && isStore(p) && pieces.some((q, j) => j > 0 && !isStore(q))));
        pieces = kept.length ? kept : pieces;
        if (piped && pieces.length > 1) {                                   // an unrecognised short tail after a pipe is a site name too
            const first = pieces[0];
            const tail = pieces.slice(1);
            if (tail.every(t => t.split(' ').length <= 4)) pieces = [first];
        }
    }
    // Put back exactly the separators that were between the pieces that stayed.
    const result = pieces.length === 1 ? pieces[0] : pieces.join(' - ');
    return cleanItemName(result.replace(/[®™©]/g, '')) || cleanItemName(whole.replace(/[®™©]/g, ''));
}

if (typeof module !== 'undefined') {
    module.exports = { stripFileExtension, cleanItemName, nameFromFilename, nameFromProductTitle, brandOfHost };
}
