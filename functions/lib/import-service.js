// The two things the "Add from a link" feature asks the server to do. No Firebase in here (so it can
// be tested on its own); functions/index.js wraps it for sign-in and error reporting.
//
//   previewProduct({ url })            -> { title, siteName, brand, color, category, candidates: [{ url, source, alt }] }
//   fetchImage({ url, pageUrl })       -> { contentType, base64, bytes }
//
// previewProduct never downloads the candidate photos; it only checks that each one is on a public
// https address, because the person's own browser will load them as previews (see validateCandidates).
// fetchImage is what makes the independent copy: the server downloads the ONE photo that was chosen,
// checks it really is a picture, and hands the bytes back to be saved with the item.

const dns = require('dns');
const { ImportError } = require('./errors');
const { safeGet } = require('./safe-fetch');
const { parsePublicUrl, isPublicAddress, hostForLog } = require('./url-guard');
const { extractProductInfo, looksBlocked } = require('./product-page');
const { sniffImageType } = require('./image-sniff');

const HTML_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 4 * 1024 * 1024;       // base64 adds a third again; the reply must stay under the 10 MB call limit
const CANDIDATE_CHECK_MS = 2500;

const isHtml = (t) => t === 'text/html' || t === 'application/xhtml+xml';
const isImageType = (t) => /^image\/(jpeg|jpg|png|gif|webp|avif|pjpeg)$/.test(t) || t === 'application/octet-stream' || t === 'binary/octet-stream';

function decodeHtml(body, charset) {
    for (const label of [charset, 'utf-8']) {
        if (!label) continue;
        try { return new TextDecoder(label.toLowerCase()).decode(body); } catch (e) { /* unknown charset: try the next */ }
    }
    return body.toString('utf8');
}

// A candidate photo is shown to the person by THEIR browser, so (unlike the page itself) it must be
// something their browser can safely be told to load: https, the normal port, and a name that
// resolves only to public addresses. Anything else is dropped. (The chosen photo is later fetched
// by the server with the full checks in safe-fetch.js.)
async function validateCandidates(candidates, deps = {}) {
    const lookup = deps.lookup || dns.lookup;
    const allowed = deps.isAllowedAddress || isPublicAddress;
    const hostVerdict = new Map();            // one DNS check per host name

    const hostIsPublic = (host) => {
        if (!hostVerdict.has(host)) {
            hostVerdict.set(host, new Promise((resolve) => {
                const timer = setTimeout(() => resolve(false), deps.checkMs || CANDIDATE_CHECK_MS);
                lookup(host, { all: true, verbatim: true }, (err, addrs) => {
                    clearTimeout(timer);
                    resolve(!err && Array.isArray(addrs) && addrs.length > 0 && addrs.every(a => allowed(a.address)));
                });
            }));
        }
        return hostVerdict.get(host);
    };

    const checked = await Promise.all(candidates.map(async (c) => {
        let url;
        try { url = parsePublicUrl(c.url, { allowedPorts: deps.allowedPorts || [443] }); } catch (e) { return null; }
        if (url.protocol !== 'https:' && !deps.allowHttp) return null;
        return (await hostIsPublic(url.hostname)) ? { ...c, url: url.href } : null;
    }));
    return checked.filter(Boolean);
}

async function previewProduct({ url }, deps = {}) {
    const get = deps.safeGet || safeGet;
    const page = await get(url, {
        ...(deps.fetchOptions || {}),
        maxBytes: HTML_LIMIT,
        accept: isHtml,
        acceptHeader: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        badTypeCode: 'NOT_A_PAGE',
        badTypeMessage: 'That address isn’t a web page we can read.',
        tooLargeMessage: 'That page is too large to read.'
    });
    const html = decodeHtml(page.body, page.charset);
    const info = extractProductInfo(html, page.finalUrl);

    const blocked = looksBlocked(html, page.finalUrl, info);
    if (blocked === 'LOGIN_REQUIRED') throw new ImportError('LOGIN_REQUIRED', 'That page needs you to sign in first.');
    if (blocked === 'BLOCKED') throw new ImportError('BLOCKED', 'That store doesn’t allow automatic importing.');

    info.candidates = await validateCandidates(info.candidates, deps);
    return { ...info, host: hostForLog(page.finalUrl) };
}

async function fetchImage({ url, pageUrl }, deps = {}) {
    const get = deps.safeGet || safeGet;
    let referer;
    if (pageUrl) {                                         // a courtesy some image hosts expect; only ever a checked public address
        try { referer = parsePublicUrl(pageUrl).href; } catch (e) { referer = undefined; }
    }
    const img = await get(url, {
        ...(deps.fetchOptions || {}),
        maxBytes: IMAGE_LIMIT,
        accept: isImageType,
        acceptHeader: 'image/avif,image/webp,image/jpeg,image/png,image/gif;q=0.8,*/*;q=0.3',
        headers: referer ? { Referer: referer } : {},
        badTypeCode: 'NOT_AN_IMAGE',
        badTypeMessage: 'That address isn’t a picture we can use.',
        tooLargeMessage: 'That photo is too large to import. Try another one.'
    });
    const type = sniffImageType(img.body);
    if (!type) throw new ImportError('NOT_AN_IMAGE', 'That address isn’t a picture we can use.');
    return { contentType: type, base64: img.body.toString('base64'), bytes: img.body.length };
}

module.exports = { previewProduct, fetchImage, validateCandidates, decodeHtml, HTML_LIMIT, IMAGE_LIMIT };
