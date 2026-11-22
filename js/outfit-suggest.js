// "Help me choose": suggests complete outfits from the pieces a person already owns.
//
// Everything here is plain, deterministic JavaScript that runs on the device: no network, no AI service, no
// cost. It is pure (no page access, no randomness, no clock), so the same closet and the same day always give
// the same suggestions, and it can be tested on its own (tests/outfit-suggest.test.js).
//
// ---- Piece metadata (stored on each closet item, editable in the item editor under "More details") ----
//   category   tops | bottoms | dresses | outerwear | shoes | accessories     (already on every item)
//   color      one hex color                                                 (already on every item)
//   season     summer | all-season | winter                                   (already on every item)
//   occasion   casual | work | formal | workout                               (already on every item)
//   warmth     1 (very light) .. 5 (very warm)        optional   \
//   formality  1 (athletic) .. 5 (formal)             optional    |  NEW, all optional. When one isn't set it is
//   length     short | mid | long                     optional    |  ESTIMATED from the fields above (see
//   fit        fitted | regular | loose               optional    |  describePiece), never invented silently.
//   layer      base | mid | outer                     optional   /   (a "mid" top, such as a sweater, is estimated warmer)
//   coverage   open | closed | boot  (shoes only)     optional   a sandal is "open": warmth can't say that, so shoes carry
//                                                                 their own field (estimated from the name: sandal, slide,
//                                                                 flip-flop, mule, espadrille... = open; boot = boot; else closed)
//   pattern    solid | striped | plaid | floral | other   optional   Anything else (a piece with no pattern saved, or the word
//                                                                 "unknown") is UNKNOWN. Unknown is never guessed and never
//                                                                 treated as solid. The stored piece is never rewritten to
//                                                                 say so: it is only read as unknown.
//   patternStrength  subtle | bold                          optional   How loud a pattern is. Only what the person set counts:
//                                                                 it is never guessed from the kind of pattern ("floral" is
//                                                                 not assumed bold). Anything else is UNKNOWN.
//
// ---- Pieces with more than one color ----
//   otherColors  ['#rrggbb', ...]  optional   Colors of the piece IN ADDITION to its main color (`color`), at most 3: the blue in a
//                                             tan-and-blue striped skirt. The stored piece is never rewritten to say so: a piece with
//                                             none saved simply has one color. Nothing is guessed here (the editor can SUGGEST them
//                                             from the name, but only what the person saves counts).
// A piece's colors are its main color plus those. When an outfit pairs a SINGLE-color piece (a solid one, or any piece whose only
// known color is its main one) with a piece that has SEVERAL colors, the single color must coordinate with EVERY color of the
// other piece: a camel sweater has to go with the blue in a tan-and-blue skirt, not only with its tan. If any color clashes, the
// outfit is marked down hard (0.25 on the 0..1 scale for each such pair, at most 0.40) and the idea says which colors clash.
// "Coordinates" is deliberately stricter here than the whole-outfit color score: black, white, gray, navy, dark colors and colors
// in the same family (within 50 degrees of hue) coordinate with anything; two different bright colors, and a warm neutral like
// camel or tan with a bright cool color like blue, do not. A patterned piece with only one color set is checked on that color and
// the idea says its other colors weren't known. It is a penalty, never a ban: if nothing better exists the idea is still shown.
//
// ---- How patterns are scored (soft: nothing is ever ruled out) ----
// Patterns only move an outfit up or down; an outfit is never rejected, hidden or cut from the list because of its patterns.
//   - Two KNOWN-patterned pieces that are both BOLD compete: the outfit's score goes down (0.16 on the 0..1 scale for each such
//     pair, at most 0.30 in all). A bold pattern with a subtle one, or two subtle ones, do not compete: no penalty.
//   - Shared color helps without guaranteeing anything. Each piece has one main color; two patterned pieces whose main
//     colors are close share a color. For two bold patterns that halves the penalty (0.08); for a pair that does not
//     compete it adds a small bonus (0.02). Missing or invalid colors are never assumed to match.
//   - Unknown is not a clash and not a match. A piece with no pattern, or a pattern with no strength set, adds no penalty and no
//     bonus, and the idea says plainly that the check was incomplete and for which pieces. Unknown is never called solid.
//   - When every idea has competing bold patterns, the notes say so: these are the closest the closet allows.
// This applies to suggestions only: an outfit the person built, planned or saved by hand is never changed, blocked or re-checked.
//
// ---- What an outfit is ----
// Exactly ONE top and ONE bottom, or ONE dress instead of both. Outerwear, shoes and an accessory are separate
// optional slots (one piece each). A sweater or cardigan is simply a top when it is chosen: a second top is never
// stacked on another. When it is cold the answer is a warmer single top or outerwear, never another top.
//
// ---- How an outfit is scored (0 to 100; every part is 0..1, weights add up to 10.5) ----
//   weather   3.0  how close the outfit's insulation is to what the day needs; outerwear is required when it is
//                  wet (and when it is cold unless the single top is already warm), and discouraged in the heat
//   formality 2.5  how close the outfit's formality is to what the day's activities and holidays ask for
//   recency   1.5  pieces worn lately score low, pieces not worn for a while score high; an outfit that repeats
//                  one planned on the same Shabbos / Yom Tov weekend, or worn in the last 7 days, is pushed down hard
//   color     1.5  neutrals go with anything; two or three colors are scored by how far apart their hues are
//   fit       1.0  length and fit rules (a long top with a short bottom, a fitted jacket over a loose top...)
//   season    0.5  a summer piece in the cold, a winter piece in the heat
//   tag       0.5  the pieces' own occasion tag matches the kind of day
// Combinations you actually wore (outfits marked as worn; planned or saved ones never count) about 3-4 weeks before
// the day (18 to 31 days, counted from the MOST RECENT time that exact top+bottom, or dress, was worn together) get a
// small bonus, so a favourite can come back. The bonus is only 6 points: it cannot override weather, occasion, season,
// fit or the cold-weather footwear rule, nor the protection against recent repeats, and at most one idea in a list is a
// past combination (the rest are new ones). With no suitable past outfit, suggestions are exactly as before.
// Pieces worn in the last 7 days (tops, bottoms, dresses, outerwear) are left out altogether when the closet has
// anything else in that category. The 2-3 ideas are then picked so that NO piece appears in more than one of them;
// if the closet is too small for that, fewer ideas are shown (only shoes and accessories may repeat, and only when
// that is the only way to show at least two ideas).

const SUGGEST_CATEGORIES = ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes', 'accessories'];
const SUGGEST_LENGTHS = ['short', 'mid', 'long'];
const SUGGEST_FITS = ['fitted', 'regular', 'loose'];
const SUGGEST_LAYERS = ['base', 'mid', 'outer'];
const SUGGEST_COVERAGES = ['open', 'closed', 'boot'];
const SUGGEST_PATTERNS = ['solid', 'striped', 'plaid', 'floral', 'other'];            // what can be saved; no value = unknown
const SUGGEST_PATTERNED = ['striped', 'plaid', 'floral', 'other'];                      // the ones that count as patterned (solid does not; unknown is not known)
const SUGGEST_PATTERN_STRENGTHS = ['subtle', 'bold'];                                  // what can be saved; no value = unknown
const SUGGEST_PATTERN_CLASH = 0.16;              // score points (0..1 scale) taken off for each pair of competing bold patterns
const SUGGEST_PATTERN_CLASH_SHARED = 0.08;       // ...when the two share a color
const SUGGEST_PATTERN_SHARED_BONUS = 0.02;       // a pair of patterns that do not compete but share a color
const SUGGEST_PATTERN_MAX_PENALTY = 0.30;        // however many pairs compete
const SUGGEST_SHARED_COLOR_DISTANCE = 60;        // two colors this close (RGB distance) count as shared
const SUGGEST_MAX_COLORS = 4;                    // a piece's main color plus at most three others
const SUGGEST_COLOR_CLASH = 0.25;                // score points (0..1 scale) taken off for each single-color/multi-color pair with a clashing color
const SUGGEST_COLOR_MAX_PENALTY = 0.40;          // however many pairs clash
const SUGGEST_COLOR_FAMILY_DEGREES = 50;         // hues this close are one family: they coordinate

// What a stored pattern means: one of the five, or 'unknown' (nothing saved, null, "unknown", or anything unrecognised).
function normalizePattern(value) {
    const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SUGGEST_PATTERNS.includes(v) ? v : 'unknown';
}

// What a stored pattern strength means: 'subtle', 'bold', or 'unknown' (nothing saved, or anything unrecognised).
function normalizePatternStrength(value) {
    const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SUGGEST_PATTERN_STRENGTHS.includes(v) ? v : 'unknown';
}
// What the item editor saves for the Pattern strength field: the same rules as patternPatch (an unset field on a piece with
// nothing saved writes nothing; choosing saves it; clearing a saved one writes null).
function patternStrengthPatch(existing, selected) {
    const v = SUGGEST_PATTERN_STRENGTHS.includes(selected) ? selected : '';
    if (v) return { patternStrength: v };
    return normalizePatternStrength(existing && existing.patternStrength) === 'unknown' ? {} : { patternStrength: null };
}

// What the item editor saves for the Pattern field, as a patch for the stored piece. A piece that has no pattern saved
// stays exactly as it is when the field is left unset (nothing is written), so existing pieces are never touched just
// because they were opened and saved; choosing a pattern saves it; clearing a saved one writes null.
function patternPatch(existing, selected) {
    const v = SUGGEST_PATTERNS.includes(selected) ? selected : '';
    if (v) return { pattern: v };
    return normalizePattern(existing && existing.pattern) === 'unknown' ? {} : { pattern: null };
}
const SUGGEST_OPEN_SHOE_NAME = /\b(sandals?|flip[- ]?flops?|slides?|sliders?|slingbacks?|mules?|espadrilles?|gladiators?|huaraches|jellies|jelly|crocs|open[- ]toe[d]?|peep[- ]toe[d]?|thongs?)\b/i;
const SUGGEST_BOOT_NAME = /\b(boots?|booties|bootie|chelsea|wellies|wellingtons)\b/i;
const SUGGEST_RECENT_DAYS = 7;                                    // "worn in the last 7 days"
const SUGGEST_FRESH_DAYS = 45;                                    // after this long a piece counts as fully "rested"
const SUGGEST_RECENCY_CATEGORIES = ['tops', 'bottoms', 'dresses', 'outerwear'];   // shoes and accessories repeat all the time
const SUGGEST_PAST_MIN_DAYS = 18;                                 // "about 3 weeks" (21 days), three days of give either side
const SUGGEST_PAST_MAX_DAYS = 31;                                 // "about 4 weeks" (28 days)
const SUGGEST_PAST_BONUS = 0.06;                                  // on the 0..1 score: a nudge, never an override
const SUGGEST_WEIGHTS = { weather: 3, formality: 2.5, recency: 1.5, color: 1.5, fit: 1, season: 0.5, tag: 0.5 };
const SUGGEST_WEIGHT_SUM = Object.values(SUGGEST_WEIGHTS).reduce((a, b) => a + b, 0);

const SUGGEST_WARMTH_LABELS = ['', 'Very light', 'Light', 'Medium', 'Warm', 'Very warm'];
const SUGGEST_FORMALITY_LABELS = ['', 'Athletic', 'Casual', 'Smart casual', 'Dressy', 'Formal'];

// ---- keywords: what a day's activity / holiday / the person's own words say about formality ----
// [pattern, formality 1..5, plain label]. A dressier match is what the outfit has to satisfy.
const SUGGEST_EVENTS = [
    [/\b(wedding|gala|black tie|funeral|bar mitzvah|bat mitzvah|formal)\b/, 5, 'a formal event'],
    [/\b(yom tov|yomtov|rosh hashana|rosh hashanah|yom kippur|pesach|passover|sukkos|sukkot|shavuos|shavuot|simchas torah|simchat torah|shemini atzeres)\b/, 4.5, 'the holiday'],
    [/\b(interview|presentation|conference)\b/, 4, 'a professional day'],
    [/\b(shabbos|shabbat|sabbath|shul|synagogue|church|mosque|temple|easter|eid)\b/, 4, 'a dressy day'],
    [/\b(teaching|teach|work|office|meeting|school)\b/, 3.5, 'work'],
    [/\b(dinner|date|party|event|celebration|concert|show)\b/, 3.5, 'an evening out'],
    [/\b(christmas|chanukah|hanukkah|purim|diwali)\b/, 3.5, 'the holiday'],
    [/\b(class|lecture|going out)\b/, 3, 'the day'],
    [/\b(brunch|lunch|coffee|shopping|errands|day out|park|travel|trip|casual|relax|relaxing|home)\b/, 2, 'a casual day'],
    [/\b(workout|gym|run|running|yoga|hike|hiking|walk|walking|sport|sports|exercise|swim|swimming)\b/, 1, 'activity']
];

// ---- small helpers ----
function sgClamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function sgOne5(v) { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null; }
function sgDays(aKey, bKey) { return Math.round((new Date(bKey) - new Date(aKey)) / 86400000); }   // bare dates = UTC midnight: exact days
function sgName(piece) { return piece.item.name || 'piece'; }

// A color as { neutral, hue, s, l } from '#rrggbb'. Black, white, grey, beige/brown/tan and navy/denim are neutrals.
function sgColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return { neutral: true, hue: 0, s: 0, l: 0.5, known: false };
    const n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    let h = 0, s = 0;
    if (d > 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
    }
    const neutral = s < 0.2 || l < 0.15 || l > 0.9
        || (h >= 15 && h <= 50 && s < 0.55 && l > 0.2 && l < 0.82)          // beige, tan, camel, brown, khaki
        || (h >= 200 && h <= 250 && l < 0.36);                               // navy and dark denim
    return { neutral, hue: h, s, l, known: true };
}

const SUGGEST_MID_NAME = /\b(cardigan|sweater|jumper|hoodie|pullover|fleece|vest|sweatshirt|shrug)\b/i;

// One piece with every field filled: what the person set, else an estimate from category, season and occasion.
function describePiece(item) {
    const cat = item.category;
    const season = item.season === 'summer' || item.season === 'winter' ? item.season : 'all-season';
    const warmthByCat = {
        tops: { summer: 1, 'all-season': 2, winter: 3 }, bottoms: { summer: 1, 'all-season': 2, winter: 3 },
        dresses: { summer: 1, 'all-season': 2, winter: 3 }, outerwear: { summer: 2, 'all-season': 3, winter: 5 },
        shoes: { summer: 1, 'all-season': 2, winter: 4 }, accessories: { summer: 1, 'all-season': 2, winter: 3 }
    };
    const formalityByOccasion = { workout: 1, casual: 2, work: 4, formal: 5 };
    const setWarmth = sgOne5(item.warmth), setFormality = sgOne5(item.formality);
    let layer = SUGGEST_LAYERS.includes(item.layer) ? item.layer : null;
    const layerSet = !!layer;
    if (!layer) layer = cat === 'outerwear' ? 'outer' : cat === 'tops' ? (SUGGEST_MID_NAME.test(item.name || '') ? 'mid' : 'base') : null;
    // a sweater, cardigan or hoodie is a warmer top than a tee (when the person has not set the warmth themselves)
    const sweaterBonus = cat === 'tops' && layer === 'mid' ? 1 : 0;
    // shoes: open (sandals), closed, or boot: what the person set, else guessed from the name (anything else is closed)
    const name = item.name || '';
    const coverage = cat !== 'shoes' ? null
        : SUGGEST_COVERAGES.includes(item.coverage) ? item.coverage
        : SUGGEST_OPEN_SHOE_NAME.test(name) ? 'open' : SUGGEST_BOOT_NAME.test(name) ? 'boot' : 'closed';
    return {
        item, id: item.id, cat, season, occasion: item.occasion || 'casual',
        warmth: setWarmth !== null ? setWarmth : Math.min(5, (warmthByCat[cat] || warmthByCat.tops)[season] + sweaterBonus),
        formality: setFormality !== null ? setFormality : (formalityByOccasion[item.occasion] || 2.5),
        length: SUGGEST_LENGTHS.includes(item.length) ? item.length : null,
        fit: SUGGEST_FITS.includes(item.fit) ? item.fit : null,
        layer, layerSet, coverage,
        pattern: normalizePattern(item.pattern),
        patterned: SUGGEST_PATTERNED.includes(normalizePattern(item.pattern)),      // a KNOWN pattern; solid and unknown are not
        strength: normalizePatternStrength(item.patternStrength),                  // only what the person set: 'subtle' | 'bold' | 'unknown'
        colors: sgPieceColors(item),                                               // the main color, then any other colors the person saved
        color: sgColor(item.color),
        estimated: { warmth: setWarmth === null, formality: setFormality === null }
    };
}

// ---- what the day asks for ----
const SUGGEST_WET = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SUGGEST_SNOW = new Set([71, 73, 75, 77, 85, 86]);

// weather: { high, low, code } in °F, or null (no forecast: weather is simply not considered).
function sgWeatherNeed(weather, warmthShift) {
    if (!weather || !Number.isFinite(weather.high)) return { has: false, target: 3 + warmthShift };
    const low = Number.isFinite(weather.low) ? weather.low : weather.high;
    const feels = weather.high * 0.65 + low * 0.35;
    const steps = [[82, 1.5], [72, 2], [64, 2.5], [56, 3.2], [48, 4], [40, 5], [32, 6]];
    let target = 7;
    for (const [at, t] of steps) { if (feels >= at) { target = t; break; } }
    const snow = SUGGEST_SNOW.has(weather.code), rain = SUGGEST_WET.has(weather.code);
    return { has: true, feels, target: sgClamp(target + warmthShift, 1, 8), cold: feels < 55, veryCold: feels < 40, hot: feels >= 78, wet: rain || snow, snow, rain };
}

// Reads the activities, holidays and the person's own words. Returns { target, events: [{label, formality, text}] }.
function sgFormalityNeed(texts, flags, shift) {
    const found = [];
    const seen = new Set();
    const add = (formality, label, text) => { const k = formality + label + text; if (!seen.has(k)) { seen.add(k); found.push({ formality, label, text }); } };
    (texts || []).forEach(raw => {
        const text = String(raw || '').toLowerCase();
        if (!text.trim()) return;
        for (const [re, f, label] of SUGGEST_EVENTS) { if (re.test(text)) { add(f, label, String(raw).trim()); break; } }   // dressiest keyword group first (the list is in that order)
    });
    if (flags && flags.isYomTov) add(4.5, 'the holiday', 'Yom Tov');
    else if (flags && flags.isShabbat) add(4, 'Shabbos', 'Shabbos');
    let base = 2.5;
    if (found.length === 1) base = found[0].formality;
    else if (found.length > 1) {
        const max = Math.max(...found.map(e => e.formality)), mean = found.reduce((a, e) => a + e.formality, 0) / found.length;
        base = (max + mean) / 2;            // a day with several things in it leans dressy but must still work for the casual part
    }
    return { target: sgClamp(base + shift, 1, 5), events: found, base };
}

function sgExpectedOccasion(target) { return target <= 1.5 ? 'workout' : target <= 2.7 ? 'casual' : target <= 4.2 ? 'work' : 'formal'; }

// What the person typed in the optional box: words that nudge formality or warmth, and pieces named outright.
function parseRefineText(text, items) {
    const t = String(text || '').toLowerCase();
    const out = { formalityShift: 0, warmthShift: 0, keepIds: [], heard: [] };
    if (!t.trim()) return out;
    if (/\b(dressy|dress up|dressier|fancy|smarter|elegant)\b/.test(t)) { out.formalityShift += 1; out.heard.push('dressier'); }
    if (/\b(comfy|comfortable|relaxed|more casual|casual|easy)\b/.test(t) && !/\bgoing out\b/.test(t.replace(/casual/g, ''))) { out.formalityShift -= 1; out.heard.push('more casual'); }
    if (/\b(cold|chilly|freezing|cool|warmer|warm up)\b/.test(t)) { out.warmthShift += 1; out.heard.push('warmer'); }
    if (/\b(hot|lighter|breezy|sweaty)\b/.test(t)) { out.warmthShift -= 1; out.heard.push('lighter'); }
    (items || []).forEach(i => {
        const name = String(i.name || '').toLowerCase().trim();
        if (name.length >= 4 && t.includes(name)) { out.keepIds.push(i.id); out.heard.push(`keeping your ${i.name}`); }
    });
    return out;
}

// ---- colors: do these go together? 0..1 ----
function sgColorScore(pieces) {
    const chromatic = pieces.filter(p => !p.color.neutral);
    if (pieces.length > 0 && chromatic.length === 0) return 0.95;                // all neutrals: always fine, a touch plain
    if (chromatic.length <= 1) return 1;                                          // one color among neutrals
    const pair = (a, b) => {
        let d = Math.abs(a.color.hue - b.color.hue); if (d > 180) d = 360 - d;
        let s = d <= 25 ? 1 : d <= 60 ? 0.55 : d <= 120 ? 0.3 : d < 150 ? 0.5 : 0.8;   // same family, neighbours, clash, clash, near-opposite
        if (a.color.s > 0.65 && b.color.s > 0.65 && d > 40 && d < 140) s *= 0.7;        // two loud colors that aren't related
        return s;
    };
    let sum = 0, n = 0;
    for (let i = 0; i < chromatic.length; i++) for (let j = i + 1; j < chromatic.length; j++) { sum += pair(chromatic[i], chromatic[j]); n++; }
    return (sum / n) * (chromatic.length > 2 ? 0.9 : 1);
}

// ---- length and layering rules: 0..1 ----
const SG_LOOSE = { fitted: 0, regular: 1, loose: 2 };
function sgFitScore(o) {
    let s = 1;
    const top = o.top, bottom = o.bottom;
    if (top && bottom && top.length === 'long' && bottom.length === 'short') s -= 0.4;                  // a long top over a short bottom
    if (top && bottom && top.fit === 'loose' && bottom.fit === 'loose') s -= 0.15;                      // both loose: shapeless
    const inner = top || o.dress;
    if (o.outer && inner && o.outer.fit && inner.fit && SG_LOOSE[inner.fit] - SG_LOOSE[o.outer.fit] >= 2) s -= 0.25;   // a fitted jacket over a loose top
    if (o.outer && top && o.outer.length === 'short' && top.length === 'long') s -= 0.15;               // the top hangs out below the jacket
    return sgClamp(s, 0, 1);
}

// ---- the main entry ----
// ctx:
//   items          the closet [{ id, name, category, color, season, occasion, warmth?, formality?, length?, fit?, layer? }]
//   dateKey        'YYYY-MM-DD' the day being dressed for
//   weather        { high, low, code } in °F for that day, or null
//   texts          what the day holds: activities and holiday names (plain strings)
//   isShabbat, isYomTov   booleans (only when the Hebrew calendar is on)
//   worn           [{ date, itemIds }] outfits marked as worn (planning is never wearing)
//   weekendPlanned [{ date, itemIds }] outfits planned on the other days of the same Shabbos / Yom Tov weekend
// options (a refinement; all optional):
//   formalityShift +1 "More dressy" / -1 "More casual",  warmthShift +1 "Warmer" / -1 "Lighter",
//   keepIds pieces that must stay,  text what the person typed,  exclude signatures already shown,  max (default 3)
// Returns { suggestions: [{ itemIds, pieces, reason, score, parts, signature }], need, notes, heard }.
function suggestOutfits(ctx, options) {
    const opt = Object.assign({ formalityShift: 0, warmthShift: 0, keepIds: [], text: '', exclude: [], max: 3 }, options || {});
    const notes = [];
    const closet = (ctx.items || []).filter(i => i && i.id && SUGGEST_CATEGORIES.includes(i.category));
    const typed = parseRefineText(opt.text, closet);
    const formalityShift = opt.formalityShift + typed.formalityShift;
    const warmthShift = opt.warmthShift + typed.warmthShift;
    let keepIds = [...new Set([...(opt.keepIds || []), ...typed.keepIds])].filter(id => closet.some(i => i.id === id));

    const weatherNeed = sgWeatherNeed(ctx.weather, warmthShift);
    const textsForFormality = [...(ctx.texts || []), opt.text];
    const formalityNeed = sgFormalityNeed(textsForFormality, { isShabbat: ctx.isShabbat, isYomTov: ctx.isYomTov }, formalityShift);
    const need = { weather: weatherNeed, formality: formalityNeed, occasion: sgExpectedOccasion(formalityNeed.target), warmthShift, formalityShift };

    const all = closet.map(describePiece);
    const byId = new Map(all.map(p => [p.id, p]));

    // days since each piece was last worn (before this day); only outfits marked as worn count
    const sinceWorn = new Map();
    (ctx.worn || []).forEach(w => {
        const d = sgDays(w.date, ctx.dateKey);
        if (d >= 1) (w.itemIds || []).forEach(id => { if (!sinceWorn.has(id) || d < sinceWorn.get(id)) sinceWorn.set(id, d); });
    });
    const recentlyWorn = (p) => SUGGEST_RECENCY_CATEGORIES.includes(p.cat) && sinceWorn.has(p.id) && sinceWorn.get(p.id) <= SUGGEST_RECENT_DAYS;
    const fresh = (p) => sinceWorn.has(p.id) ? Math.min(sinceWorn.get(p.id), SUGGEST_FRESH_DAYS) / SUGGEST_FRESH_DAYS : 0.85;
    const recentOutfits = (ctx.worn || []).filter(w => { const d = sgDays(w.date, ctx.dateKey); return d >= 1 && d <= SUGGEST_RECENT_DAYS; }).map(w => new Set(w.itemIds || []));
    const weekendOutfits = (ctx.weekendPlanned || []).map(w => new Set(w.itemIds || []));

    // ---- combinations worn about 3-4 weeks ago ----
    // A "combination" is the top + bottom, or the dress, of an outfit marked as worn (shoes, outerwear and accessories
    // may differ). Only the MOST RECENT time it was worn counts: one worn again last week is not "a month ago".
    const MAIN_CATS = ['tops', 'bottoms', 'dresses'];
    const mainKey = (ids) => [...ids].sort().join('+');
    const lastWornCombo = new Map();                                  // main key -> { days, ids }
    (ctx.worn || []).forEach(w => {
        const days = sgDays(w.date, ctx.dateKey);
        const ids = w.itemIds || [];
        if (days < 1 || ids.length === 0 || ids.some(id => !byId.has(id))) return;       // a piece that is gone: that combination can't come back
        const main = ids.map(id => byId.get(id)).filter(p => MAIN_CATS.includes(p.cat));
        const dresses = main.filter(p => p.cat === 'dresses').length, tops = main.filter(p => p.cat === 'tops').length, bottoms = main.filter(p => p.cat === 'bottoms').length;
        if (!((dresses === 1 && tops === 0 && bottoms === 0) || (dresses === 0 && tops === 1 && bottoms === 1))) return;      // not one clear outfit
        const key = mainKey(main.map(p => p.id));
        const seen = lastWornCombo.get(key);
        if (!seen || days < seen.days) lastWornCombo.set(key, { days, ids: main.map(p => p.id) });
    });
    // still suitable today: none of its pieces worn in the last week, and none out of season for this weather
    const stillSuitable = (p) => !recentlyWorn(p) && !(weatherNeed.has && ((weatherNeed.cold && p.season === 'summer') || (weatherNeed.hot && p.season === 'winter')));
    const pastCombos = new Map();                                     // main key -> { days, ids }
    lastWornCombo.forEach((v, key) => {
        if (v.days >= SUGGEST_PAST_MIN_DAYS && v.days <= SUGGEST_PAST_MAX_DAYS && v.ids.every(id => stillSuitable(byId.get(id)))) pastCombos.set(key, v);
    });
    const pastText = (days) => `You wore these together about ${days <= 24 ? 'three' : 'four'} weeks ago.`;

    // ---- the pool for each category ----
    const keptIn = (cat) => all.filter(p => p.cat === cat && keepIds.includes(p.id));
    const hasOuterPieces = all.some(p => p.cat === 'outerwear');
    const needsClosedShoes = weatherNeed.has && (weatherNeed.cold || weatherNeed.snow || (weatherNeed.wet && weatherNeed.feels < 70));
    const hasShoes = all.some(p => p.cat === 'shoes');
    const hasClosedShoes = all.some(p => p.cat === 'shoes' && p.coverage !== 'open');
    const relaxed = [];
    const K = { tops: 8, bottoms: 8, dresses: 6, outerwear: 6, shoes: 6, accessories: 4 };
    const pieceKey = (p) => {
        const fit = 1 - Math.abs(p.formality - formalityNeed.target) / 3;
        return -(0.6 * fit + 0.4 * fresh(p));
    };
    const pool = (cat, filterFn) => {
        const kept = keptIn(cat).filter(p => !filterFn || filterFn(p));
        if (kept.length) return kept;
        let list = all.filter(p => p.cat === cat && (!filterFn || filterFn(p)));
        // Footwear is a weather REQUIREMENT, like outerwear for rain: no open shoes (sandals) when it is cold, snowy or
        // cool and wet. If the closet has no closed shoes or boots, shoes are left out rather than suggesting sandals.
        if (cat === 'shoes' && needsClosedShoes) list = list.filter(p => p.coverage !== 'open');
        const rested = list.filter(p => !recentlyWorn(p));
        if (rested.length) list = rested; else if (list.length && SUGGEST_RECENCY_CATEGORIES.includes(cat)) relaxed.push(cat);
        // a summer piece is not offered in the cold, nor a winter piece in the heat, when something else will do
        const inSeason = list.filter(p => !(weatherNeed.has && ((weatherNeed.cold && p.season === 'summer') || (weatherNeed.hot && p.season === 'winter'))));
        if (inSeason.length) list = inSeason;
        list.sort((a, b) => pieceKey(a) - pieceKey(b) || (a.id < b.id ? -1 : 1));
        const best = list.slice(0, K[cat] || 4);
        // Nothing is ruled out by pattern, but a quieter piece should stay within reach: if the best few are all bold-patterned,
        // the best two that are not bold-patterned come along too, so a better-matching outfit is never missed just because
        // it ranked lower on formality or freshness
        const loud = (p) => p.patterned && p.strength === 'bold';
        if (best.length && best.every(loud)) best.push(...list.filter(p => !loud(p) && !best.includes(p)).slice(0, 2));
        return best;
    };

    // One top and one bottom, or one dress; plus at most one each of outerwear, shoes and an accessory.
    const bodyWarmth = (o) => (o.dress ? o.dress.warmth : o.top.warmth * 0.6 + o.bottom.warmth * 0.4);     // the top counts most
    const buildAll = () => {
        const tops = pool('tops'), bottoms = pool('bottoms'), dresses = pool('dresses');
        const outers = pool('outerwear'), shoes = pool('shoes'), accessories = pool('accessories');
        // a past combination's pieces are always among the candidates (so it can be scored), unless the person asked to keep other pieces
        pastCombos.forEach(v => v.ids.map(id => byId.get(id)).forEach(p => {
            const list = p.cat === 'tops' ? tops : p.cat === 'bottoms' ? bottoms : dresses;
            if (!keptIn(p.cat).length && !list.some(q => q.id === p.id)) list.push(p);
        }));
        const keptOuter = keptIn('outerwear').length > 0;
        const cores = [];
        tops.forEach(t => bottoms.forEach(b => cores.push({ top: t, bottom: b })));
        dresses.forEach(d => cores.push({ dress: d }));
        const shoeOpts = shoes.length ? shoes : [null];
        const outerOpts = keptOuter ? outers : [null, ...outers];
        let out = [];
        for (const core of cores) for (const shoe of shoeOpts) for (const outer of outerOpts) out.push({ ...core, shoes: shoe, outer, acc: null });
        // The weather rules are requirements, not hints: when it is wet, outerwear (if the closet has any); when it
        // is cold, outerwear unless the single top is already a warm one.
        if (weatherNeed.has && outers.length) {
            const needs = (o) => (weatherNeed.wet && !o.outer) || (weatherNeed.cold && !o.outer && bodyWarmth(o) < 3.5);
            const ok = out.filter(o => !needs(o));
            if (ok.length) out = ok;
        }
        return { candidates: out, accessories };
    };

    const members = (o) => [o.top, o.bottom, o.dress, o.outer, o.shoes, o.acc].filter(Boolean);
    const mainIds = (o) => [o.top, o.bottom, o.dress].filter(Boolean).map(p => p.id);
    const signature = (o) => members(o).map(p => p.id).sort().join('+');

    const score = (o) => {
        const ms = members(o);
        const mainPieces = [o.top, o.bottom, o.dress].filter(Boolean);
        // weather: insulation = the body (the top counts most) plus 0.6 of the outerwear's warmth
        const body = bodyWarmth(o);
        const insulation = body + (o.outer ? o.outer.warmth * 0.6 : 0);
        let weather;
        if (!weatherNeed.has) {
            weather = o.outer ? 0.4 : 0.6;                                         // no forecast: outerwear is optional, not encouraged
        } else {
            weather = sgClamp(1 - Math.abs(insulation - weatherNeed.target) / 4, 0, 1);
            if (weatherNeed.cold && !o.outer && body < 3.5 && hasOuterPieces) weather *= 0.5;   // cold: outerwear or a warm top
            if (weatherNeed.wet && !o.outer && hasOuterPieces) weather *= 0.5;                  // wet: outerwear
            if (weatherNeed.hot && o.outer) weather *= 0.6;
        }
        // formality: core pieces count fully, shoes a bit less, layers and accessories least
        const wts = ms.map(p => (p === o.shoes ? 0.6 : p === o.outer ? 0.6 : p === o.acc ? 0.2 : 1));
        const wsum = wts.reduce((a, b) => a + b, 0) || 1;
        const outfitFormality = ms.reduce((a, p, i) => a + p.formality * wts[i], 0) / wsum;
        const formality = sgClamp(1 - Math.abs(outfitFormality - formalityNeed.target) / 3, 0, 1);
        // recency
        const tracked = ms.filter(p => SUGGEST_RECENCY_CATEGORIES.includes(p.cat));
        // (a combination brought back from 3-4 weeks ago is not marked down for having been worn then: that is the point)
        const pastHit = pastCombos.get(mainKey(mainIds(o))) || null;
        const pastIds = pastHit ? new Set(pastHit.ids) : null;
        let recency = tracked.length ? tracked.reduce((a, p) => a + (pastIds && pastIds.has(p.id) ? 0.85 : fresh(p)), 0) / tracked.length : 0.85;
        const mainSet = mainIds(o);
        const sameAs = (set) => mainSet.length > 0 && mainSet.every(id => set.has(id));
        const wornRecentlyAsOutfit = recentOutfits.some(sameAs);
        const weekendRepeat = weekendOutfits.some(sameAs);
        const weekendShared = weekendOutfits.reduce((a, set) => a + tracked.filter(p => set.has(p.id)).length, 0);
        recency = sgClamp(recency - 0.2 * weekendShared, 0, 1);
        const color = sgColorScore(ms);
        const fit = sgFitScore({ top: o.top, bottom: o.bottom, dress: o.dress, outer: o.outer });
        // season: summer pieces in the cold, winter pieces in the heat
        let season = 1;
        if (weatherNeed.has) {
            const bad = ms.filter(p => (p.season === 'summer' && weatherNeed.cold) || (p.season === 'winter' && weatherNeed.hot)).length;
            season = sgClamp(1 - bad / Math.max(1, ms.length) * 1.5, 0, 1);
        }
        const wantTag = need.occasion;
        const tag = mainPieces.length ? mainPieces.filter(p => p.occasion === wantTag).length / mainPieces.length : 0.5;
        const parts = { weather, formality, recency, color, fit, season, tag };
        let total = 0;
        Object.keys(SUGGEST_WEIGHTS).forEach(k => { total += SUGGEST_WEIGHTS[k] * parts[k]; });
        total = total / SUGGEST_WEIGHT_SUM;
        const patternFlags = patternAnalysis(ms);                                      // soft: competing bold patterns cost points, shared color helps a little
        const colorFlags = colorAnalysis(ms);                                          // a single-color piece must go with EVERY color of a multi-color one
        total = Math.max(0, total + patternFlags.adjust + colorFlags.adjust);
        const past = pastHit;
        if (past) total += SUGGEST_PAST_BONUS;                                        // a combination you wore 3-4 weeks ago: a nudge
        if (wornRecentlyAsOutfit || weekendRepeat) total *= 0.4;                      // a repeat is the last resort
        return { total, parts, flags: { wornRecentlyAsOutfit, weekendRepeat, insulation, outfitFormality, past, pattern: patternFlags, color: colorFlags } };
    };

    const rank = (cands, accessories) => {
        const scored = cands.map(o => ({ o, s: score(o) }));
        scored.sort((a, b) => b.s.total - a.s.total || (signature(a.o) < signature(b.o) ? -1 : 1));
        // an accessory is added to the best few when it helps (colors and formality still fit)
        const top = scored.slice(0, 250);                    // deep enough to find ideas that share no piece
        if (accessories.length) {
            const forced = accessories.some(a => keepIds.includes(a.id));        // a kept accessory is always worn
            top.forEach(entry => {
                let best = forced ? null : entry;
                accessories.forEach(acc => {
                    if (forced && !keepIds.includes(acc.id)) return;
                    const withAcc = { ...entry.o, acc };
                    const s = score(withAcc);
                    if (!best || s.total > best.s.total + 0.005) best = { o: withAcc, s };
                });
                entry.o = best.o; entry.s = best.s;
            });
            top.sort((a, b) => b.s.total - a.s.total || (signature(a.o) < signature(b.o) ? -1 : 1));
        }
        return top;
    };

    let { candidates, accessories } = buildAll();
    const holdsKept = (e) => keepIds.every(id => members(e.o).some(p => p.id === id));
    let ranked = rank(candidates, accessories);
    if (keepIds.length) {
        ranked = ranked.filter(holdsKept);
        if (ranked.length === 0) {                                       // e.g. a dress and a bottom kept together
            notes.push('Those pieces can’t go together in one outfit, so I started again without them.');
            keepIds = [];
            ({ candidates, accessories } = buildAll());
            ranked = rank(candidates, accessories);
        }
    }
    const excluded = new Set(opt.exclude || []);
    const fresher = ranked.filter(e => !excluded.has(signature(e.o)));
    if (fresher.length > 0) ranked = fresher; else if (excluded.size) notes.push('That is everything I can put together from your closet.');

    // ---- choose up to three that share NO piece ----
    // A piece appears in at most one idea (a piece you asked to keep is the one exception: it is in all of them).
    // If the closet is too small for that, fewer ideas are shown rather than repeating pieces. Only shoes and
    // accessories may repeat, and only when that is the only way to show at least two ideas.
    const sharesAPiece = (a, b, cats) => members(a.o).some(p => cats.includes(p.cat) && !keepIds.includes(p.id) && members(b.o).some(q => q.id === p.id));
    // Past combinations are mixed in with new ones: at most one in three of the ideas (at least one allowed), unless
    // there are not enough new ones to fill the list.
    const pastCap = Math.max(1, Math.floor(opt.max / 3));
    const pickDistinct = (cats, capPast = true) => {
        const picked = [];
        let pastCount = 0;
        for (const e of ranked) {
            if (picked.length >= opt.max) break;
            const isPast = !!e.s.flags.past;
            if (capPast && isPast && pastCount >= pastCap) continue;
            if (picked.every(c => !sharesAPiece(c, e, cats))) { picked.push(e); if (isPast) pastCount++; }
        }
        return picked;
    };
    let chosen = pickDistinct(SUGGEST_CATEGORIES);
    if (chosen.length < Math.min(2, opt.max)) {                       // too few new ideas to mix with: past ones may fill the list
        const uncapped = pickDistinct(SUGGEST_CATEGORIES, false);
        if (uncapped.length > chosen.length) chosen = uncapped;
    }
    if (chosen.length < Math.min(2, opt.max)) {
        const garmentsOnly = pickDistinct(['tops', 'bottoms', 'dresses', 'outerwear'], false);
        if (garmentsOnly.length > chosen.length) {
            chosen = garmentsOnly;
            notes.push('Some ideas share shoes or an accessory because your closet doesn’t have enough of them to give each idea its own.');
        }
    }
    chosen.sort((a, b) => b.s.total - a.s.total || (signature(a.o) < signature(b.o) ? -1 : 1));

    if (!all.some(p => p.cat === 'dresses') && !(all.some(p => p.cat === 'tops') && all.some(p => p.cat === 'bottoms'))) {
        notes.push('Add at least a top and a bottom (or a dress) to your closet and I can suggest outfits.');
    } else if (chosen.length === 1) {
        notes.push('That is the only idea I can make without repeating a piece. Add more pieces for more ideas.');
    } else if (chosen.length < Math.min(opt.max, 3) && chosen.length > 1 && !excluded.size) {
        notes.push('Your closet is too small for more ideas that don’t repeat a piece.');
    }
    if (needsClosedShoes && hasShoes && !hasClosedShoes && !keepIds.some(id => byId.get(id) && byId.get(id).cat === 'shoes')) {
        notes.push('You only have open shoes (sandals) in your closet, so I left shoes out for this weather.');
    }
    if (weatherNeed.has && !hasOuterPieces && (weatherNeed.wet || weatherNeed.cold)) {
        notes.push(`You don’t have any outerwear in your closet yet, so I couldn’t add a coat or jacket for the ${weatherNeed.wet ? (weatherNeed.snow ? 'snow' : 'rain') : 'cold'}.`);
    }
    if (ctx.skippedUntagged > 0) notes.push(`${ctx.skippedUntagged} ${ctx.skippedUntagged === 1 ? 'piece still needs' : 'pieces still need'} tagging, so I left ${ctx.skippedUntagged === 1 ? 'it' : 'them'} out.`);
    if (relaxed.length) notes.push(`Most of your ${relaxed.join(' and ')} were worn in the last week, so some are repeated here.`);

    const unknownShown = new Map(), noStrengthShown = new Map(), clashShown = new Set();
    const suggestions = chosen.map(e => {
        const o = e.o, ms = members(o);
        const pattern = patternCheck(ms);
        const colorResult = colorCheck(ms);
        if (colorResult.clashes.length) clashShown.add(colorResult.clashes.length);
        ms.filter(p => p.pattern === 'unknown').forEach(p => unknownShown.set(p.id, sgName(p)));
        patternAnalysis(ms).unknownStrength.forEach(p => noStrengthShown.set(p.id, sgName(p)));
        return {
            pattern,
            color: colorResult,
            itemIds: ms.map(p => p.id),
            pieces: sortForDisplay(ms).map(p => ({ id: p.id, name: sgName(p), category: p.cat, layer: p.layer })),
            reason: reasonFor(o, e.s, need, sinceWorn, formalityNeed),
            score: Math.round(e.s.total * 100),
            parts: Object.fromEntries(Object.entries(e.s.parts).map(([k, v]) => [k, Math.round(v * 100) / 100])),
            signature: signature(o),
            past: e.s.flags.past ? { daysAgo: e.s.flags.past.days, text: pastText(e.s.flags.past.days) } : null     // "You wore these together about three weeks ago."
        };
    });
    if (suggestions.length > 0 && suggestions.every(s => s.color.clashes.length > 0)) {
        notes.push('Every idea here pairs a solid piece with a pattern that has a color it doesn’t go with, so they are ranked lower. These are the closest I could get from your closet.');
    }
    if (suggestions.length > 0 && suggestions.every(s => s.pattern.competing.length > 0)) {
        notes.push('Every idea here pairs two bold patterns that compete, so they are ranked lower. These are the closest I could get from your closet; a solid or subtle piece would give better matches.');
    }
    if (unknownShown.size > 0) {
        const n = unknownShown.size;
        notes.push(`${n === 1 ? 'One piece has' : `${n} pieces have`} no pattern set, so I can’t check how ${n === 1 ? 'its pattern' : 'their patterns'} fit with the rest. You can set a pattern in a piece’s details.`);
    }
    if (noStrengthShown.size > 0) {
        const n = noStrengthShown.size;
        notes.push(`${n === 1 ? 'One patterned piece has' : `${n} patterned pieces have`} no strength set (bold or subtle), so I can’t tell whether ${n === 1 ? 'it competes' : 'they compete'} with another pattern.`);
    }
    return { suggestions, need, notes, heard: typed.heard, keepIds };
}

// Do two described pieces share a color? Each has one main color (a hex); they share one when both are real colors and close.
// A missing or invalid color never shares anything.
function sgSharedColor(a, b) {
    const rgb = (hex) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : null; };
    // any color of one piece close to any color of the other (a piece's colors are its main color and any others it has)
    return (a.colors || []).some(ca => (b.colors || []).some(cb => { const x = rgb(ca), y = rgb(cb); return !!x && !!y && Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) <= SUGGEST_SHARED_COLOR_DISTANCE; }));
}

// ---- colors of pieces ----
const SG_HEX = /^#[0-9a-f]{6}$/i;
// A piece's colors as lowercase hexes: its main color first, then any others saved, with duplicates and anything that is not a real
// color left out, at most four. A piece with nothing saved but its main color has exactly one.
function sgPieceColors(item) {
    const list = [item && item.color, ...(Array.isArray(item && item.otherColors) ? item.otherColors : [])];
    const out = [];
    list.forEach(c => { if (typeof c === 'string' && SG_HEX.test(c.trim())) { const h = c.trim().toLowerCase(); if (!out.includes(h)) out.push(h); } });
    return out.slice(0, SUGGEST_MAX_COLORS);
}

// A plain word for a color (for the sentences), from its hue, lightness and saturation.
function sgColorName(hex) {
    const c = sgColor(hex);
    if (!c.known) return 'unknown color';
    if (c.l < 0.15) return 'black';
    if (c.l > 0.9) return 'white';
    if (c.s < 0.2) return 'gray';
    const h = c.hue;
    if (h >= 200 && h <= 250 && c.l < 0.36) return 'navy';
    if (h >= 20 && h < 60 && c.l > 0.8) return 'cream';
    if (h >= 15 && h <= 50 && c.s < 0.55 && c.l > 0.2 && c.l < 0.82) return c.l > 0.55 ? 'tan' : 'brown';
    if (h >= 50 && h < 90 && c.s < 0.5 && c.l < 0.5) return 'olive';
    const base = h < 15 || h >= 345 ? 'red' : h < 40 ? 'orange' : h < 70 ? 'yellow' : h < 160 ? 'green' : h < 190 ? 'teal' : h < 255 ? 'blue' : h < 295 ? 'purple' : 'pink';
    return c.l < 0.3 ? 'dark ' + base : c.l > 0.75 ? 'light ' + base : base;
}

// Do two colors coordinate? 'ok' | 'clash' | 'unknown' (one is not a real color).
// Black, white, gray, navy and dark colors go with anything; so do colors of one family (hue within 50 degrees). Anything else
// (two different bright colors; camel or tan with a bright blue) does not. Stricter on purpose than the whole-outfit color score.
function sgColorsCoordinate(hexA, hexB) {
    const a = sgColor(hexA), b = sgColor(hexB);
    if (!a.known || !b.known) return 'unknown';
    const achromatic = (c) => c.s < 0.2 || c.l < 0.15 || c.l > 0.9;
    const navy = (c) => c.hue >= 200 && c.hue <= 250 && c.l < 0.36;
    if (achromatic(a) || achromatic(b) || navy(a) || navy(b)) return 'ok';
    let d = Math.abs(a.hue - b.hue); if (d > 180) d = 360 - d;
    if (d <= SUGGEST_COLOR_FAMILY_DEGREES) return 'ok';
    if (a.l < 0.3 || b.l < 0.3) return 'ok';
    return 'clash';
}

// The single-color/multi-color pairs of one idea whose colors do not all coordinate, and what that costs.
//   clashes             [{ single, multi, colors }]: the single-color piece, the multi-color piece, and the hexes of its colors that clash
//   oneColorPatterned   patterned pieces with only one color known (their other colors can't be checked)
function colorAnalysis(pieces) {
    const singles = pieces.filter(p => (p.colors || []).length === 1 && !p.patterned);      // a solid piece, or one whose pattern is not known: one color
    const multis = pieces.filter(p => (p.colors || []).length > 1);
    const clashes = [];
    singles.forEach(s => multis.forEach(m => {
        const colors = m.colors.filter(c => sgColorsCoordinate(s.colors[0], c) === 'clash');
        if (colors.length) clashes.push({ single: s, multi: m, colors });
    }));
    const adjust = -Math.min(clashes.length * SUGGEST_COLOR_CLASH, SUGGEST_COLOR_MAX_PENALTY);
    const oneColorPatterned = pieces.length > 1 ? pieces.filter(p => p.patterned && (p.colors || []).length === 1) : [];
    return { clashes, adjust, oneColorPatterned, multis };
}

// The color check of one idea in words: { status, clashes, text }.
//   'clash'       a single-color piece doesn't go with some color of a multi-color one (the idea ranks lower; named in the text)
//   'incomplete'  no clash found, but a patterned piece has only one color known, so its other colors weren't checked
//   'checked'     nothing to report, or every color of every multi-color piece goes with the single-color pieces
// text is '' when there is nothing worth saying (no multi-color piece, no patterned piece with one color).
function colorCheck(pieces) {
    const an = colorAnalysis(pieces);
    const names = (hexes) => hexes.map(sgColorName).join(', ');
    const sentences = [];
    an.clashes.forEach(c => sentences.push(`${sgName(c.single)} (${sgColorName(c.single.colors[0])}) doesn’t go with the ${names(c.colors)} in ${sgName(c.multi)}, so this idea ranks lower.`));
    if (!an.clashes.length) {
        an.multis.forEach(m => {
            const partners = pieces.filter(p => p !== m && (p.colors || []).length === 1);
            if (partners.length) sentences.push(`${sgName(m)}’s colors (${names(m.colors)}) all go with ${partners.map(sgName).join(', ')}.`);
        });
    }
    an.oneColorPatterned.forEach(p => sentences.push(`I only know one color for ${sgName(p)}, so I can’t check the other colors in its pattern. You can add them in its details.`));
    const status = an.clashes.length ? 'clash' : an.oneColorPatterned.length ? 'incomplete' : 'checked';
    return {
        status, text: sentences.length ? `Color check${status === 'incomplete' ? ' incomplete' : ''}: ${sentences.join(' ')}` : '',
        clashes: an.clashes.map(c => ({ single: sgName(c.single), multi: sgName(c.multi), colors: c.colors })),
        adjust: Math.round(an.adjust * 1000) / 1000
    };
}

// What the patterns of one idea's pieces do to its score, and what could and could not be checked (described pieces).
//   pairs        every pair of KNOWN-patterned pieces: 'bold-bold' (compete) | 'compatible' (bold+subtle, subtle+subtle) |
//                'unknown-strength' (cannot tell), and whether the two share a color
//   adjust       what to add to the 0..1 score: negative for competing bold pairs, a small positive for shared color on a pair
//                that does not compete, never positive for unknown information
//   unknown      pieces with no pattern set (they might be patterned: not checked)
//   unknownStrength  patterned pieces whose strength is not set, in a pair that could not be judged for that reason
function patternAnalysis(pieces) {
    const patterned = pieces.filter(p => p.patterned);
    const pairs = [];
    for (let i = 0; i < patterned.length; i++) {
        for (let j = i + 1; j < patterned.length; j++) {
            const a = patterned[i], b = patterned[j];
            const kind = a.strength === 'bold' && b.strength === 'bold' ? 'bold-bold'
                : (a.strength === 'unknown' || b.strength === 'unknown') ? 'unknown-strength' : 'compatible';
            pairs.push({ a, b, kind, shared: sgSharedColor(a, b) });
        }
    }
    let adjust = 0;
    pairs.forEach(p => {
        if (p.kind === 'bold-bold') adjust -= p.shared ? SUGGEST_PATTERN_CLASH_SHARED : SUGGEST_PATTERN_CLASH;
        else if (p.kind === 'compatible' && p.shared) adjust += SUGGEST_PATTERN_SHARED_BONUS;
    });
    adjust = Math.max(adjust, -SUGGEST_PATTERN_MAX_PENALTY);
    const unknownStrength = [];
    pairs.filter(p => p.kind === 'unknown-strength').forEach(p => [p.a, p.b].forEach(x => { if (x.strength === 'unknown' && !unknownStrength.includes(x)) unknownStrength.push(x); }));
    return { patterned, pairs, adjust, unknown: pieces.filter(p => p.pattern === 'unknown'), unknownStrength };
}

// What the pattern check found out about one idea's pieces, in words (described pieces from describePiece):
//   status 'checked'     every piece's pattern is known, and every pair of patterns could be judged
//   status 'incomplete'  some piece has no pattern set, or two patterns' strength (bold or subtle) is not set: the check could
//                        not be completed, and the text says for which pieces
// competing = the pairs of bold patterns that compete (the ones that cost points). Unknown is never described as solid, as
// matching or as compatible, and a shared color is described as helping, never as making a match certain.
function patternCheck(pieces) {
    const an = patternAnalysis(pieces);
    const list = (arr) => arr.length <= 3 ? arr.join(', ') : `${arr.slice(0, 3).join(', ')} and ${arr.length - 3} more`;
    const unknownNames = an.unknown.map(sgName), noStrength = an.unknownStrength.map(sgName);
    const competing = an.pairs.filter(p => p.kind === 'bold-bold').map(p => [sgName(p.a), sgName(p.b)]);
    const sentences = [];
    if (an.patterned.length === 0) {
        sentences.push(an.unknown.length === 0 ? 'no patterned pieces.' : `no pattern is set for ${list(unknownNames)}, so I can’t tell whether any piece is patterned.`);
    } else if (an.patterned.length === 1) {
        sentences.push(`one patterned piece (${sgName(an.patterned[0])}).`);
    }
    an.pairs.forEach(p => {
        const A = sgName(p.a), B = sgName(p.b);
        const share = p.shared ? ' They share a similar color, which helps (it doesn’t guarantee a match).' : '';
        if (p.kind === 'bold-bold') sentences.push(`${A} and ${B} both have bold patterns, which compete, so this idea ranks lower.${p.shared ? ' They share a similar color, which softens it.' : ''}`);
        else if (p.kind === 'unknown-strength') sentences.push(`I can’t tell whether ${A} and ${B} compete: bold or subtle isn’t set for ${list([p.a, p.b].filter(x => x.strength === 'unknown').map(sgName))}.`);
        else if (p.a.strength === 'bold' || p.b.strength === 'bold') sentences.push(`${A} and ${B} have patterns, but only one is bold, so they don’t compete.${share}`);
        else sentences.push(`${A} and ${B} are both subtle patterns, so they don’t compete.${share}`);
    });
    if (an.patterned.length > 0 && an.unknown.length > 0) sentences.push(`No pattern is set for ${list(unknownNames)}, so I can’t tell whether ${an.unknown.length === 1 ? 'it adds' : 'they add'} another pattern.`);
    const incomplete = an.unknown.length > 0 || an.unknownStrength.length > 0;
    return {
        status: incomplete ? 'incomplete' : 'checked',
        patterned: an.patterned.map(sgName), unknown: unknownNames, unknownStrength: noStrength, competing,
        shared: an.pairs.filter(p => p.shared).map(p => [sgName(p.a), sgName(p.b)]),
        adjust: Math.round(an.adjust * 1000) / 1000,
        text: `Pattern check${incomplete ? ' incomplete' : ''}: ${sentences.join(' ')}`
    };
}

const SG_ORDER = { outerwear: 0, tops: 1, dresses: 2, bottoms: 3, shoes: 4, accessories: 5 };
function sortForDisplay(pieces) {
    return [...pieces].sort((a, b) => SG_ORDER[a.cat] - SG_ORDER[b.cat] || (a.id < b.id ? -1 : 1));
}

// One short plain sentence: the piece it is built around, then the clauses that mattered most.
function reasonFor(o, s, need, sinceWorn, formalityNeed) {
    const anchor = o.dress || o.bottom || o.top;
    const w = need.weather;
    const clauses = [];
    if (w.has) {
        if (w.wet && o.outer) clauses.push(`adds your ${sgName(o.outer)} for the ${w.snow ? 'snow' : 'rain'}`);
        else if (w.cold && o.outer) clauses.push(`adds your ${sgName(o.outer)} for the cold`);
        else if (w.cold && o.top && o.top.warmth >= 4) clauses.push(`uses your warm ${sgName(o.top)} for the cold`);
        else if (w.hot && !o.outer) clauses.push('keeps it light for the heat');
        else if (!w.cold && !w.wet && !o.outer && w.feels < 72) clauses.push('is right for a mild day');
    }
    const ev = formalityNeed.events;
    if (ev.length) {
        const label = ev.length === 1 ? ev[0].label : 'the day';
        if (formalityNeed.target >= 4) clauses.push(`is dressed up enough for ${label === 'the day' ? 'your day' : label}`);
        else if (formalityNeed.target <= 1.5) clauses.push('keeps it easy for activity');
        else clauses.push(`suits ${label === 'the day' ? 'your day' : label}`);
    } else if (need.formalityShift > 0) clauses.push('is a little dressier');
    else if (need.formalityShift < 0) clauses.push('is more relaxed');
    if (clauses.length < 2) {
        const tracked = [o.top, o.bottom, o.dress, o.outer].filter(Boolean);
        const worn = tracked.filter(p => sinceWorn.has(p.id));
        if (tracked.length && worn.length === 0) clauses.push('uses pieces you haven’t worn lately');
        else if (worn.length && worn.every(p => sinceWorn.get(p.id) > SUGGEST_RECENT_DAYS)) clauses.push('avoids anything worn this week');
    }
    if (clauses.length < 2 && s.parts.color >= 0.95) clauses.push('keeps the colors easy');
    const lead = `Uses your ${sgName(anchor)}`;
    const text = clauses.length === 0 ? `${lead}.`
        : clauses.length === 1 ? `${lead} and ${clauses[0]}.`
        : `${lead}, ${clauses[0]} and ${clauses[1]}.`;
    return text;
}

// The weekend a Shabbos / Yom Tov day belongs to: the run of consecutive "special" days around it (at most 5 days).
// isSpecial(dateKey) -> true for Shabbos (and the Friday before it) and for Yom Tov days. Returns the OTHER days' keys.
function specialRunOthers(dateKey, isSpecial) {
    if (!isSpecial(dateKey)) return [];
    const shift = (k, n) => { const d = new Date(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const run = [dateKey];
    for (let n = 1; n <= 4 && isSpecial(shift(dateKey, -n)); n++) run.unshift(shift(dateKey, -n));
    for (let n = 1; n <= 4 && isSpecial(shift(dateKey, n)); n++) run.push(shift(dateKey, n));
    return run.filter(k => k !== dateKey);
}

// ---- demo pieces and what "enough pieces" means ----
// Demo pieces (js/starter-closet.js) are sample pieces labeled Demo. They are kept apart from the person's own
// closet: they are only used for suggestions while the person's OWN (tagged) pieces cannot make an outfit yet. As soon as
// they can, suggestions use only their own pieces and the demo ones are left out.
function sgCanMakeOutfit(items) {
    const has = (cat) => items.some(i => i.category === cat);
    return has('dresses') || (has('tops') && has('bottoms'));
}
function suggestionPool(items) {
    const all = (items || []).filter(i => i && i.id);
    const own = all.filter(i => i.demo !== true);
    return sgCanMakeOutfit(own.filter(i => i.tagged !== false)) ? own : all;
}

// Can "Help me choose" make an outfit from this closet? If not, say plainly what is missing (never an empty result).
// Returns { ready, message, missing: ['top' | 'bottom' | 'dress or a top and a bottom' ...], untagged }.
function outfitReadiness(items) {
    const pool = suggestionPool(items);
    const tagged = pool.filter(i => i.tagged !== false && SUGGEST_CATEGORIES.includes(i.category));
    const untagged = pool.filter(i => i.tagged === false).length;
    const n = (cat) => tagged.filter(i => i.category === cat).length;
    const tops = n('tops'), bottoms = n('bottoms'), dresses = n('dresses');
    if (dresses > 0 || (tops > 0 && bottoms > 0)) return { ready: true, message: '', missing: [], untagged };
    const tagNote = untagged > 0
        ? ` ${untagged} ${untagged === 1 ? 'piece still needs' : 'pieces still need'} tagging: open ${untagged === 1 ? 'it' : 'them'} in the Closet and press Save, and I can use ${untagged === 1 ? 'it' : 'them'}.`
        : '';
    let message, missing;
    if (tops > 0) { missing = ['bottom']; message = `You have ${tops === 1 ? 'a top' : 'tops'} but no bottom yet. Add a bottom (or a dress) and I can suggest outfits.`; }
    else if (bottoms > 0) { missing = ['top']; message = `You have ${bottoms === 1 ? 'a bottom' : 'bottoms'} but no top yet. Add a top (or a dress) and I can suggest outfits.`; }
    else { missing = ['top', 'bottom']; message = 'To suggest outfits I need at least a top and a bottom, or a dress.'; }
    return { ready: false, message: message + tagNote, missing, untagged };
}

if (typeof module !== 'undefined') {
    module.exports = {
        suggestionPool, outfitReadiness, sgCanMakeOutfit, normalizePattern, patternPatch, normalizePatternStrength, patternStrengthPatch, patternCheck, patternAnalysis, sgSharedColor,
        sgPieceColors, sgColorName, sgColorsCoordinate, colorAnalysis, colorCheck, SUGGEST_COLOR_CLASH, SUGGEST_COLOR_MAX_PENALTY, SUGGEST_MAX_COLORS,
        SUGGEST_PATTERNS, SUGGEST_PATTERNED, SUGGEST_PATTERN_STRENGTHS, SUGGEST_PATTERN_CLASH, SUGGEST_PATTERN_CLASH_SHARED, SUGGEST_PATTERN_SHARED_BONUS, SUGGEST_PATTERN_MAX_PENALTY,
        suggestOutfits, describePiece, SUGGEST_COVERAGES, parseRefineText, specialRunOthers, sgColor, sgColorScore, sgWeatherNeed, sgFormalityNeed,
        SUGGEST_WEIGHTS, SUGGEST_RECENT_DAYS, SUGGEST_WARMTH_LABELS, SUGGEST_FORMALITY_LABELS
    };
}
