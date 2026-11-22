// The pure rules behind the first-run setup (js/first-run.js draws it): who is offered it, the starter closet
// (5-8 quick pieces, photos optional), the demo pieces, and how demo pieces are removed again. Nothing here touches the
// page, the database or the network, so it is tested on its own (tests/first-run.test.js).
//
// ---- Demo pieces are kept apart from the real wardrobe ----
// A demo piece is a normal closet document with demo: true (and an id starting "demo_"), so it syncs and works in the
// planner like any piece. What keeps it separate:
//   - it is labeled "Demo" everywhere it appears (a Demo badge, and the word DEMO on its picture);
//   - Wear stats ignore it (js/analytics.js), so demo pieces never count as wardrobe history;
//   - Help me choose uses demo pieces only while the person's own pieces cannot make an outfit (suggestionPool);
//   - ONE action removes them all (planDemoCleanup): the demo pieces, outfits made only of demo pieces, and saved outfits
//     made only of demo pieces. A plan that mixes demo and real pieces keeps its real pieces. Real pieces and real
//     plans are never touched.

const STARTER_MAX = 8;                  // the most pieces the starter form takes at once
const STARTER_SUGGESTED_MIN = 5;        // "5-8 pieces gives good ideas": a suggestion, never a requirement

const STARTER_CATEGORIES = ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes', 'accessories'];
const STARTER_CATEGORY_LABELS = { tops: 'Top', bottoms: 'Bottom', dresses: 'Dress', outerwear: 'Jacket or coat', shoes: 'Shoes', accessories: 'Accessory' };
const STARTER_CATEGORY_NOUNS = { tops: 'top', bottoms: 'bottom', dresses: 'dress', outerwear: 'jacket', shoes: 'shoes', accessories: 'accessory' };
const STARTER_OCCASIONS = ['casual', 'work', 'formal', 'workout'];
const STARTER_OCCASION_LABELS = { casual: 'Casual', work: 'Work', formal: 'Dressy', workout: 'Workout' };

// The rows the form starts with: enough for a few different outfits. The person can change any category or add more.
const STARTER_SLOTS = ['tops', 'tops', 'bottoms', 'bottoms', 'shoes', 'outerwear'];

const STARTER_COLORS = [
    { name: 'Black', hex: '#222222' }, { name: 'White', hex: '#f5f5f5' }, { name: 'Gray', hex: '#9a9a9a' },
    { name: 'Beige', hex: '#d9c7a7' }, { name: 'Brown', hex: '#7b5233' }, { name: 'Navy', hex: '#1f2a52' },
    { name: 'Blue', hex: '#2f6fd0' }, { name: 'Green', hex: '#3f8f4f' }, { name: 'Red', hex: '#c62828' },
    { name: 'Pink', hex: '#f4a6c0' }, { name: 'Purple', hex: '#7b3fa0' }, { name: 'Yellow', hex: '#f4d03f' }
];
const isHexColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const starterColorName = (hex) => { const c = STARTER_COLORS.find(x => x.hex.toLowerCase() === String(hex).toLowerCase()); return c ? c.name : ''; };

const isDemoItem = (item) => !!item && item.demo === true;
const isDemoId = (id, demoIds) => (demoIds && demoIds.has(id)) || (typeof id === 'string' && id.indexOf('demo_') === 0);

// ---- the picture of a piece that has no photo ----
// A small drawing (an emoji for the kind of piece on a soft background, with a bar in the piece's color), stored as the
// piece's picture so it shows everywhere a photo does. Demo pieces also carry a DEMO band across the top.
const PLACEHOLDER_EMOJI = { tops: '👚', bottoms: '👖', dresses: '👗', outerwear: '🧥', shoes: '👟', accessories: '👜' };
function placeholderImage({ category, color, demo = false }) {
    const fill = isHexColor(color) ? color : '#cccccc';
    const band = demo
        ? '<rect width="300" height="46" fill="#c29b61"/><text x="150" y="32" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700" letter-spacing="4" fill="#ffffff">DEMO</text>'
        : '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#faf3ee"/>' + band +
        '<text x="150" y="196" text-anchor="middle" font-size="124">' + (PLACEHOLDER_EMOJI[category] || '👚') + '</text>' +
        '<rect y="262" width="300" height="38" fill="' + fill + '"/></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ---- the starter closet ----
// rows: [{ category, color (hex), name?, occasion?, photo? (a ready-made picture, or null) }]
// A row that has nothing filled in (no color, no name, no photo) is ignored. A row with something filled in needs a
// category and a color, the two things suggestions can't do without: anything else has a sensible default.
function validateStarterRows(rows) {
    const complete = [], problems = [];
    (rows || []).forEach((row, index) => {
        const blank = !row || (!row.color && !String(row.name || '').trim() && !row.photo);
        if (blank) return;
        const label = STARTER_CATEGORY_LABELS[row.category] || 'piece';
        if (!STARTER_CATEGORIES.includes(row.category)) problems.push({ index, text: `Choose what kind of piece #${index + 1} is.` });
        else if (!isHexColor(row.color)) problems.push({ index, text: `Pick a color for the ${label.toLowerCase()} (piece #${index + 1}).` });
        else complete.push({ index, row });
    });
    if (complete.length > STARTER_MAX) problems.push({ index: -1, text: `Add up to ${STARTER_MAX} pieces at a time. You can add more later from the Closet.` });
    return { complete: complete.slice(0, STARTER_MAX), problems };
}

// Name: what was typed, else "<Color> <kind>" ("Navy top"); the same default twice becomes "Navy top 2".
function starterNames(completeRows) {
    const seen = {};
    return completeRows.map(({ row }) => {
        const typed = String(row.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (typed) return typed;
        const base = `${starterColorName(row.color) || 'My'} ${STARTER_CATEGORY_NOUNS[row.category]}`;
        seen[base] = (seen[base] || 0) + 1;
        return seen[base] === 1 ? base : `${base} ${seen[base]}`;
    });
}

// The closet documents to save. Only category and color are asked for; the rest start at the app's own defaults
// (casual, all-season), and every piece counts as tagged, so Help me choose can use it right away.
function makeStarterItems(rows, { now = Date.now(), rand = Math.random } = {}) {
    const { complete } = validateStarterRows(rows);
    const names = starterNames(complete);
    return complete.map(({ row }, n) => ({
        id: 'item_' + now + rand().toString(36).slice(2, 7) + n,
        name: names[n],
        category: row.category,
        occasion: STARTER_OCCASIONS.includes(row.occasion) ? row.occasion : 'casual',
        season: 'all-season',
        color: row.color,
        tagged: true,
        image: row.photo || placeholderImage({ category: row.category, color: row.color }),
        ...(row.photo ? {} : { noPhoto: true })       // a drawing, not a photo: never sent anywhere for a visual check
    }));
}

// ---- demo pieces ----
const DEMO_PIECES = [
    { id: 'demo_tee', name: 'White tee', category: 'tops', color: '#f5f5f5', occasion: 'casual', season: 'all-season' },
    { id: 'demo_blouse', name: 'Navy blouse', category: 'tops', color: '#1f2a52', occasion: 'work', season: 'all-season' },
    { id: 'demo_jeans', name: 'Blue jeans', category: 'bottoms', color: '#4a6fa5', occasion: 'casual', season: 'all-season' },
    { id: 'demo_skirt', name: 'Black skirt', category: 'bottoms', color: '#222222', occasion: 'work', season: 'all-season' },
    { id: 'demo_dress', name: 'Burgundy dress', category: 'dresses', color: '#6d1a2b', occasion: 'formal', season: 'all-season' },
    { id: 'demo_coat', name: 'Camel coat', category: 'outerwear', color: '#c19a6b', occasion: 'casual', season: 'winter' },
    { id: 'demo_rain', name: 'Rain jacket', category: 'outerwear', color: '#1f8a8a', occasion: 'casual', season: 'all-season' },
    { id: 'demo_flats', name: 'Black flats', category: 'shoes', color: '#222222', occasion: 'work', season: 'all-season' },
    { id: 'demo_sneakers', name: 'White sneakers', category: 'shoes', color: '#f5f5f5', occasion: 'casual', season: 'all-season' }
];
function makeDemoItems() {
    return DEMO_PIECES.map(p => ({
        ...p, tagged: true, demo: true, noPhoto: true,
        image: placeholderImage({ category: p.category, color: p.color, demo: true })
    }));
}

// ---- removing the demo pieces ----
// closet: [item]; schedule: { 'YYYY-MM-DD': [{ id, label, itemIds, flagsOff?, worn?, labelAt? }] }; saved: [{ id, name, itemIds }]
// Returns what to write, and counts for the confirmation. Pure: nothing is changed here.
//   - every demo piece is deleted;
//   - a planned outfit (or saved outfit) made ONLY of demo pieces is deleted (a day left with no outfits is removed);
//   - one that mixes demo and real pieces keeps its real pieces (and its activity, worn mark, name...);
//   - anything that has no demo piece in it is not touched at all.
function planDemoCleanup({ closet = [], schedule = {}, saved = [] }) {
    const demoIds = new Set(closet.filter(isDemoItem).map(i => i.id));
    const isDemo = (id) => isDemoId(id, demoIds);
    const plan = { itemIds: [...demoIds], scheduleWrites: [], savedDeletes: [], savedWrites: [], counts: { pieces: demoIds.size, outfitsRemoved: 0, outfitsTrimmed: 0, days: 0, savedRemoved: 0, savedTrimmed: 0 } };

    Object.keys(schedule).forEach(date => {
        const outfits = schedule[date] || [];
        if (!outfits.some(o => (o.itemIds || []).some(isDemo))) return;
        const next = [];
        outfits.forEach(o => {
            const ids = o.itemIds || [];
            if (!ids.some(isDemo)) { next.push(o); return; }
            const real = ids.filter(id => !isDemo(id));
            if (real.length === 0) { plan.counts.outfitsRemoved++; return; }
            plan.counts.outfitsTrimmed++;
            next.push({ ...o, itemIds: real });
        });
        plan.scheduleWrites.push({ date, outfits: next });
        if (next.length === 0) plan.counts.days++;
    });

    saved.forEach(o => {
        const ids = o.itemIds || [];
        if (!ids.some(isDemo)) return;
        const real = ids.filter(id => !isDemo(id));
        if (real.length === 0) { plan.savedDeletes.push(o.id); plan.counts.savedRemoved++; }
        else { plan.savedWrites.push({ ...o, itemIds: real }); plan.counts.savedTrimmed++; }
    });
    return plan;
}

// The confirmation text for the one "Remove demo pieces" action.
function describeDemoRemoval(counts) {
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const parts = [n(counts.pieces, 'demo piece', 'demo pieces')];
    if (counts.outfitsRemoved) parts.push(n(counts.outfitsRemoved, 'planned outfit made only of demo pieces', 'planned outfits made only of demo pieces'));
    if (counts.savedRemoved) parts.push(n(counts.savedRemoved, 'saved outfit made only of demo pieces', 'saved outfits made only of demo pieces'));
    const trimmed = counts.outfitsTrimmed + counts.savedTrimmed;
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
    return {
        message: 'This removes ' + list + '.' + (trimmed ? ` ${n(trimmed, 'outfit that mixes demo and your own pieces keeps', 'outfits that mix demo and your own pieces keep')} the pieces that are yours.` : ''),
        note: 'Your own pieces, plans, saved outfits and wear stats are not touched. This can’t be undone, though you can bring the demo pieces back any time from an empty closet.'
    };
}

// ---- who is offered the first-run setup ----
// Decided only once the account's data has really arrived from the server (fromCache false): an empty answer that came
// from an empty local copy, or a closet that hasn't loaded yet, says nothing about the account.
//   'wait'        not everything has arrived yet: decide nothing, show nothing
//   'show'        the closet is empty and this account has not been offered it before
//   'has-pieces'  the closet has pieces: never shown (and remembered, so emptying the closet later doesn't bring it back)
//   'seen'        offered before (skipped, finished or closed): never forced again
function firstRunDecision({ prefs, prefsConfirmed, closetCount, closetConfirmed }) {
    if (!prefsConfirmed || !closetConfirmed || !prefs || typeof closetCount !== 'number') return 'wait';
    if (closetCount > 0) return 'has-pieces';
    if (prefs.firstRunSeen === true) return 'seen';
    if (prefs.firstRunSeen !== undefined && prefs.firstRunSeen !== false) return 'seen';        // anything unexpected: don't force it
    return 'show';
}

if (typeof module !== 'undefined') {
    module.exports = {
        STARTER_MAX, STARTER_SUGGESTED_MIN, STARTER_CATEGORIES, STARTER_CATEGORY_LABELS, STARTER_OCCASIONS, STARTER_OCCASION_LABELS, STARTER_SLOTS, STARTER_COLORS,
        isDemoItem, isDemoId, placeholderImage, validateStarterRows, starterNames, makeStarterItems,
        DEMO_PIECES, makeDemoItems, planDemoCleanup, describeDemoRemoval, firstRunDecision
    };
}
