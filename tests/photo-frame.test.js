// js/photo-frame.js: the geometry behind choosing which part of a clothing photo shows.
const { check, done, assert } = require('./_harness');
const P = require('../js/photo-frame.js');

const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} vs ${b}`);
const W = 400, H = 600, F = 300;                      // a tall photo in a 300px frame

check('at zoom 1 the whole photo fits: the longer side fills the frame', () => {
    near(P.frameScale(W, H, F, 1), 0.5);
    near(P.frameScale(H, W, F, 1), 0.5, 'a wide photo fits the same way');
    near(P.frameScale(W, H, F, 2), 1);
});
check('"fill" zoom makes the shorter side fill the frame', () => {
    near(P.fillZoom(400, 600), 1.5);
    near(P.fillZoom(600, 400), 1.5);
    near(P.fillZoom(500, 500), 1);
    // at that zoom the shorter side is exactly the frame
    near(W * P.frameScale(W, H, F, P.fillZoom(W, H)), F);
});
check('only the untouched view counts as "whole photo" (nothing to save)', () => {
    assert.strictEqual(P.isWholePhoto({ z: 1 }), true);
    assert.strictEqual(P.isWholePhoto({ z: 1.0005 }), true);
    assert.strictEqual(P.isWholePhoto({ z: 1.5 }), false);
});
check('the frame never shows empty space where the photo is bigger than the frame', () => {
    // zoom 1: the whole photo fits, so it is simply centred
    assert.deepStrictEqual(P.clampCenter(0, 0, W, H, F, 1), { cx: 200, cy: 300 });
    // zoom 2: the photo is 400x600 at scale 1 -> shows 300x300 of it; the centre is kept 150px from each edge
    assert.deepStrictEqual(P.clampCenter(0, 0, W, H, F, 2), { cx: 150, cy: 150 });
    assert.deepStrictEqual(P.clampCenter(9999, 9999, W, H, F, 2), { cx: 250, cy: 450 });
    assert.deepStrictEqual(P.clampCenter(100, 100, W, H, F, 3), { cx: 100, cy: 100 }, 'a point already inside is left alone');
});
check('zoom is limited to 1 .. max, and zooming keeps the point under the finger/cursor', () => {
    assert.strictEqual(P.zoomAround({ z: 1, cx: 200, cy: 300 }, 10, 150, 150, W, H, F, 4).z, 4);
    assert.strictEqual(P.zoomAround({ z: 3, cx: 200, cy: 300 }, 0.2, 150, 150, W, H, F, 4).z, 1);
    // zooming in about the middle of the frame keeps the same centre
    const mid = P.zoomAround({ z: 1, cx: 200, cy: 300 }, 2, 150, 150, W, H, F, 4);
    assert.deepStrictEqual(mid, { z: 2, cx: 200, cy: 300 });
    // zooming about a point keeps the photo point under it where it was (as long as the frame is not pushed past an edge)
    const before = { z: 2, cx: 200, cy: 300 };
    const ax = 170, ay = 140;
    const pointBefore = { x: before.cx + (ax - F / 2) / P.frameScale(W, H, F, before.z), y: before.cy + (ay - F / 2) / P.frameScale(W, H, F, before.z) };
    const after = P.zoomAround(before, 2.5, ax, ay, W, H, F, 4);
    const pointAfter = { x: after.cx + (ax - F / 2) / P.frameScale(W, H, F, after.z), y: after.cy + (ay - F / 2) / P.frameScale(W, H, F, after.z) };
    near(pointBefore.x, pointAfter.x); near(pointBefore.y, pointAfter.y);
});
check('where the photo is drawn on the saved square picture', () => {
    const whole = P.frameDrawRect(W, H, F, { z: 1, cx: 200, cy: 300 }, 400);
    near(whole.x, 66.666667); near(whole.y, 0); near(whole.w, 266.666667); near(whole.h, 400);
    const zoomed = P.frameDrawRect(W, H, F, { z: 2, cx: 200, cy: 150 }, 400);
    near(zoomed.w, 533.333333); near(zoomed.h, 800);
    assert(zoomed.y === 0 || Math.abs(zoomed.y) < 1e-9, 'the top of the photo is at the top of the frame');
});

done();
