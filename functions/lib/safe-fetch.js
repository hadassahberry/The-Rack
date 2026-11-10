// Fetches a web address on behalf of a signed-in person, without letting the address make the
// server reach anything private. Node built-ins only.
//
// For EVERY request (the first and each redirect):
//   1. The address is validated again (scheme, no credentials, default port, no IP/internal host).
//   2. The host name is resolved ONCE and every address it resolves to must be public.
//   3. The connection is then made to that checked address, not to the name again, so a host that
//      answers differently the second time (DNS rebinding) cannot send us somewhere private. TLS
//      still verifies the certificate against the real host name.
// Also enforced: a redirect limit, an overall time limit, an idle limit, a size limit counted on the
// bytes actually received (after decompression, so a "zip bomb" is cut off too), and a content-type
// check before the body is read. No cookies or credentials are ever sent.

const http = require('http');
const https = require('https');
const dns = require('dns');
const zlib = require('zlib');
const { ImportError } = require('./errors');
const { parsePublicUrl, isPublicAddress } = require('./url-guard');

const USER_AGENT = 'Mozilla/5.0 (compatible; TheRackImporter/1.0)';
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

function lookupAll(lookup, hostname) {
    return new Promise((resolve, reject) => lookup(hostname, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))));
}

// Resolves a host name and returns one address that has been checked; refuses if ANY of the
// addresses it resolves to is not public.
async function resolveSafely(hostname, opts) {
    let addrs;
    try { addrs = await lookupAll(opts.lookup, hostname); } catch (e) { throw new ImportError('DNS_FAILED', 'Couldn’t find that website.'); }
    if (!addrs || addrs.length === 0) throw new ImportError('DNS_FAILED', 'Couldn’t find that website.');
    for (const a of addrs) {
        if (!opts.isAllowedAddress(a.address)) throw new ImportError('BLOCKED_ADDRESS', 'That address is on a private network, so it can’t be imported.');
    }
    return addrs[0];
}

function requestOnce(url, addr, opts, deadline) {
    return new Promise((resolve, reject) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return reject(new ImportError('TIMEOUT', 'That website took too long to answer.'));
        let settled = false;
        let req;
        const done = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
        const timer = setTimeout(() => { if (req) req.destroy(); done(reject, new ImportError('TIMEOUT', 'That website took too long to answer.')); }, remaining);

        const lib = url.protocol === 'https:' ? https : http;
        req = lib.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            agent: false,                                          // no connection reuse between hops or people
            timeout: opts.idleTimeoutMs,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': opts.acceptHeader,
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                ...opts.headers
            },
            // Connect to the address we already checked, whatever the name would resolve to now.
            lookup: (host, options, cb) => {
                if (options && options.all) cb(null, [{ address: addr.address, family: addr.family }]);
                else cb(null, addr.address, addr.family);
            }
        }, (res) => {
            const status = res.statusCode || 0;
            if (REDIRECT_STATUSES.includes(status) && res.headers.location) {
                res.resume();
                return done(resolve, { redirect: String(res.headers.location) });
            }
            if (status >= 300) {
                res.resume();
                if (status === 401) return done(reject, new ImportError('LOGIN_REQUIRED', 'That page needs you to sign in first.'));
                if (status === 403 || status === 429) return done(reject, new ImportError('BLOCKED', 'That store doesn’t allow automatic importing.'));
                if (status === 404 || status === 410) return done(reject, new ImportError('NOT_FOUND', 'That page wasn’t found.'));
                return done(reject, new ImportError('HTTP_ERROR', `That website answered with an error (${status}).`));
            }

            const contentType = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (!opts.accept(contentType)) {
                res.resume();
                return done(reject, new ImportError(opts.badTypeCode, opts.badTypeMessage));
            }
            const declared = Number(res.headers['content-length']);
            if (Number.isFinite(declared) && declared > opts.maxBytes) {
                res.resume();
                return done(reject, new ImportError('TOO_LARGE', opts.tooLargeMessage));
            }

            let stream = res;
            const encoding = String(res.headers['content-encoding'] || '').toLowerCase().trim();
            if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
            else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
            else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
            else if (encoding && encoding !== 'identity') { res.resume(); return done(reject, new ImportError('NETWORK', 'That website answered in a way that can’t be read.')); }

            const chunks = [];
            let total = 0;
            stream.on('data', (chunk) => {
                total += chunk.length;
                if (total > opts.maxBytes) {                       // counted after decompression
                    req.destroy();
                    res.destroy();
                    return done(reject, new ImportError('TOO_LARGE', opts.tooLargeMessage));
                }
                chunks.push(chunk);
            });
            const charset = (/charset\s*=\s*["']?([\w.:-]+)/i.exec(String(res.headers['content-type'] || '')) || [])[1] || '';
            stream.on('end', () => done(resolve, { status, contentType, charset, body: Buffer.concat(chunks) }));
            stream.on('error', () => done(reject, new ImportError('NETWORK', 'The download was interrupted.')));
            res.on('error', () => done(reject, new ImportError('NETWORK', 'The download was interrupted.')));
        });
        req.on('timeout', () => { req.destroy(); done(reject, new ImportError('TIMEOUT', 'That website took too long to answer.')); });
        req.on('error', (e) => done(reject, e instanceof ImportError ? e : new ImportError('NETWORK', 'Couldn’t make a connection to that website.')));
        req.end();
    });
}

// options: { maxBytes, accept(contentType) -> bool, acceptHeader, headers, badTypeCode, badTypeMessage,
//            maxRedirects, totalTimeoutMs, idleTimeoutMs,
//            lookup, isAllowedAddress, allowedPorts }   (the last three exist so tests can use a local server)
// Resolves to { finalUrl, status, contentType, body: Buffer }.
async function safeGet(startUrl, options = {}) {
    const opts = {
        maxBytes: 2 * 1024 * 1024,
        accept: () => true,
        acceptHeader: '*/*',
        headers: {},
        badTypeCode: 'BAD_TYPE',
        badTypeMessage: 'That address isn’t the kind of file we can import.',
        tooLargeMessage: 'That file is too large to import.',
        maxRedirects: 5,
        totalTimeoutMs: 12000,
        idleTimeoutMs: 8000,
        lookup: dns.lookup,
        isAllowedAddress: isPublicAddress,
        allowedPorts: [80, 443],
        ...options
    };
    const deadline = Date.now() + opts.totalTimeoutMs;
    let url = parsePublicUrl(startUrl, { allowedPorts: opts.allowedPorts });
    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
        const addr = await resolveSafely(url.hostname, opts);
        const result = await requestOnce(url, addr, opts, deadline);
        if (!result.redirect) return { finalUrl: url.href, status: result.status, contentType: result.contentType, charset: result.charset, body: result.body };
        try {
            url = parsePublicUrl(new URL(result.redirect, url).href, { allowedPorts: opts.allowedPorts });   // the same rules, again
        } catch (e) {
            throw new ImportError('UNSAFE_REDIRECT', 'That link sends you somewhere that can’t be imported.');
        }
    }
    throw new ImportError('TOO_MANY_REDIRECTS', 'That link redirects too many times.');
}

module.exports = { safeGet, resolveSafely };
