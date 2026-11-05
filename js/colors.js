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

// Returns a hex color for the earliest color word in `text` (longest match
// wins at the same position, so "navy blue" beats "blue"), or null.
function colorFromName(text) {
    if (!text) return null;
    const normalized = ' ' + String(text).toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    let best = null;
    for (const key of Object.keys(COLOR_NAMES)) {
        const index = normalized.indexOf(' ' + key + ' ');
        if (index === -1) continue;
        if (best === null || index < best.index || (index === best.index && key.length > best.key.length)) {
            best = { key, index };
        }
    }
    return best ? COLOR_NAMES[best.key] : null;
}

// Samples a small copy of the image and returns the hex of its most common
// color, weighting the center of the frame (where the garment usually is)
// above the edges (where walls/floors/beds are). Returns null on failure.
function detectDominantColor(dataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const size = 48;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, size, size);
                const { data } = ctx.getImageData(0, 0, size, size);

                const buckets = new Map();
                const half = size / 2;
                for (let y = 0; y < size; y++) {
                    for (let x = 0; x < size; x++) {
                        const i = (y * size + x) * 4;
                        if (data[i + 3] < 128) continue;
                        const edge = Math.max(Math.abs(x - half), Math.abs(y - half)) / half;
                        const weight = edge > 0.8 ? 0.2 : edge > 0.55 ? 0.7 : 2;
                        const r = data[i], g = data[i + 1], b = data[i + 2];
                        const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
                        const bucket = buckets.get(key) || { w: 0, r: 0, g: 0, b: 0 };
                        bucket.w += weight;
                        bucket.r += r * weight;
                        bucket.g += g * weight;
                        bucket.b += b * weight;
                        buckets.set(key, bucket);
                    }
                }

                let top = null;
                for (const bucket of buckets.values()) {
                    if (!top || bucket.w > top.w) top = bucket;
                }
                if (!top) { resolve(null); return; }
                const toHex = (v) => Math.round(v / top.w).toString(16).padStart(2, '0');
                resolve('#' + toHex(top.r) + toHex(top.g) + toHex(top.b));
            } catch (err) {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

if (typeof module !== 'undefined') module.exports = { colorFromName, COLOR_NAMES };
