const test = require('node:test');
const assert = require('node:assert/strict');
const { isPublicAddress, parsePublicUrl, parseIPv6, hostForLog } = require('../lib/url-guard');

const rejects = (input, code) => assert.throws(() => parsePublicUrl(input), (e) => e.code === code, `${input} -> ${code}`);

test('ordinary public product URLs are accepted', () => {
    assert.equal(parsePublicUrl('https://www.example.com/products/navy-shirt?color=navy').hostname, 'www.example.com');
    assert.equal(parsePublicUrl('  http://shop.example.co.uk/a/b  ').protocol, 'http:');
    assert.equal(parsePublicUrl('https://example.com:443/x').port, '');
    assert.equal(parsePublicUrl('https://example.com/x#reviews').hash, '', 'fragment is dropped');
    assert.match(parsePublicUrl('https://münchen-mode.example/kleid').hostname, /^xn--[a-z0-9-]+\.example$/, 'international names become punycode (ASCII), so the checks below see the real host');
});

test('empty, junk and over-long input is rejected', () => {
    rejects('', 'INVALID_URL'); rejects('   ', 'INVALID_URL'); rejects(null, 'INVALID_URL'); rejects(undefined, 'INVALID_URL');
    rejects('not a url', 'INVALID_URL'); rejects('example.com/shirt', 'INVALID_URL');
    rejects('https://exa mple.com/', 'INVALID_URL'); rejects('https://example.com/\u0000', 'INVALID_URL');
    rejects('https://example.com/' + 'a'.repeat(2100), 'INVALID_URL');
});

test('only http and https', () => {
    for (const u of ['ftp://example.com/a', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'gopher://example.com', 'ws://example.com', 'blob:https://example.com/1'])
        rejects(u, 'UNSUPPORTED_SCHEME');
});

test('credentials in the URL are rejected (so they can never reach a log)', () => {
    rejects('https://user:secret@example.com/a', 'CREDENTIALS_IN_URL');
    rejects('https://user@example.com/a', 'CREDENTIALS_IN_URL');
    rejects('https://:pw@example.com/a', 'CREDENTIALS_IN_URL');
    rejects('https://example.com@evil.example/a', 'CREDENTIALS_IN_URL', 'the host is evil.example, "example.com" is a username');
});

test('only the normal web ports', () => {
    for (const u of ['https://example.com:8080/a', 'http://example.com:22/', 'https://example.com:6379/', 'http://example.com:8443/']) rejects(u, 'BLOCKED_HOST');
    assert.equal(parsePublicUrl('http://example.com:80/a').hostname, 'example.com');
});

test('IP-address hosts are rejected, in every spelling', () => {
    for (const u of ['http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://8.8.8.8/',
        'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.1/', 'http://0/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
        'http://[fd00::1]/', 'http://[2001:db8::1]/'])
        rejects(u, 'BLOCKED_HOST');
});

test('localhost and internal-looking names are rejected', () => {
    for (const u of ['http://localhost/', 'http://LOCALHOST./', 'http://intranet/', 'http://printer/', 'http://nas.local/', 'http://app.internal/',
        'http://router.lan/', 'http://x.localhost/', 'http://host.home.arpa/', 'http://metadata.google.internal/computeMetadata/v1/'])
        rejects(u, 'BLOCKED_HOST');
});

test('IPv4: private, loopback, link-local, shared, reserved and multicast are not public', () => {
    for (const ip of ['0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254', '127.0.0.1', '127.255.255.255',
        '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.0.1', '192.168.255.255', '198.18.0.1', '198.19.255.255',
        '198.51.100.1', '203.0.113.9', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255'])
        assert.equal(isPublicAddress(ip), false, ip);
});

test('IPv4: ordinary public addresses are public, including just outside the private ranges', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1', '9.255.255.255', '192.167.1.1', '192.169.0.1', '198.17.0.1', '198.20.0.1', '223.255.255.255'])
        assert.equal(isPublicAddress(ip), true, ip);
});

test('IPv6: loopback, unspecified, unique-local, link-local, multicast are not public', () => {
    for (const ip of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1', '100::1', '2001:db8::1', '2001::1', '2001:1ff::1', '3fff::1', '::2'])
        assert.equal(isPublicAddress(ip), false, ip);
});

test('IPv6: addresses that hide an IPv4 address are judged by the IPv4 address', () => {
    assert.equal(isPublicAddress('::ffff:127.0.0.1'), false);
    assert.equal(isPublicAddress('::ffff:7f00:1'), false);
    assert.equal(isPublicAddress('::ffff:10.1.2.3'), false);
    assert.equal(isPublicAddress('::ffff:169.254.169.254'), false);
    assert.equal(isPublicAddress('::ffff:8.8.8.8'), true);
    assert.equal(isPublicAddress('64:ff9b::7f00:1'), false, 'NAT64 to 127.0.0.1');
    assert.equal(isPublicAddress('64:ff9b::808:808'), true, 'NAT64 to 8.8.8.8');
    assert.equal(isPublicAddress('2002:7f00:1::'), false, '6to4 to 127.0.0.1');
    assert.equal(isPublicAddress('2002:808:808::'), true, '6to4 to 8.8.8.8');
});

test('IPv6: ordinary global addresses are public', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4009::', '2620:0:ccc::2'])
        assert.equal(isPublicAddress(ip), true, ip);
});

test('things that are not addresses are never public', () => {
    for (const x of ['', 'example.com', 'abc', '999.1.1.1', '1.2.3', 'fe80::1%eth0', null, undefined]) assert.equal(isPublicAddress(x), false, String(x));
});

test('IPv6 parsing', () => {
    assert.deepEqual(parseIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(parseIPv6('2001:db8::ff00:42:8329'), [0x2001, 0xdb8, 0, 0, 0, 0xff00, 0x42, 0x8329]);
    assert.deepEqual(parseIPv6('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    assert.equal(parseIPv6('1:2:3:4:5:6:7:8:9'), null);
    assert.equal(parseIPv6('nope'), null);
});

test('logging helper keeps only the host', () => {
    assert.equal(hostForLog('https://user:pw@Shop.Example.com/a/b?token=SECRET#x'), 'shop.example.com');
    assert.equal(hostForLog('garbage'), '(unparseable)');
});
