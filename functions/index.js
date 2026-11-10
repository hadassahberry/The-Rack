// "Add from a link": the one server-side piece of The Rack. A callable Cloud Function, so Firebase
// itself checks the sign-in token and handles cross-site access; only signed-in people can use it.
//
// All the real work, and all the safety rules, are in ./lib (tested without Firebase):
//   preview  { action: 'preview', url }              -> title + candidate photos for a product page
//   image    { action: 'image', url, pageUrl? }      -> the chosen photo's bytes (validated), to be saved with the item
//
// Logging: only the HOST of an address and a short reason are ever logged. Never a full address
// (paths and queries can carry tokens), never credentials, never page contents.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { previewProduct, fetchImage } = require('./lib/import-service');
const { ImportError } = require('./lib/errors');
const { hostForLog } = require('./lib/url-guard');

initializeApp();

// How each reason is reported back. The page reads `details.reason` and shows its own plain-language message.
const STATUS = {
    INVALID_URL: 'invalid-argument', UNSUPPORTED_SCHEME: 'invalid-argument', CREDENTIALS_IN_URL: 'invalid-argument',
    BLOCKED_HOST: 'invalid-argument', BLOCKED_ADDRESS: 'invalid-argument', UNSAFE_REDIRECT: 'invalid-argument',
    NOT_A_PAGE: 'invalid-argument', NOT_AN_IMAGE: 'invalid-argument', BAD_REQUEST: 'invalid-argument',
    NOT_FOUND: 'not-found', LOGIN_REQUIRED: 'permission-denied', BLOCKED: 'permission-denied',
    TOO_LARGE: 'out-of-range', TIMEOUT: 'deadline-exceeded',
    DNS_FAILED: 'unavailable', NETWORK: 'unavailable', HTTP_ERROR: 'unavailable', TOO_MANY_REDIRECTS: 'unavailable'
};

// A simple per-person limit (per running instance) so one account can't use this as a download service:
// 20 requests a minute.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const recent = new Map();
function withinLimit(uid) {
    const now = Date.now();
    const times = (recent.get(uid) || []).filter(t => now - t < WINDOW_MS);
    if (times.length >= MAX_PER_WINDOW) { recent.set(uid, times); return false; }
    times.push(now);
    recent.set(uid, times);
    if (recent.size > 5000) for (const [k, v] of recent) if (!v.length || now - v[v.length - 1] > WINDOW_MS) recent.delete(k);
    return true;
}

exports.importProduct = onCall({
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 5                 // caps cost and abuse: at most five copies run at once
}, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to add from a link.', { reason: 'UNAUTHENTICATED' });
    if (!withinLimit(request.auth.uid)) throw new HttpsError('resource-exhausted', 'That’s a lot of imports. Wait a minute and try again.', { reason: 'RATE_LIMITED' });

    const data = request.data || {};
    try {
        if (data.action === 'preview') return await previewProduct({ url: String(data.url || '') });
        if (data.action === 'image') return await fetchImage({ url: String(data.url || ''), pageUrl: data.pageUrl ? String(data.pageUrl) : undefined });
        throw new ImportError('BAD_REQUEST', 'Unknown request.');
    } catch (err) {
        if (err instanceof ImportError) {
            logger.info('import refused', { reason: err.code, host: hostForLog(data.url) });
            throw new HttpsError(STATUS[err.code] || 'failed-precondition', err.message, { reason: err.code });
        }
        logger.error('import failed', { host: hostForLog(data.url), kind: err && err.name });   // not err.message: it could contain an address
        throw new HttpsError('internal', 'Something went wrong importing that link.', { reason: 'INTERNAL' });
    }
});
