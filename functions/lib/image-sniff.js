// What kind of picture are these bytes? Decided from the bytes themselves, never from the file name or
// the content-type the other server claims. Only formats a browser can safely decode into a picture
// are accepted; SVG (which can carry scripts) and everything else gives null.

function sniffImageType(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
    const head = buf.toString('latin1', 0, 6);
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.toString('latin1', 4, 8) === 'ftyp' && /^(avif|avis)$/.test(buf.toString('latin1', 8, 12))) return 'image/avif';
    return null;
}

module.exports = { sniffImageType };
