// "Add from a link": paste a public product page, choose one of its photos, check the name and
// category, and save. The page is read (and the chosen photo downloaded) by the server function in
// /functions; this file is the person's side of it.
//
// The saved item is independent of the store: the chosen photo is downloaded by the server, handed
// back, compressed exactly like an upload and stored INSIDE the item (the same place uploads go), and
// the source address is kept as a plain text field. Nothing refers to the store's image afterwards.
// A retry re-uses the same item id, so a failed or repeated save can never create a second item.
//
// The first half is pure (no page access) so it can be tested on its own.

const MAX_STORED_IMAGE_CHARS = 900000;        // a saved photo (as text) must stay well under Firestore's 1 MB document limit
const MAX_PHOTO_TILES = 8;
const MIN_PHOTO_PIXELS = 150;                 // smaller than this is a swatch or tracking pixel, not a product photo

// What was pasted -> { ok, url } or { ok:false, reason }. Adds https:// to a bare "store.com/item".
function normalizeLinkInput(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return { ok: false, reason: 'EMPTY' };
    if (/\s/.test(t)) return { ok: false, reason: 'INVALID_URL' };
    let candidate = t;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) {
        if (!/^[^/?#\s]+\.[^/?#\s.]{2,}([/?#]|$)/.test(t)) return { ok: false, reason: 'INVALID_URL' };
        candidate = 'https://' + t;
    }
    let url;
    try { url = new URL(candidate); } catch (e) { return { ok: false, reason: 'INVALID_URL' }; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'UNSUPPORTED_SCHEME' };
    if (url.username || url.password) return { ok: false, reason: 'CREDENTIALS_IN_URL' };
    if (!url.hostname.includes('.')) return { ok: false, reason: 'INVALID_URL' };
    url.hash = '';
    return { ok: true, url: url.href };
}

// reason -> { text, fixLink }. fixLink: the address itself is the problem (nothing to retain or fall
// back on, just correct it). Otherwise the page couldn't give us a photo and "Upload a photo" is offered
// with the link kept.
const IMPORT_MESSAGES = {
    EMPTY:              { text: 'Paste the web address of a product page first.', fixLink: true },
    INVALID_URL:        { text: 'That doesn’t look like a web address. Paste the full address of a product page.', fixLink: true },
    UNSUPPORTED_SCHEME: { text: 'Only http and https web addresses can be imported.', fixLink: true },
    CREDENTIALS_IN_URL: { text: 'That address has a username or password in it. Remove that part and try again.', fixLink: true },
    BLOCKED_HOST:       { text: 'That address is on a private network or uses an unusual port, so it can’t be imported.', fixLink: true },
    BLOCKED_ADDRESS:    { text: 'That address is on a private network, so it can’t be imported.', fixLink: true },
    UNSAFE_REDIRECT:    { text: 'That link sends you somewhere that can’t be imported.', fixLink: true },
    NOT_A_PAGE:         { text: 'That address isn’t a web page we can read. Paste the address of the product page itself.', fixLink: true },
    DNS_FAILED:         { text: 'We couldn’t find that website. Check the address for typos.', fixLink: true },
    NOT_FOUND:          { text: 'That page wasn’t found. Check the address, or upload a photo instead.' },
    LOGIN_REQUIRED:     { text: 'That page needs you to sign in to the store first, so we can’t read it. You can upload a photo instead.' },
    BLOCKED:            { text: 'That store doesn’t allow automatic importing. You can upload a photo instead.' },
    NO_IMAGE:           { text: 'We couldn’t find a usable photo on that page. Some stores only show products after the page loads in a browser. You can upload a photo instead.' },
    TOO_LARGE:          { text: 'That photo or page is too large to import. Choose another photo, or upload your own.' },
    NOT_AN_IMAGE:       { text: 'That photo couldn’t be used. Choose another one, or upload your own.' },
    TOO_BIG_AFTER_SAVE: { text: 'That photo is too large to save. Choose another one, or upload your own.' },
    SAVE_FAILED:        { text: 'Check your connection and press Add to closet again. It won’t be added twice.' },
    TIMEOUT:            { text: 'That website took too long to answer. Try again, or upload a photo instead.' },
    NETWORK:            { text: 'We couldn’t connect to that website. Try again, or upload a photo instead.' },
    HTTP_ERROR:         { text: 'That website answered with an error. Try again later, or upload a photo instead.' },
    TOO_MANY_REDIRECTS: { text: 'That link redirects too many times. You can upload a photo instead.' },
    UNAUTHENTICATED:    { text: 'Sign in again to use Add from a link.' },
    RATE_LIMITED:       { text: 'That’s a lot of imports in a short time. Wait a minute, then try again.' },
    SERVICE_UNAVAILABLE:{ text: 'Add from a link isn’t available right now. You can upload a photo instead.' },
    INTERNAL:           { text: 'Something went wrong on our side. Try again, or upload a photo instead.' }
};
const importMessage = (reason) => IMPORT_MESSAGES[reason] || IMPORT_MESSAGES.INTERNAL;

// An error from the server call (or from the network) -> one of the reasons above.
function reasonFromError(err) {
    if (err && typeof err.reason === 'string' && IMPORT_MESSAGES[err.reason]) return err.reason;
    const detail = err && err.details && err.details.reason;
    if (typeof detail === 'string' && IMPORT_MESSAGES[detail]) return detail;
    const code = String((err && err.code) || '');
    if (/unauthenticated/.test(code)) return 'UNAUTHENTICATED';
    if (/resource-exhausted/.test(code)) return 'RATE_LIMITED';
    return 'SERVICE_UNAVAILABLE';          // not deployed (not-found), offline, timed out before it answered...
}

// The picture the server sent back (base64) -> a File the existing upload pipeline can compress.
function base64ToFile(base64, mimeType, name) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name || 'photo', { type: mimeType || 'image/jpeg' });
}

// ---- the window ------------------------------------------------------------------------------------

const LinkImport = (function () {
    let session = null;          // everything about the import in progress; null when the window is closed

    const $ = (id) => document.getElementById(id);

    // How the page talks to the server function. Replaceable (the tests do).
    async function callServer(payload) {
        const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');
        await waitForFirebase();
        const call = httpsCallable(getFunctions(window.Firebase.app, 'us-central1'), 'importProduct');
        const result = await call(payload);
        return result.data;
    }

    function setStatus(text, busy) {
        $('link-import-status').textContent = text || '';
        $('link-import-status').classList.toggle('is-busy', !!busy);
        $('link-import-modal').setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    function showError(reason, extra) {
        const box = $('link-import-error');
        box.textContent = (extra ? extra + ' ' : '') + importMessage(reason).text;
        box.classList.remove('hidden');
    }
    const clearError = () => $('link-import-error').classList.add('hidden');

    function newItemId() { return 'item_' + Date.now() + Math.random().toString(36).substr(2, 5); }

    function open() {
        session = {
            id: newItemId(), sourceUrl: '', title: '', siteName: '', brand: '', host: '', candidates: [], chosen: null,
            file: null, fileUrl: null, nameTouched: false, categoryTouched: false, busy: false, saving: false, saved: false
        };
        $('link-import-url').value = '';
        $('link-import-url').disabled = false;
        $('link-import-find-btn').disabled = false;
        $('link-import-save-btn').disabled = false;
        $('link-import-category').value = 'tops';           // nothing carries over from the last import
        $('link-import-occasion').value = 'casual';
        $('link-import-season').value = 'all-season';
        $('link-import-category').classList.remove('is-unconfirmed');
        $('link-import-details').classList.add('hidden');
        $('link-import-candidates').innerHTML = '';
        $('link-import-name').value = '';
        $('link-import-category-note').classList.add('hidden');
        $('link-import-dup').classList.add('hidden');
        clearError();
        setStatus('', false);
        $('link-import-modal').classList.remove('hidden');
        ModalDialogs.open($('link-import-modal'), { initialFocus: $('link-import-url'), returnTo: () => $('add-clothes-btn') });
    }

    function hasProgress() {
        return !!session && !session.saved && !$('link-import-details').classList.contains('hidden') &&
            (session.chosen !== null || session.nameTouched || session.categoryTouched);
    }

    function close() {
        if (!session) return;
        if (session.fileUrl) URL.revokeObjectURL(session.fileUrl);
        session = null;                                  // anything still on its way back is ignored (see `mine` below)
        $('link-import-modal').classList.add('hidden');
        ModalDialogs.close($('link-import-modal'));
    }

    // Close button, Cancel, Esc and a click outside: ask first only if there is something to lose.
    async function requestClose() {
        if (!session || session.saving) return;
        if (hasProgress()) {
            const discard = await confirmDialog({
                title: 'Discard this item?',
                message: 'It hasn’t been added to your closet yet.',
                confirmLabel: 'Discard',
                cancelLabel: 'Keep editing',
                danger: false
            });
            if (!discard || !session) return;
        }
        close();
    }

    // ---- looking at the page ----
    async function find() {
        if (!session || session.busy) return;
        const mine = session;
        const norm = normalizeLinkInput($('link-import-url').value);
        clearError();
        if (!norm.ok) { showError(norm.reason); $('link-import-url').focus(); return; }

        mine.busy = true;
        $('link-import-find-btn').disabled = true;
        setStatus('Looking at the page…', true);
        try {
            const result = await LinkImport.transport({ action: 'preview', url: norm.url });
            if (session !== mine) return;
            mine.sourceUrl = norm.url;
            applyPreview(result);
        } catch (err) {
            if (session !== mine) return;
            const reason = reasonFromError(err);
            setStatus('', false);
            showError(reason);
            if (!importMessage(reason).fixLink && reason !== 'UNAUTHENTICATED' && reason !== 'RATE_LIMITED') {
                mine.sourceUrl = norm.url;                  // the link is kept, and Upload a photo is offered
                showDetails();
                if (!mine.categoryTouched) {                // nothing to suggest a category from, so ask for one
                    $('link-import-category-note').textContent = 'Pick the category that fits.';
                    $('link-import-category-note').classList.remove('hidden');
                    $('link-import-category').classList.add('is-unconfirmed');
                }
            }
        } finally {
            if (session === mine) { mine.busy = false; $('link-import-find-btn').disabled = false; }
        }
    }

    function applyPreview(result) {
        const s = session;
        s.title = result.title || ''; s.siteName = result.siteName || ''; s.brand = result.brand || ''; s.host = result.host || '';
        s.candidates = (result.candidates || []).slice(0, MAX_PHOTO_TILES);
        s.chosen = s.file ? 'file' : null;
        s.fetched = null;                                  // a new list of photos: nothing fetched yet
        showDetails();
        renderTiles();

        // The name and category are SUGGESTIONS from the page; anything the person has already typed or picked is left alone.
        if (!s.nameTouched) $('link-import-name').value = nameFromProductTitle(s.title, { siteName: s.siteName, brand: s.brand, host: s.host });
        if (!s.categoryTouched) {
            const guess = guessCategory(s.title) || guessCategory(result.category || '');
            $('link-import-category').value = guess || 'tops';
            const note = $('link-import-category-note');
            note.textContent = guess ? `We guessed ${guess} from the product name. Please check it.` : 'Pick the category that fits.';
            note.classList.remove('hidden');
            $('link-import-category').classList.add('is-unconfirmed');
        }
        const dup = liveCloset.find(i => i.sourceUrl === s.sourceUrl);
        $('link-import-dup').textContent = dup ? `You already added this link as “${dup.name}”. You can still add it again.` : '';
        $('link-import-dup').classList.toggle('hidden', !dup);

        if (s.candidates.length === 0) {
            setStatus('', false);
            showError('NO_IMAGE');
        } else {
            setStatus(`Found ${s.candidates.length} ${s.candidates.length === 1 ? 'photo' : 'photos'}. Choose the one you want.`, false);
        }
    }

    function showDetails() {
        const s = session;
        $('link-import-details').classList.remove('hidden');
        let host = s.host;
        try { host = host || new URL(s.sourceUrl).hostname; } catch (e) { /* none */ }
        const link = $('link-import-source-link');
        link.textContent = host.replace(/^www\./, '');
        if (/^https?:\/\//i.test(s.sourceUrl)) link.href = s.sourceUrl;
        $('link-import-source').classList.toggle('hidden', !s.sourceUrl);
    }

    // ---- the photo choices ----
    function addTile(grid, value, label, imgSrc, isLocal) {
        const tile = document.createElement('label');
        tile.className = 'link-photo';
        const input = document.createElement('input');
        input.type = 'radio'; input.name = 'link-photo'; input.value = String(value);
        input.addEventListener('change', () => { session.chosen = value === 'file' ? 'file' : Number(value); markChosen(); });
        const box = document.createElement('span');
        box.className = 'link-photo-box';
        const img = document.createElement('img');
        img.alt = '';                                     // the visible label ("Photo 2") names the choice; the picture is its content
        img.decoding = 'async';
        if (!isLocal) img.referrerPolicy = 'no-referrer';      // no lazy loading: there are only a few, and each is checked for being a real photo when it loads
        img.addEventListener('load', () => {
            if (!isLocal && (img.naturalWidth < MIN_PHOTO_PIXELS || img.naturalHeight < MIN_PHOTO_PIXELS)) { tile.hidden = true; input.disabled = true; afterTilesChange(); }
        });
        img.addEventListener('error', () => {
            box.textContent = 'Preview not available';    // some stores don't allow other sites to show their pictures; it can still be chosen
            box.classList.add('is-missing');
        });
        img.src = imgSrc;
        box.appendChild(img);
        const text = document.createElement('span');
        text.className = 'link-photo-label';
        text.textContent = label;
        const check = document.createElement('span');
        check.className = 'link-photo-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        tile.append(input, box, text, check);
        grid.appendChild(tile);
        return tile;
    }

    function renderTiles() {
        const grid = $('link-import-candidates');
        grid.innerHTML = '';
        if (session.file) addTile(grid, 'file', 'Your photo', session.fileUrl, true);
        session.candidates.forEach((c, i) => addTile(grid, i, `Photo ${i + 1}`, c.url, false));
        markChosen();
    }

    function markChosen() {
        const want = session.chosen === null ? null : String(session.chosen);
        document.querySelectorAll('#link-import-candidates .link-photo').forEach(tile => {
            const input = tile.querySelector('input');
            input.checked = input.value === want;
            tile.classList.toggle('selected', input.checked);
        });
    }

    // Swatches and tracking pixels are hidden once they turn out to be tiny: renumber what is left,
    // keep the count in the status line true, and say so if nothing usable remains.
    function afterTilesChange() {
        if (!session) return;
        const usable = [...document.querySelectorAll('#link-import-candidates .link-photo')].filter(t => !t.hidden);
        let n = 0;
        usable.forEach(t => { if (t.querySelector('input').value !== 'file') t.querySelector('.link-photo-label').textContent = `Photo ${++n}`; });
        if (n === 0 && !session.file) { setStatus('', false); showError('NO_IMAGE'); }
        else if (/^Found /.test($('link-import-status').textContent)) setStatus(`Found ${n} ${n === 1 ? 'photo' : 'photos'}. Choose the one you want.`, false);
    }

    function chooseOwnPhoto(file) {
        if (!file || !/^image\//.test(file.type)) { showError('NOT_AN_IMAGE'); return; }
        clearError();
        if (session.fileUrl) URL.revokeObjectURL(session.fileUrl);
        session.file = file;
        session.fileUrl = URL.createObjectURL(file);
        session.chosen = 'file';
        showDetails();
        renderTiles();
        setStatus('Using your photo.', false);
    }

    // ---- saving ----
    async function save() {
        if (!session || session.busy) return;
        const mine = session;
        clearError();
        const name = $('link-import-name').value.trim();
        if (!name) { $('link-import-error').textContent = 'Give the item a name first.'; $('link-import-error').classList.remove('hidden'); $('link-import-name').focus(); return; }
        if (mine.chosen === null) {
            $('link-import-error').textContent = 'Choose a photo first, or upload your own.';
            $('link-import-error').classList.remove('hidden');
            const first = document.querySelector('#link-import-candidates input:not(:disabled)') || $('link-import-upload-btn');
            first.focus();
            return;
        }

        mine.busy = true; mine.saving = true;
        $('link-import-save-btn').disabled = true;
        setStatus('Saving the photo…', true);
        // Each step reports its own reason, so the message says what really went wrong.
        const step = async (reason, work) => { try { return await work(); } catch (err) { throw Object.assign(new Error(reason), { reason: reason === 'FETCH' ? reasonFromError(err) : reason }); } };
        try {
            // The chosen photo is downloaded once per choice: if saving then fails and is retried, the copy already
            // fetched is reused instead of downloading it again.
            const file = mine.chosen === 'file' ? mine.file
                : (mine.fetched && mine.fetched.index === mine.chosen) ? mine.fetched.file
                : await step('FETCH', async () => {
                    const sent = await LinkImport.transport({ action: 'image', url: mine.candidates[mine.chosen].url, pageUrl: mine.sourceUrl });
                    const fetched = base64ToFile(sent.base64, sent.contentType, 'photo');
                    mine.fetched = { index: mine.chosen, file: fetched };
                    return fetched;
                });
            const image = await step('NOT_AN_IMAGE', () => compressImage(file));       // the same compression every upload gets
            if (image.length > MAX_STORED_IMAGE_CHARS) throw Object.assign(new Error('too big'), { reason: 'TOO_BIG_AFTER_SAVE' });
            const color = await pickItemColor(name, image);
            // The id was made when the window opened, so saving again after a failure replaces this
            // same item instead of adding a second one.
            await step('SAVE_FAILED', () => Store.addClosetItem({
                id: mine.id, name,
                category: $('link-import-category').value,
                occasion: $('link-import-occasion').value,
                season: $('link-import-season').value,
                color, tagged: true,                                // the person has just seen and edited every field
                image,
                ...(mine.sourceUrl ? { sourceUrl: mine.sourceUrl } : {})
            }));
            mine.saved = true;
            mine.saving = false;
            if (session === mine) close();
            const announcer = $('app-announcer');
            if (announcer) announcer.textContent = `Added “${name}” to your closet.`;
        } catch (err) {
            if (session !== mine) return;
            setStatus('', false);
            showError(reasonFromError(err), 'The item wasn’t added.');
        } finally {
            mine.busy = false; mine.saving = false;
            $('link-import-save-btn').disabled = false;      // always: the window may already be closed, and is reused for the next import
        }
    }

    // ---- wiring (once, when the page loads) ----
    function init() {
        if (!$('link-import-modal')) return;
        $('link-import-form').addEventListener('submit', (e) => { e.preventDefault(); find(); });
        $('link-import-url').addEventListener('input', clearError);
        $('link-import-name').addEventListener('input', () => { if (session) session.nameTouched = true; });
        $('link-import-category').addEventListener('change', () => {
            if (session) session.categoryTouched = true;
            $('link-import-category-note').classList.add('hidden');
            $('link-import-category').classList.remove('is-unconfirmed');
        });
        $('link-import-upload-btn').addEventListener('click', () => $('link-import-file').click());
        $('link-import-file').addEventListener('change', (e) => { chooseOwnPhoto(e.target.files[0]); e.target.value = ''; });
        $('link-import-save-btn').addEventListener('click', save);
        $('link-import-cancel-btn').addEventListener('click', requestClose);
        $('link-import-close-btn').addEventListener('click', requestClose);
        closeOnBackdrop($('link-import-modal'), requestClose);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !$('link-import-modal').classList.contains('hidden') && !ModalDialogs.isOpen($('confirm-modal'))) requestClose();
        });
    }
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

    return { open, transport: async (payload) => { try { return await callServer(payload); } catch (e) { throw Object.assign(new Error('server call failed'), { reason: reasonFromError(e) }); } } };
})();

if (typeof module !== 'undefined') {
    module.exports = { normalizeLinkInput, importMessage, reasonFromError, IMPORT_MESSAGES, MAX_STORED_IMAGE_CHARS };
}
