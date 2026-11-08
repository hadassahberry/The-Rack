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

if (typeof module !== 'undefined') {
    module.exports = { stripFileExtension, cleanItemName, nameFromFilename };
}
