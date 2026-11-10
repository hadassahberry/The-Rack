// Decides whether a web address may be fetched by the server at all, and whether a network
// address it points to is a PUBLIC one. This is the line between "import a product photo" and
// "make our server read something inside a private network" (SSRF), so it is deliberately strict:
//
//   - only http: and https:, on the default ports (80 / 443), with no username or password in the URL
//   - no IP-address hosts, no "localhost", no single-word or internal-looking host names
//   - every address the host resolves to must be public (checked by isPublicAddress below)
//
// Pure functions, Node built-ins only, so they are tested on their own.

const net = require('net');
const { ImportError } = require('./errors');

const MAX_URL_LENGTH = 2048;
const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.localdomain', '.home', '.lan', '.corp', '.intranet', '.private', '.home.arpa'];

// ---- IPv4 / IPv6 ------------------------------------------------------------------------------

function ipv4ToInt(ip) {
    const p = ip.split('.').map(Number);
    return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

// [network, prefix length]: every IPv4 range that is not ordinary public internet.
const BLOCKED_V4 = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].map(([ip, bits]) => ({ base: ipv4ToInt(ip), mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0 }));

function isPublicIPv4(ip) {
    const n = ipv4ToInt(ip);
    return !BLOCKED_V4.some(r => ((n & r.mask) >>> 0) === ((r.base & r.mask) >>> 0));
}

// "2001:db8::1" -> eight 16-bit groups, or null if it isn't a valid IPv6 address.
function parseIPv6(text) {
    let ip = String(text);
    if (ip.includes('%')) return null;                      // zone ids (fe80::1%eth0) are never public
    if (!net.isIPv6(ip)) return null;
    // an embedded IPv4 tail ("::ffff:1.2.3.4") becomes two groups
    const tail = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (tail) {
        const v4 = tail[2].split('.').map(Number);
        ip = tail[1] + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
    }
    const halves = ip.split('::');
    const head = halves[0] ? halves[0].split(':') : [];
    const rest = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
    const fill = halves.length > 1 ? 8 - head.length - rest.length : 0;
    const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...rest].map(g => parseInt(g, 16));
    return groups.length === 8 && groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4FromGroups = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function isPublicIPv6(ip) {
    const g = parseIPv6(ip);
    if (!g) return false;
    // IPv4-mapped (::ffff:a.b.c.d): the real destination is the IPv4 address inside
    if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return isPublicIPv4(v4FromGroups(g[6], g[7]));
    // NAT64 (64:ff9b::/96): also an IPv4 address inside
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return isPublicIPv4(v4FromGroups(g[6], g[7]));
    // 6to4 (2002::/16) carries an IPv4 address too
    if (g[0] === 0x2002) return isPublicIPv4(v4FromGroups(g[1], g[2]));
    // Only global unicast (2000::/3) can be public; and inside it, not the special-purpose ranges:
    if ((g[0] & 0xe000) !== 0x2000) return false;                       // ::, ::1, fc00::/7, fe80::/10, ff00::/8, ...
    if (g[0] === 0x2001 && g[1] <= 0x01ff) return false;                // 2001::/23 protocol assignments (Teredo ...)
    if (g[0] === 0x2001 && g[1] === 0x0db8) return false;               // documentation
    if ((g[0] & 0xfff0) === 0x3ff0) return false;                       // 3fff::/20 documentation
    return true;
}

// True only for an address on the public internet.
function isPublicAddress(address) {
    if (net.isIPv4(address)) return isPublicIPv4(address);
    if (net.isIPv6(address)) return isPublicIPv6(address);
    return false;
}

// ---- URLs -------------------------------------------------------------------------------------

// Returns a URL object for something safe to fetch, or throws an ImportError saying why not.
function parsePublicUrl(input, { allowedPorts = [80, 443] } = {}) {
    const text = String(input == null ? '' : input).trim();
    if (!text) throw new ImportError('INVALID_URL', 'Paste the web address of a product page.');
    if (text.length > MAX_URL_LENGTH) throw new ImportError('INVALID_URL', 'That web address is too long.');
    if (/[\u0000- \u007f]/.test(text)) throw new ImportError('INVALID_URL', 'That web address has spaces or odd characters in it.');

    let url;
    try { url = new URL(text); } catch (e) { throw new ImportError('INVALID_URL', 'That doesn’t look like a web address.'); }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ImportError('UNSUPPORTED_SCHEME', 'Only http and https web addresses can be imported.');
    }
    if (url.username || url.password) {
        throw new ImportError('CREDENTIALS_IN_URL', 'Remove the username and password from the web address.');
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host) throw new ImportError('INVALID_URL', 'That doesn’t look like a web address.');
    if (net.isIP(host.replace(/^\[|\]$/g, ''))) {
        throw new ImportError('BLOCKED_HOST', 'Use the store’s web address, not a number-style address.');
    }
    if (host === 'localhost' || !host.includes('.') || INTERNAL_SUFFIXES.some(s => host.endsWith(s))) {
        throw new ImportError('BLOCKED_HOST', 'That address is on a private network, so it can’t be imported.');
    }
    const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
    if (!allowedPorts.includes(port)) throw new ImportError('BLOCKED_HOST', 'That web address uses a port that can’t be imported from.');
    url.hash = '';
    return url;
}

// For logs: the host only. Never the path or query (they can carry tokens) and never credentials.
function hostForLog(input) {
    try { return new URL(String(input)).hostname.toLowerCase(); } catch (e) { return '(unparseable)'; }
}

module.exports = { isPublicAddress, isPublicIPv4, isPublicIPv6, parseIPv6, parsePublicUrl, hostForLog, MAX_URL_LENGTH };
