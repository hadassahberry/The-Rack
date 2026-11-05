// Automatic color tagging for new items: first look for a color word in the
// item's name ("navy dress"), otherwise sample the photo for its main color.
const COLOR_NAMES = {
    'black': '#222222', 'white': '#f5f5f5', 'off white': '#efe9dd', 'gray': '#9a9a9a', 'grey': '#9a9a9a',
    'charcoal': '#444444', 'silver': '#c0c0c0',
    'cream': '#f0e6d2', 'ivory': '#f6f1de', 'beige': '#d9c7a7', 'tan': '#c8a77a', 'khaki': '#bda76f',
    'camel': '#c19a6b', 'brown': '#7b5233', 'dark brown': '#4e2f1f', 'chocolate': '#4e2f1f',
    'red': '#c62828', 'burgundy': '#6d1a2b', 'maroon': '#800000', 'wine': '#722f37',
    'pink': '#f4a6c0', 'light pink': '#f9d1e0', 'hot pink': '#ff4f9a', 'blush': '#f2c6c2', 'rose': '#d9718a',
    'coral': '#f2765f', 'orange': '#ef8a2b', 'rust': '#b7472a', 'mustard': '#d4a017',
    'yellow': '#f4d03f', 'gold': '#d4af37',
    'olive': '#6b7048', 'green': '#3f8f4f', 'dark green': '#1f5a35', 'light green': '#9ad19f',
    'sage': '#9caf88', 'emerald': '#1e8a5a', 'teal': '#1f8a8a', 'turquoise': '#3cc3c0',
    'blue': '#2f6fd0', 'light blue': '#9cc4ee', 'sky blue': '#87ceeb', 'dark blue': '#1f2a52',
    'navy': '#1f2a52', 'navy blue': '#1f2a52', 'denim': '#4a6fa5',
    'lavender': '#b8a9e0', 'purple': '#7b3fa0', 'lilac': '#c8a2c8', 'mauve': '#a9788f'
};

// Every distinct color named in `text`, in the order they appear, as hex.
// A color word inside a longer one is ignored ("blue" in "navy blue"), and
// look-alike words don't count ("Redwood" is not "red").
function colorsInName(text) {
    if (!text) return [];
    const normalized = ' ' + String(text).toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    const found = [];
    for (const key of Object.keys(COLOR_NAMES)) {
        const needle = ' ' + key + ' ';
        // Spaces are shared between neighbors ("blue red"), so search from
        // one character past the previous hit rather than past its end.
        for (let i = normalized.indexOf(needle); i !== -1; i = normalized.indexOf(needle, i + 1)) {
            found.push({ key, start: i, end: i + needle.length });
        }
    }
    const kept = found.filter(a => !found.some(b => b !== a && b.key.length > a.key.length && b.start <= a.start && b.end >= a.end));
    kept.sort((a, b) => a.start - b.start);
    const hexes = [];
    for (const m of kept) {
        const hex = COLOR_NAMES[m.key];
        if (!hexes.includes(hex)) hexes.push(hex);
    }
    return hexes;
}

// The first color named in `text`, or null.
function colorFromName(text) {
    return colorsInName(text)[0] || null;
}

// Of several candidate hex colors, the one closest to the photo's color
// (falls back to the first if the photo's color is unknown).
function closestColor(candidates, photoHex) {
    if (!photoHex || candidates.length < 2) return candidates[0] || null;
    const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const p = rgb(photoHex);
    let best = candidates[0], bestD = Infinity;
    for (const c of candidates) {
        const q = rgb(c);
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (d < bestD) { bestD = d; best = c; }
    }
    return best;
}

// Finds the main color in RGBA pixel data (size x size). Photos of clothes
// usually have a plain wall/bed/floor behind the garment, and a smooth
// background can outvote textured fabric, so:
//   1. estimate the background from the outer border of the frame,
//   2. treat pixels that differ clearly from it as the garment,
//   3. take the most common color among the garment pixels (center-weighted).
// If there's no clear background, or almost nothing differs from it (the
// garment fills the frame), it uses all pixels instead.
function dominantColorFromPixels(data, size) {
    const half = size / 2;
    const quant = (r, g, b) => [r >> 5, g >> 5, b >> 5];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const weightAt = (x, y) => {
        const edge = Math.max(Math.abs(x - half + 0.5), Math.abs(y - half + 0.5)) / half;
        return edge > 0.8 ? 0.2 : edge > 0.55 ? 0.7 : 2;
    };

    const pixels = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            if (data[i + 3] < 128) continue;
            const edge = Math.max(Math.abs(x - half + 0.5), Math.abs(y - half + 0.5)) / half;
            pixels.push({ c: [data[i], data[i + 1], data[i + 2]], w: weightAt(x, y), border: edge >= 0.85 });
        }
    }
    if (pixels.length === 0) return null;

    // 1) Background = most common color around the border.
    const borderPixels = pixels.filter(p => p.border);
    let pool = pixels;
    if (borderPixels.length > 0) {
        const bgBuckets = new Map();
        for (const p of borderPixels) {
            const k = quant(...p.c).join(',');
            const b = bgBuckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
            b.n++; b.r += p.c[0]; b.g += p.c[1]; b.b += p.c[2];
            bgBuckets.set(k, b);
        }
        let top = null;
        for (const b of bgBuckets.values()) if (!top || b.n > top.n) top = b;
        const bg = [top.r / top.n, top.g / top.n, top.b / top.n];

        // 2) Garment = pixels clearly different from the background.
        const bgShare = borderPixels.filter(p => dist(p.c, bg) < 45).length / borderPixels.length;
        const foreground = pixels.filter(p => dist(p.c, bg) >= 45);
        const totalW = pixels.reduce((s, p) => s + p.w, 0);
        const fgW = foreground.reduce((s, p) => s + p.w, 0);
        if (bgShare >= 0.5 && fgW / totalW >= 0.2) pool = foreground;
    }

    // 3) Most common color in the pool; each color bucket also counts half
    // of its neighbors so textured fabric doesn't get split into many tiny
    // groups, and the result averages the bucket plus its neighbors.
    const buckets = new Map();
    for (const p of pool) {
        const [qr, qg, qb] = quant(...p.c);
        const k = qr * 64 + qg * 8 + qb;
        const b = buckets.get(k) || { w: 0, qr, qg, qb, r: 0, g: 0, b: 0 };
        b.w += p.w; b.r += p.c[0] * p.w; b.g += p.c[1] * p.w; b.b += p.c[2] * p.w;
        buckets.set(k, b);
    }
    // Similar shades (within 2 steps) support each other when choosing the
    // winner, which helps two-tone fabrics. Known limit: if two very different
    // colors cover similar areas (a black top above a plaid skirt), the flat
    // one can still win — the "to tag" step is where that gets corrected.
    let best = null, bestScore = -1;
    for (const b of buckets.values()) {
        let score = b.w;
        for (const o of buckets.values()) {
            if (o !== b && Math.abs(o.qr - b.qr) <= 2 && Math.abs(o.qg - b.qg) <= 2 && Math.abs(o.qb - b.qb) <= 2) score += o.w * 0.5;
        }
        if (score > bestScore) { bestScore = score; best = b; }
    }
    let w = 0, r = 0, g = 0, bl = 0;
    for (const o of buckets.values()) {
        if (Math.abs(o.qr - best.qr) <= 1 && Math.abs(o.qg - best.qg) <= 1 && Math.abs(o.qb - best.qb) <= 1) {
            w += o.w; r += o.r; g += o.g; bl += o.b;
        }
    }
    const hex = (v) => Math.round(v / w).toString(16).padStart(2, '0');
    return '#' + hex(r) + hex(g) + hex(bl);
}

// Loads the photo, shrinks it, and returns its main color (hex) or null.
function detectDominantColor(dataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const size = 64;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, size, size);
                resolve(dominantColorFromPixels(ctx.getImageData(0, 0, size, size).data, size));
            } catch (err) {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

// Picks the color for a new item: a single color named in the item's name
// wins; if the name mentions several ("Rose Cream Sweater") the one closest
// to the photo is used; with none, the photo's main color is used.
async function pickItemColor(name, imageDataUrl) {
    const named = colorsInName(name);
    if (named.length === 1) return named[0];
    const photo = await detectDominantColor(imageDataUrl);
    if (named.length > 1) return closestColor(named, photo);
    return photo || '#cccccc';
}

if (typeof module !== 'undefined') module.exports = { colorFromName, colorsInName, closestColor, dominantColorFromPixels, COLOR_NAMES };
