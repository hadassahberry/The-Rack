// Photo framing: lets the owner choose which part of a clothing photo shows
// (move it around and zoom in), e.g. the shirt and not the pants in a tall photo.
//
// The original photo is never changed. Saving a frame stores two extra fields
// on the item: `thumb` (a square picture of the chosen part, used everywhere
// the app shows the item) and `crop` (so the editor reopens as it was left).
// An item with no `thumb` simply shows its whole photo, as before.

const PHOTO_THUMB_SIZE = 400;      // px, the saved square
const PHOTO_ZOOM_MIN = 1;          // 1 = the whole photo fits inside the frame

// ---------------------------------------------------------------------------
// Pure geometry (no page access, so it can be tested on its own).
// W x H: the photo's size. F: the frame's side in px. z: zoom, 1 = whole photo fits.

// Display scale (frame px per photo px).
function frameScale(W, H, F, z) {
    return (F / Math.max(W, H)) * z;
}

// The photo point (cx, cy) shown at the middle of the frame, kept so the frame
// never shows empty space on a side where the photo is bigger than the frame,
// and centers the photo on a side where it is smaller.
function clampCenter(cx, cy, W, H, F, z) {
    const s = frameScale(W, H, F, z);
    const fit = (c, size) => {
        const shown = size * s;
        if (shown <= F + 1e-6) return size / 2;
        const half = F / (2 * s);
        return Math.min(size - half, Math.max(half, c));
    };
    return { cx: fit(cx, W), cy: fit(cy, H) };
}

// Zoom to newZ, keeping the photo point under (ax, ay) (frame px) where it was.
function zoomAround(state, newZ, ax, ay, W, H, F, maxZ) {
    const z = Math.min(maxZ, Math.max(PHOTO_ZOOM_MIN, newZ));
    const s0 = frameScale(W, H, F, state.z);
    const s1 = frameScale(W, H, F, z);
    const px = state.cx + (ax - F / 2) / s0;
    const py = state.cy + (ay - F / 2) / s0;
    const c = clampCenter(px - (ax - F / 2) / s1, py - (ay - F / 2) / s1, W, H, F, z);
    return { z, cx: c.cx, cy: c.cy };
}

// Zoom needed so the photo's shorter side fills the frame ("fill").
function fillZoom(W, H) {
    return Math.max(W, H) / Math.min(W, H);
}

// Where to draw the photo on a T x T canvas to save what the frame shows.
function frameDrawRect(W, H, F, state, T) {
    const s = frameScale(W, H, F, state.z);
    const k = T / F;
    return {
        x: (F / 2 - state.cx * s) * k,
        y: (F / 2 - state.cy * s) * k,
        w: W * s * k,
        h: H * s * k
    };
}

// Is this the untouched view (whole photo, nothing to save)?
function isWholePhoto(state) {
    return state.z <= PHOTO_ZOOM_MIN + 0.001;
}

// ---------------------------------------------------------------------------
// The editor inside the edit-item popup.

const PhotoFrame = (() => {
    let img, frame, zoomInput, labelA, labelB;
    let W = 0, H = 0, F = 0, maxZ = 4;
    let state = { z: 1, cx: 0, cy: 0 };
    let start = null;                    // the state when the popup opened (to tell if it changed)
    let ready = false;
    const pointers = new Map();
    let pinchDistance = 0;

    function render() {
        if (!ready) return;
        const s = frameScale(W, H, F, state.z);
        img.style.width = `${W * s}px`;
        img.style.height = `${H * s}px`;
        img.style.left = `${F / 2 - state.cx * s}px`;
        img.style.top = `${F / 2 - state.cy * s}px`;
        zoomInput.value = String(Math.round(state.z * 100));
    }

    function set(next) {
        const c = clampCenter(next.cx, next.cy, W, H, F, next.z);
        state = { z: next.z, cx: c.cx, cy: c.cy };
        render();
    }

    function zoomTo(z, ax = F / 2, ay = F / 2) {
        set(zoomAround(state, z, ax, ay, W, H, F, maxZ));
    }

    function panBy(dx, dy) {            // dx, dy: frame px the photo moved
        const s = frameScale(W, H, F, state.z);
        set({ z: state.z, cx: state.cx - dx / s, cy: state.cy - dy / s });
    }

    function measure() {
        F = frame.clientWidth;
    }

    function framePoint(clientX, clientY) {
        const r = frame.getBoundingClientRect();
        return { x: clientX - r.left, y: clientY - r.top };
    }

    // "Top" / "Bottom" (or "Left" / "Right" for a wide photo): zoom to fill the frame and stick to that edge.
    function fillTo(edge) {
        const z = Math.min(maxZ, fillZoom(W, H));
        const tall = H >= W;
        const cx = tall ? W / 2 : (edge === 'start' ? 0 : W);
        const cy = tall ? (edge === 'start' ? 0 : H) : H / 2;
        set({ z, cx, cy });
    }

    function init() {
        img = document.getElementById('modal-img');
        frame = document.getElementById('crop-frame');
        zoomInput = document.getElementById('crop-zoom');
        labelA = document.getElementById('crop-fill-start');
        labelB = document.getElementById('crop-fill-end');
        if (!img || !frame) return;

        zoomInput.addEventListener('input', () => zoomTo(Number(zoomInput.value) / 100));
        document.getElementById('crop-fit-all').addEventListener('click', () => set({ z: 1, cx: W / 2, cy: H / 2 }));
        labelA.addEventListener('click', () => fillTo('start'));
        labelB.addEventListener('click', () => fillTo('end'));

        // Drag to move; two fingers to pinch-zoom.
        frame.addEventListener('pointerdown', (e) => {
            if (!ready) return;
            frame.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            frame.classList.add('dragging');
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
            }
        });
        frame.addEventListener('pointermove', (e) => {
            const before = pointers.get(e.pointerId);
            if (!before || !ready) return;
            const now = { x: e.clientX, y: e.clientY };
            pointers.set(e.pointerId, now);
            if (pointers.size === 1) {
                panBy(now.x - before.x, now.y - before.y);
            } else if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinchDistance > 0) {
                    const mid = framePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
                    zoomTo(state.z * (d / pinchDistance), mid.x, mid.y);
                }
                pinchDistance = d;
            }
        });
        const release = (e) => {
            pointers.delete(e.pointerId);
            pinchDistance = 0;
            if (pointers.size === 0) frame.classList.remove('dragging');
        };
        frame.addEventListener('pointerup', release);
        frame.addEventListener('pointercancel', release);

        // Mouse wheel zooms toward the pointer; arrow keys and +/- work too.
        frame.addEventListener('wheel', (e) => {
            if (!ready) return;
            e.preventDefault();
            const p = framePoint(e.clientX, e.clientY);
            zoomTo(state.z * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
        }, { passive: false });
        frame.addEventListener('keydown', (e) => {
            if (!ready) return;
            const step = 12;
            const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
            if (moves[e.key]) { e.preventDefault(); panBy(...moves[e.key]); }
            else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(state.z * 1.15); }
            else if (e.key === '-') { e.preventDefault(); zoomTo(state.z / 1.15); }
        });

        window.addEventListener('resize', () => {
            if (!ready) return;
            const old = F;
            measure();
            if (F && old && F !== old) set(state);     // same view at the new size
        });
    }

    // Show an item's photo in the frame. Call after the popup is visible (the frame needs a size).
    function load(item) {
        ready = false;
        pointers.clear();
        img.onload = () => {
            W = img.naturalWidth; H = img.naturalHeight;
            measure();
            if (!W || !H || !F) return;
            maxZ = Math.max(4, fillZoom(W, H) * 2);
            zoomInput.min = String(PHOTO_ZOOM_MIN * 100);
            zoomInput.max = String(Math.round(maxZ * 100));
            const tall = H >= W;
            labelA.textContent = tall ? 'Top' : 'Left';
            labelB.textContent = tall ? 'Bottom' : 'Right';
            ready = true;
            const c = item.crop;
            const saved = c && Number.isFinite(c.z) && Number.isFinite(c.cx) && Number.isFinite(c.cy);
            set(saved ? { z: Math.min(maxZ, Math.max(1, c.z)), cx: c.cx * W, cy: c.cy * H }
                      : { z: 1, cx: W / 2, cy: H / 2 });
            start = { ...state };
        };
        img.removeAttribute('style');
        img.src = item.image;
    }

    function unload() {
        ready = false;
        pointers.clear();
        frame && frame.classList.remove('dragging');
    }

    function changed() {
        if (!ready || !start) return false;
        return Math.abs(state.z - start.z) > 0.001 || Math.abs(state.cx - start.cx) > 0.5 || Math.abs(state.cy - start.cy) > 0.5;
    }

    // What to save: nothing if untouched; the framed square + crop if changed;
    // and clearing both if the owner put it back to the whole photo.
    function buildPatch() {
        if (!changed()) return {};
        if (isWholePhoto(state)) return { thumb: null, crop: null };
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = PHOTO_THUMB_SIZE;
        const g = canvas.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, PHOTO_THUMB_SIZE, PHOTO_THUMB_SIZE);
        const r = frameDrawRect(W, H, F, state, PHOTO_THUMB_SIZE);
        g.drawImage(img, r.x, r.y, r.w, r.h);
        return {
            thumb: canvas.toDataURL('image/jpeg', 0.85),
            crop: { z: round4(state.z), cx: round4(state.cx / W), cy: round4(state.cy / H) }
        };
    }

    function round4(n) { return Math.round(n * 10000) / 10000; }

    return { init, load, unload, buildPatch };
})();

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => PhotoFrame.init());
}

if (typeof module !== 'undefined') {
    module.exports = { frameScale, clampCenter, zoomAround, fillZoom, frameDrawRect, isWholePhoto };
}
