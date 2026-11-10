// Reads a product page's HTML and pulls out what the importer needs: a title and a short list of
// CANDIDATE photos for the person to choose between. Nothing is chosen automatically here.
//
// Where the facts come from, best first: schema.org JSON-LD "Product" data, then the Open Graph /
// Twitter card tags most stores publish for link previews, then (only as a last resort, and ranked
// last) ordinary <img> tags that don't look like logos, icons or banners. Pure functions, no
// dependencies, no network: the caller supplies the HTML and the page's address.

const MAX_CANDIDATES = 10;
const MAX_TITLE = 300;
const MAX_LD_BLOCKS = 20;
const MAX_IMG_TAGS = 250;

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', trade: '™', reg: '®', copy: '©', eacute: 'é'
};

function decodeEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
        if (body[0] === '#') {
            const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
        }
        const named = NAMED_ENTITIES[body.toLowerCase()];
        return named === undefined ? whole : named;
    });
}

const tidyText = (s) => decodeEntities(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);

// <meta property="og:title" content="X">  ->  { property: 'og:title', content: 'X' }
function parseAttributes(tag) {
    const attrs = {};
    const body = tag.replace(/^<\s*[a-zA-Z0-9]+/, '').replace(/\/?>$/, '');
    const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(body))) {
        const name = m[1].toLowerCase();
        if (!(name in attrs)) attrs[name] = decodeEntities(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '');
    }
    return attrs;
}

function tagsOf(html, name, limit = Infinity) {
    const out = [];
    const re = new RegExp(`<${name}\\b[^>]*>`, 'gi');
    let m;
    while ((m = re.exec(html)) && out.length < limit) out.push(parseAttributes(m[0]));
    return out;
}

// A web address found in the page -> an absolute http(s) address, or null.
function resolveUrl(raw, base) {
    if (!raw) return null;
    const text = String(raw).trim();
    if (!text || /^(data|javascript|blob|about|mailto|tel):/i.test(text)) return null;
    try {
        const u = new URL(text, base);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        if (u.username || u.password) return null;
        u.hash = '';
        return u.href;
    } catch (e) { return null; }
}

// ---- schema.org JSON-LD ------------------------------------------------------------------------

function jsonLdBlocks(html) {
    const blocks = [];
    const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) && blocks.length < MAX_LD_BLOCKS) {
        if (m[1].length > 500000) continue;
        try { blocks.push(JSON.parse(m[1].trim().replace(/^﻿/, ''))); } catch (e) { /* a broken block is just skipped */ }
    }
    return blocks;
}

function findProducts(node, found = [], depth = 0) {
    if (!node || typeof node !== 'object' || depth > 6) return found;
    if (Array.isArray(node)) { node.forEach(n => findProducts(n, found, depth + 1)); return found; }
    const type = [].concat(node['@type'] || []).map(t => String(t).split('/').pop().toLowerCase());
    if (type.includes('product') || type.includes('productgroup')) found.push(node);
    for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'hasVariant']) findProducts(node[key], found, depth + 1);
    return found;
}

function imagesOf(value, out = []) {
    if (!value) return out;
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(v => imagesOf(v, out));
    else if (typeof value === 'object') imagesOf(value.url || value.contentUrl || value['@id'], out);
    return out;
}

const textOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? textOf(v.name) : '');

// ---- <img> tags (last resort) ---------------------------------------------------------------------

const JUNK_IMAGE = /(logo|icon|sprite|favicon|pixel|spacer|blank|placeholder|loading|badge|banner|avatar|payment|flag|social|star|arrow|swatch|thumbnail-?small|tracking|beacon|1x1)|\.(svg|gif|ico)(\?|$)/i;

function largestSrcset(srcset) {
    let best = null, bestSize = -1;
    String(srcset || '').split(',').forEach(part => {
        const [url, size] = part.trim().split(/\s+/);
        if (!url) return;
        const n = size ? parseFloat(size) : 1;
        if (n > bestSize) { best = url; bestSize = n; }
    });
    return best;
}

function imgCandidates(html, base) {
    const out = [];
    for (const a of tagsOf(html, 'img', MAX_IMG_TAGS)) {
        const w = parseInt(a.width, 10), h = parseInt(a.height, 10);
        if ((Number.isFinite(w) && w < 120) || (Number.isFinite(h) && h < 120)) continue;
        const raw = largestSrcset(a.srcset || a['data-srcset']) || a['data-src'] || a['data-original'] || a.src;
        const url = resolveUrl(raw, base);
        if (!url || JUNK_IMAGE.test(url) || JUNK_IMAGE.test(a.alt || '') || JUNK_IMAGE.test(a.class || '')) continue;
        out.push({ url, source: 'gallery', alt: tidyText(a.alt) });
    }
    return out;
}

// ---- putting it together -------------------------------------------------------------------------

// Returns { title, siteName, brand, color, category, candidates: [{ url, source, alt }] }.
//   source: 'product' (the store's own product data), 'page' (its link-preview image) or 'gallery'
function extractProductInfo(html, pageUrl) {
    const raw = String(html || '');
    // Tags are read from the real markup only: text inside <script>, <style> and comments (which can
    // contain anything, including strings that look like tags) is not markup. JSON-LD is read from the raw text.
    const text = raw.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
    const baseTag = tagsOf(text, 'base', 1)[0];
    const base = (baseTag && resolveUrl(baseTag.href, pageUrl)) || pageUrl;

    const metas = tagsOf(text, 'meta');
    const meta = (...keys) => {
        for (const key of keys) {
            const hit = metas.find(a => [a.property, a.name, a.itemprop].some(v => v && v.toLowerCase() === key) && a.content);
            if (hit) return hit.content;
        }
        return '';
    };

    const products = jsonLdBlocks(raw).flatMap(b => findProducts(b));
    const product = products.find(p => textOf(p.name)) || products[0] || null;
    const titleTag = (text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1];

    const title = tidyText(textOf(product && product.name) || meta('og:title', 'twitter:title') || titleTag);
    const info = {
        title,
        siteName: tidyText(meta('og:site_name', 'application-name')),
        brand: tidyText(textOf(product && product.brand)),
        color: tidyText(textOf(product && product.color)),
        category: tidyText(textOf(product && product.category)),
        candidates: []
    };

    const seen = new Set();
    const add = (raw, source, alt = '') => {
        const url = resolveUrl(raw, base);
        if (!url) return;
        const key = (() => { const u = new URL(url); return u.origin + u.pathname; })();       // the same picture at another size counts once
        if (seen.has(key)) return;
        seen.add(key);
        info.candidates.push({ url, source, alt: tidyText(alt) });
    };

    products.forEach(p => imagesOf(p.image).forEach(i => add(i, 'product', textOf(p.name))));
    add(meta('og:image:secure_url', 'og:image', 'og:image:url'), 'page', info.title);
    add(meta('twitter:image', 'twitter:image:src'), 'page', info.title);
    tagsOf(text, 'link').filter(a => (a.rel || '').toLowerCase() === 'image_src').forEach(a => add(a.href, 'page', info.title));
    if (info.candidates.length < 3) imgCandidates(text, base).forEach(c => add(c.url, c.source, c.alt));   // only when the store gave us little

    info.candidates = info.candidates.slice(0, MAX_CANDIDATES);
    return info;
}

// Does this page look like a sign-in page or a "we think you're a robot" wall rather than a product?
function looksBlocked(html, finalUrl, info) {
    const text = String(html || '');
    let path = '';
    try { path = new URL(finalUrl).pathname; } catch (e) { /* ignore */ }
    const hasPassword = /<input\b[^>]*type\s*=\s*["']?password/i.test(text);
    if (hasPassword && (/(^|\/)(log-?in|sign-?in|signin|account|auth|customer\/account)(\/|$|\?)/i.test(path) || info.candidates.length === 0)) return 'LOGIN_REQUIRED';
    const title = (info.title || '').toLowerCase();
    if (/access denied|just a moment|attention required|are you a (robot|human)|captcha|verify you are human|request blocked|forbidden|bot detection/.test(title)) return 'BLOCKED';
    if (info.candidates.length === 0 && /(captcha|cf-chl|px-captcha|are you a robot|unusual traffic)/i.test(text.slice(0, 200000))) return 'BLOCKED';
    return null;
}

module.exports = { extractProductInfo, looksBlocked, decodeEntities, parseAttributes, resolveUrl, MAX_CANDIDATES };
