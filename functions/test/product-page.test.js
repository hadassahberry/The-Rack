const test = require('node:test');
const assert = require('node:assert/strict');
const { extractProductInfo, looksBlocked, decodeEntities, resolveUrl } = require('../lib/product-page');

const PAGE = 'https://shop.example.com/products/navy-shirt';
const urls = (info) => info.candidates.map(c => c.url);

test('schema.org JSON-LD product data comes first (a typical Shopify-style page)', () => {
    const html = `<html><head>
      <title>Navy Button-Down Shirt – Example Co.</title>
      <meta property="og:title" content="Navy Button-Down Shirt">
      <meta property="og:site_name" content="Example Co.">
      <meta property="og:image" content="https://cdn.example.com/og/navy-shirt.jpg">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Navy Button-Down Shirt",
        "image":["https://cdn.example.com/p/navy-front.jpg","https://cdn.example.com/p/navy-back.jpg"],"color":"Navy","category":"Shirts",
        "brand":{"@type":"Brand","name":"Example Co."}}</script></head><body></body></html>`;
    const info = extractProductInfo(html, PAGE);
    assert.equal(info.title, 'Navy Button-Down Shirt');
    assert.equal(info.siteName, 'Example Co.');
    assert.equal(info.brand, 'Example Co.'); assert.equal(info.color, 'Navy'); assert.equal(info.category, 'Shirts');
    assert.deepEqual(urls(info), ['https://cdn.example.com/p/navy-front.jpg', 'https://cdn.example.com/p/navy-back.jpg', 'https://cdn.example.com/og/navy-shirt.jpg']);
    assert.deepEqual(info.candidates.map(c => c.source), ['product', 'product', 'page']);
});

test('JSON-LD in @graph, with ImageObject images and a ProductGroup', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite","name":"Shop"},
      {"@type":["ProductGroup"],"name":"Wool Coat","image":{"@type":"ImageObject","url":"https://cdn.example.com/coat.jpg"},
       "hasVariant":[{"@type":"Product","name":"Wool Coat - Camel","image":[{"@type":"ImageObject","contentUrl":"https://cdn.example.com/coat-camel.jpg"}]}]}]}</script>`;
    const info = extractProductInfo(html, PAGE);
    assert.equal(info.title, 'Wool Coat');
    assert.deepEqual(urls(info), ['https://cdn.example.com/coat.jpg', 'https://cdn.example.com/coat-camel.jpg']);
});

test('a store with only link-preview tags still works', () => {
    const html = `<head><meta name="twitter:title" content="Floral &amp; Lace Dress"><meta name="twitter:image" content="https://img.example.com/dress.webp"></head>`;
    const info = extractProductInfo(html, PAGE);
    assert.equal(info.title, 'Floral & Lace Dress');
    assert.deepEqual(urls(info), ['https://img.example.com/dress.webp']);
});

test('titles: entities decoded, whitespace collapsed, control characters removed, length capped', () => {
    const info = extractProductInfo(`<title>  Men&#39;s\n  T&#x2011;Shirt &amp; Tie\u0007 &ndash; Sale &nbsp;Now </title>`, PAGE);
    assert.equal(info.title, 'Men\'s T‑Shirt & Tie – Sale Now');
    assert.equal(extractProductInfo(`<title>${'x'.repeat(2000)}</title>`, PAGE).title.length, 300);
    assert.equal(decodeEntities('&unknown; &#0; &#99999999;'), '&unknown; &#0; &#99999999;'.replace('&#0;', '').replace('&#99999999;', ''));
});

test('relative, protocol-relative and <base> addresses are made absolute', () => {
    const html = `<base href="https://static.example.com/assets/"><meta property="og:image" content="//cdn.example.com/a.jpg">
      <script type="application/ld+json">{"@type":"Product","name":"X","image":["../img/b.jpg","/c.jpg"]}</script>`;
    assert.deepEqual(urls(extractProductInfo(html, PAGE)), ['https://static.example.com/img/b.jpg', 'https://static.example.com/c.jpg', 'https://cdn.example.com/a.jpg']);
});

test('the same picture at different sizes is listed once', () => {
    const html = `<meta property="og:image" content="https://cdn.example.com/p/shirt.jpg?width=1200">
      <script type="application/ld+json">{"@type":"Product","name":"X","image":["https://cdn.example.com/p/shirt.jpg?width=600","https://cdn.example.com/p/other.jpg"]}</script>`;
    assert.deepEqual(urls(extractProductInfo(html, PAGE)), ['https://cdn.example.com/p/shirt.jpg?width=600', 'https://cdn.example.com/p/other.jpg']);
});

test('with no metadata, ordinary photos are offered; logos, icons, banners and tiny images are not', () => {
    const html = `<body>
      <img src="/assets/logo.png" width="300" height="80" alt="Example logo">
      <img src="/img/icons/cart.svg" width="24" height="24">
      <img src="/img/pixel.gif" width="1" height="1">
      <img src="/img/small.jpg" width="60" height="60" alt="thumb">
      <img src="/img/hero-banner.jpg" width="1600" height="400" alt="Summer sale banner">
      <img src="/img/shirt-1.jpg" width="800" height="1000" alt="Navy shirt front">
      <img data-src="/img/shirt-2.jpg" alt="Navy shirt back">
      <img srcset="/img/shirt-3-480.jpg 480w, /img/shirt-3-1200.jpg 1200w, /img/shirt-3-800.jpg 800w">
      <img src="data:image/png;base64,AAAA" width="500" height="500">
    </body>`;
    assert.deepEqual(urls(extractProductInfo(html, PAGE)), [
        'https://shop.example.com/img/shirt-1.jpg', 'https://shop.example.com/img/shirt-2.jpg', 'https://shop.example.com/img/shirt-3-1200.jpg']);
});

test('<img> tags are only a fallback: they are not added when the store gave real product images', () => {
    const html = `<meta property="og:image" content="https://cdn.example.com/a.jpg"><meta name="twitter:image" content="https://cdn.example.com/b.jpg">
      <script type="application/ld+json">{"@type":"Product","name":"X","image":"https://cdn.example.com/c.jpg"}</script>
      <img src="/img/unrelated-1.jpg" width="800" height="800"><img src="/img/unrelated-2.jpg" width="800" height="800">`;
    assert.deepEqual(urls(extractProductInfo(html, PAGE)), ['https://cdn.example.com/c.jpg', 'https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']);
});

test('at most ten candidates', () => {
    const imgs = Array.from({ length: 40 }, (_, i) => `"https://cdn.example.com/p/${i}.jpg"`).join(',');
    assert.equal(extractProductInfo(`<script type="application/ld+json">{"@type":"Product","name":"X","image":[${imgs}]}</script>`, PAGE).candidates.length, 10);
});

test('hostile or broken markup is harmless', () => {
    const html = `<script type="application/ld+json">{ this is not json</script>
      <script type="application/ld+json">{"@type":"Product","name":"<img src=x onerror=alert(1)>","image":["javascript:alert(1)","data:image/png;base64,AAAA","https://user:pw@cdn.example.com/a.jpg","ftp://cdn.example.com/b.jpg","file:///etc/passwd","https://cdn.example.com/ok.jpg"]}</script>
      <meta property="og:image" content="javascript:alert(2)"><meta property="og:image" content="">`;
    const info = extractProductInfo(html, PAGE);
    assert.deepEqual(urls(info), ['https://cdn.example.com/ok.jpg'], 'only the one clean address survives');
    assert.equal(info.title, '<img src=x onerror=alert(1)>', 'the title is plain text; the page escapes it when it shows it');
});

test('empty and non-HTML input do not throw', () => {
    for (const x of ['', null, undefined, 'plain text', '<html></html>', '\u0000\u0001']) {
        const info = extractProductInfo(x, PAGE);
        assert.deepEqual(info.candidates, []); assert.equal(typeof info.title, 'string');
    }
});

test('a sign-in page is recognised', () => {
    const html = `<title>Sign in</title><form><input type="email"><input type="password" name="p"></form>`;
    assert.equal(looksBlocked(html, 'https://shop.example.com/account/login?return=/p', extractProductInfo(html, PAGE)), 'LOGIN_REQUIRED');
    // a product page that merely has a sign-in box in its header is NOT a login wall
    const product = `<meta property="og:image" content="https://cdn.example.com/a.jpg"><header><input type="password"></header>`;
    assert.equal(looksBlocked(product, PAGE, extractProductInfo(product, PAGE)), null);
});

test('a bot-check page is recognised', () => {
    for (const title of ['Just a moment...', 'Access Denied', 'Attention Required! | Cloudflare', 'Are you a robot?']) {
        const html = `<title>${title}</title>`;
        assert.equal(looksBlocked(html, PAGE, extractProductInfo(html, PAGE)), 'BLOCKED', title);
    }
    const html = `<title>Hmm</title><div id="px-captcha"></div>`;
    assert.equal(looksBlocked(html, PAGE, extractProductInfo(html, PAGE)), 'BLOCKED');
});

test('a normal product page is not mistaken for a block', () => {
    const html = `<title>Navy Shirt</title><meta property="og:image" content="https://cdn.example.com/a.jpg">`;
    assert.equal(looksBlocked(html, PAGE, extractProductInfo(html, PAGE)), null);
});

test('resolveUrl', () => {
    assert.equal(resolveUrl('/a.jpg#x', 'https://e.com/p/'), 'https://e.com/a.jpg');
    assert.equal(resolveUrl('javascript:alert(1)', 'https://e.com/'), null);
    assert.equal(resolveUrl('', 'https://e.com/'), null);
    assert.equal(resolveUrl('https://u:p@e.com/a', 'https://e.com/'), null);
});
