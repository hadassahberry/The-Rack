// The small UI rules around "Help me choose", the sign-in form and the day window: the message when a refinement
// changes nothing, blank sign-in fields, and that the day window's Close control cannot sit over the heading.
const { check, done, assert, loadScript, read } = require('./_harness');

// ---- 7. a refinement that cannot change anything says so ----
const { refinementOutcome } = require('../js/help-choose.js');
const sigs = ['A', 'B', 'C'];
check('same ideas after a refinement: the panel says so, in words that match the button', () => {
    const o = (action, extra = {}) => refinementOutcome({ action, before: sigs, after: [...sigs], clamped: false, ...extra });
    assert(/couldn’t find anything more casual in your closet/.test(o('casual')));
    assert(/couldn’t find anything more dressy in your closet/.test(o('dressy')));
    assert(/couldn’t find anything warmer in your closet/.test(o('warmer')));
    assert(/couldn’t find anything lighter in your closet/.test(o('lighter')));
    assert(/Nothing else in your closet works with that piece/.test(o('keep')));
    assert(/didn’t change my ideas/.test(o('text')));
    assert(/everything I can put together/.test(o('more')));
    ['casual', 'dressy', 'warmer', 'lighter', 'keep', 'text', 'more'].forEach(a => assert(/these|ideas|closet/.test(o(a)), a));
});
check('the same ideas in a different order are still "the same"', () => {
    assert(refinementOutcome({ action: 'warmer', before: ['A', 'B', 'C'], after: ['C', 'A', 'B'] }) !== '');
});
check('different ideas, or a button that is not a refinement: nothing to say', () => {
    assert.strictEqual(refinementOutcome({ action: 'casual', before: ['A', 'B'], after: ['A', 'D'] }), '');
    assert.strictEqual(refinementOutcome({ action: 'casual', before: ['A', 'B', 'C'], after: ['A', 'B'] }), '');
    assert.strictEqual(refinementOutcome({ action: 'reset', before: ['A'], after: ['A'] }), '');
    assert.strictEqual(refinementOutcome({ action: 'close', before: [], after: [] }), '');
});
check('already at the limit of the setting: says so directly', () => {
    assert.strictEqual(refinementOutcome({ action: 'casual', before: ['A'], after: ['B'], clamped: true }), 'That’s as casual as I’ll go, so these are the same ideas.');
    assert.strictEqual(refinementOutcome({ action: 'warmer', before: ['A'], after: ['A'], clamped: true }), 'That’s as warm as I’ll go, so these are the same ideas.');
    assert(/as light as/.test(refinementOutcome({ action: 'lighter', before: ['A'], after: ['A'], clamped: true })));
    assert(/as dressy as/.test(refinementOutcome({ action: 'dressy', before: ['A'], after: ['A'], clamped: true })));
});
check('the panel shows that message first, and only after a refinement button was pressed', () => {
    const src = read('js/help-choose.js');
    assert(/notes\.unshift\(state\.sameNote\)/.test(src));
    assert(/state\.compare = kind \? \{ action: kind, before, clamped \} : null/.test(src));
    assert(/noteIfUnchanged\(mine, /.test(src), 'compared after the new ideas are known');
    assert(/clamp2\(r\.formalityShift - 1\)/.test(src), 'the limit is +-2');
});

// ---- 8. sign-in: blank fields ----
const auth = loadScript('js/auth.js', { window: {}, document: { addEventListener() {}, getElementById() { return null; } }, sessionStorage: { getItem() { return null; }, removeItem() {} }, location: { reload() {} } }, ['authInputProblem', 'friendlyAuthError']);
check('blank sign-in fields ask for what is missing (never "looks invalid")', () => {
    assert.strictEqual(auth.authInputProblem('', ''), 'Enter your email and password.');
    assert.strictEqual(auth.authInputProblem('   ', ''), 'Enter your email and password.');
    assert.strictEqual(auth.authInputProblem(null, undefined), 'Enter your email and password.');
    assert.strictEqual(auth.authInputProblem('', 'secret1'), 'Enter your email.');
    assert.strictEqual(auth.authInputProblem('a@b.co', ''), 'Enter your password.');
});
check('"looks invalid" only for an email that was actually entered and is not one', () => {
    for (const bad of ['abc', 'a@b', 'a b@c.com', '@c.com', 'a@.com']) assert.strictEqual(auth.authInputProblem(bad, 'secret1'), 'That email address looks invalid.', bad);
    assert.strictEqual(auth.authInputProblem('a@b.co', 'secret1'), '');
    assert.strictEqual(auth.authInputProblem('  me@example.com ', 'x'), '');
    assert.strictEqual(auth.authInputProblem('first.last+tag@sub.example.org', 'x'), '');
});
check('resetting a password needs only an email', () => {
    assert.strictEqual(auth.authInputProblem('me@example.com', '', { needPassword: false }), '');
    assert.strictEqual(auth.authInputProblem('', '', { needPassword: false }), 'Enter your email.');
    assert.strictEqual(auth.authInputProblem('nope', '', { needPassword: false }), 'That email address looks invalid.');
});
check('the buttons check first (no request is made for blank fields), and the other messages are unchanged', () => {
    const src = read('js/auth.js');
    const signin = src.slice(src.indexOf("getElementById('auth-signin-btn')"), src.indexOf("getElementById('auth-signup-btn')"));
    const signup = src.slice(src.indexOf("getElementById('auth-signup-btn')"), src.indexOf("getElementById('auth-google-btn')"));
    for (const body of [signin, signup]) assert(body.indexOf('authInputProblem(') > 0 && body.indexOf('authInputProblem(') < body.indexOf('waitForFirebase()'), 'checked before the sign-in request');
    assert.strictEqual(auth.friendlyAuthError({ code: 'auth/wrong-password' }), 'Incorrect email or password.');
    assert.strictEqual(auth.friendlyAuthError({ code: 'auth/invalid-email' }), 'That email address looks invalid.');
    assert.strictEqual(auth.friendlyAuthError({ code: 'auth/missing-password' }), 'Enter your email and password.');
    assert.strictEqual(auth.friendlyAuthError({ code: 'auth/weak-password' }), 'Password should be at least 6 characters.');
});

// ---- 3. the day window's Close control ----
const css = read('css/components.css');
const rules = (selector) => [...css.matchAll(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g'))].map(m => m[1]);
const merged = (selector) => Object.fromEntries(rules(selector).flatMap(b => b.split(';').map(d => d.split(/:(.+)/).map(x => (x || '').trim())).filter(d => d[0] && d[1] !== undefined)));
check('Close is a full-width, solid, raised bar pinned to the top of the scrolling window, so the heading passes UNDER it', () => {
    const c = merged('.back-to-calendar');
    assert.strictEqual(c.position, 'sticky');
    assert.strictEqual(c.top, '0');
    assert.strictEqual(c.width, '100%', 'a bar as wide as the window, not just the button');
    assert(/var\(--card-bg\)/.test(c.background) && !/transparent|none/.test(c.background), 'solid background');
    assert(Number(c['z-index']) >= 3, 'above the heading and other content');
    assert(/^(block)$/.test(c.display));
});
check('the heading and everything else in the window sits below it', () => {
    const panel = merged('.planning-panel');
    assert(/auto|scroll/.test(panel['overflow-y'] || ''), 'the window itself scrolls (so Close sticks inside it)');
    const stackAbove = [...css.matchAll(/\.planning-panel [^{\s][^{]*\{[^}]*z-index:\s*(\d+)/g)].map(m => Number(m[1]));
    assert(stackAbove.every(z => z < Number(merged('.back-to-calendar')['z-index'])), 'nothing inside the window stacks above Close');
    assert(/\.planning-panel h2/.test(css));
});

done();
