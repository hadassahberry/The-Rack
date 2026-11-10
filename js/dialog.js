// Shared behaviour for every window that sits on top of the page (the day popup, the edit-item
// window, the camera, "clear closet", "delete account" and the "Are you sure?" question).
//
// A window that blocks the page behind it has to do four things, and this does all of them:
//   1. Move keyboard focus INTO the window when it opens.
//   2. Keep Tab / Shift+Tab inside it, and make the page behind it unreachable
//      (the `inert` attribute: no focus, no clicks, and hidden from screen readers), so
//      declaring it modal is true.
//   3. Give focus back to whatever opened it when it closes, or to a sensible fallback if that
//      control no longer exists (the page redraws a lot).
//   4. Windows can stack (the edit window asks "Discard your changes?"): only the top one is
//      live, and closing it re-enables the one beneath.
// Each window keeps its own Escape / close behaviour (so the edit window can still ask before
// throwing away unsaved changes); this file doesn't touch Escape.
//
// Use:  el.classList.remove('hidden');  ModalDialogs.open(el, { initialFocus, returnTo, keep });
//       el.classList.add('hidden');     ModalDialogs.close(el);

const MODAL_FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

// Where Tab should send focus, or null to let the browser do what it normally does.
//   count: how many focusable things the window has; index: which one has focus (-1 = none of them);
//   shift: Shift+Tab. Tab on the last goes to the first, Shift+Tab on the first goes to the last, and
//   focus that has strayed outside comes back in. Returns an index, or 'container' when it has none.
function trapTarget({ count, index, shift }) {
    if (count === 0) return 'container';
    if (index < 0) return shift ? count - 1 : 0;
    if (!shift && index === count - 1) return 0;
    if (shift && index === 0) return count - 1;
    return null;
}

const ModalDialogs = (function () {
    const stack = [];            // open windows, the top one last: { el, trigger, returnTo, inerted }

    const isVisible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';

    function focusables(root) {
        return [...root.querySelectorAll(MODAL_FOCUSABLE)]
            .filter(e => !e.disabled && e.tabIndex >= 0 && isVisible(e));
    }

    // The window itself can take focus when it has nothing focusable inside.
    function focusContainer(el) {
        const target = el.querySelector('.modal-content') || el;
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
    }

    // Everything on the page that isn't the window (or on the way down to it) becomes inert.
    // Other windows that are currently closed are left alone, so they work when they open on top.
    function makeBackgroundInert(el, keep) {
        const changed = [];
        let node = el;
        while (node && node !== document.body && node.parentElement) {
            for (const sib of node.parentElement.children) {
                if (sib === node || keep.includes(sib) || sib.inert) continue;
                if (/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName)) continue;
                if (sib.classList.contains('modal') && sib.classList.contains('hidden')) continue;
                sib.inert = true;
                changed.push(sib);
            }
            node = node.parentElement;
        }
        return changed;
    }

    // opts.initialFocus: an element (or a function returning one) to focus first; default is the
    //                    first focusable thing in the window, else the window itself.
    // opts.returnTo:     a function giving the element to refocus on close if the one that had
    //                    focus when it opened is gone or hidden.
    // opts.keep:         elements outside the window that must stay clickable (the dim backdrop
    //                    that closes the day popup when clicked).
    function open(el, opts = {}) {
        const existing = stack.find(s => s.el === el);
        const entry = existing || {
            el,
            trigger: document.activeElement,
            returnTo: opts.returnTo || null,
            inerted: makeBackgroundInert(el, opts.keep || [])
        };
        if (!existing) stack.push(entry);
        else if (opts.returnTo) entry.returnTo = opts.returnTo;

        let target = typeof opts.initialFocus === 'function' ? opts.initialFocus() : opts.initialFocus;
        if (!target || !el.contains(target) || target.disabled) target = focusables(el)[0];
        if (target) target.focus({ preventScroll: true });
        else focusContainer(el);
    }

    function close(el) {
        const i = stack.findIndex(s => s.el === el);
        if (i < 0) return;
        const [entry] = stack.splice(i, 1);
        entry.inerted.forEach(e => { e.inert = false; });

        if (i !== stack.length) return;          // it wasn't the top window: nothing to hand focus back to
        // The page body is not somewhere to hand focus back to (that is what "nothing had focus" looks like,
        // e.g. in Safari, which doesn't focus a button when it is clicked): use the fallback instead.
        const usable = (e) => e && e !== document.body && e !== document.documentElement && e.isConnected && isVisible(e) && !e.closest('[inert]') && typeof e.focus === 'function';
        const back = [entry.trigger, entry.returnTo && entry.returnTo()].find(usable);
        if (back) back.focus({ preventScroll: true });
        else if (stack.length) {                 // fall back to the window underneath
            const below = stack[stack.length - 1].el;
            (focusables(below)[0] || below).focus({ preventScroll: true });
        }
    }

    function isOpen(el) {
        return stack.some(s => s.el === el);
    }

    if (typeof document !== 'undefined') {
        // Handled first (capture phase) and only for the top window.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || stack.length === 0) return;
            const { el } = stack[stack.length - 1];
            const list = focusables(el);
            const target = trapTarget({ count: list.length, index: list.indexOf(document.activeElement), shift: e.shiftKey });
            if (target === null) return;
            e.preventDefault();
            if (target === 'container') focusContainer(el);
            else list[target].focus({ preventScroll: true });
        }, true);
    }

    return { open, close, isOpen };
})();

if (typeof module !== 'undefined') {
    module.exports = { trapTarget };
}
