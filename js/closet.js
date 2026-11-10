const CATEGORIES = ['tops', 'bottoms', 'outerwear', 'shoes', 'dresses', 'accessories'];

// The picture to show for an item: the square the owner framed (js/photo-frame.js)
// if there is one, otherwise the whole photo. The edit popup always uses the
// original photo, so the framing can be changed any time.
function itemPhoto(item) {
    return item.thumb || item.image;
}

// Pieces of an outfit are always shown head to toe: a top above a bottom,
// shoes last. Only the display is sorted; the saved order never changes, and
// pieces of the same kind stay in the order they were added.
const HEAD_TO_TOE = ['outerwear', 'tops', 'dresses', 'bottoms', 'shoes', 'accessories'];
function sortHeadToToe(items) {
    const rank = (item) => {
        const i = HEAD_TO_TOE.indexOf(item.category);
        return i === -1 ? HEAD_TO_TOE.length : i;
    };
    return items.map((item, index) => ({ item, index }))
        .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
        .map(entry => entry.item);
}

// Text from the user (item and outfit names) is escaped wherever it goes into HTML.
function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let activeCategory = 'all';
let activeSeason = 'all';
let currentEditingItemId = null;
let editFromTagQueue = false;
let editSnapshot = null;          // the edit form as it was when opened, to tell if anything changed
let lastTaggedCategory = null;    // the category confirmed on the last item tagged this session (suggested for the next one, never saved by itself)
let editBusy = false;             // a save or delete is in progress
let outfitBuilderSelectedIds = [];
let outfitBuilderBusy = false;
let buildMode = false;            // "Build an outfit": tapping a card selects it instead of opening it

// Kept in sync by Firestore's live listeners (see initLiveData below) so
// render functions can stay synchronous and read from here instead of
// re-fetching after every mutation.
let liveCloset = [];
let liveSavedOutfits = [];

function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const maxDim = 500;
                let { width, height } = img;
                if (width > height && width > maxDim) {
                    height = Math.round(height * maxDim / width);
                    width = maxDim;
                } else if (height > maxDim) {
                    width = Math.round(width * maxDim / height);
                    height = maxDim;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.6));
            };
            img.onerror = () => reject(new Error('Could not read image'));
            img.src = ev.target.result;
        };
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
    });
}

async function addImageFiles(files) {
    for (const file of files) {
        try {
            const image = await compressImage(file);
            // The item's name comes from the file's name: extension removed, underscores turned into
            // spaces, Each Word Capitalized (js/item-name.js), and kept IN FULL. How much of it a card
            // shows is the card's business (it wraps and clamps, with a "Show full name" link); the
            // stored name is never shortened. 'Item' only when the file name leaves nothing.
            const fullName = nameFromFilename(file.name);
            const color = await pickItemColor(fullName, image);
            // A guess from the name (e.g. "...skirt" -> bottoms), or the old default of tops when
            // the name gives nothing to go on. Either way the item stays "needs tagging": the
            // category counts as confirmed only when the owner saves it in the editor.
            const guessed = guessCategory(fullName);
            await Store.addClosetItem({
                id: 'item_' + Date.now() + Math.random().toString(36).substr(2, 5),
                name: fullName,
                category: guessed || 'tops', occasion: 'casual', season: 'all-season',
                color, tagged: false,
                ...(guessed ? { categoryGuess: 'name' } : {}),
                image
            });
        } catch (err) {
            console.error('Failed to add item', err);
        }
    }
}

// Closes a popup when the dark backdrop itself is clicked. Requires the press
// to start AND end on the backdrop, so selecting text inside the popup and
// releasing the mouse outside it doesn't close it by accident.
function closeOnBackdrop(modalEl, closeFn) {
    let pressedOnBackdrop = false;
    modalEl.addEventListener('mousedown', (e) => { pressedOnBackdrop = e.target === modalEl; });
    modalEl.addEventListener('click', (e) => {
        if (pressedOnBackdrop && e.target === modalEl) closeFn();
        pressedOnBackdrop = false;
    });
}

// --- In-page webcam capture (laptops/desktops) ---

let webcamStream = null;

async function openWebcam() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const error = document.getElementById('camera-error');
    const captureBtn = document.getElementById('camera-capture-btn');
    error.classList.add('hidden');
    captureBtn.disabled = true;
    modal.classList.remove('hidden');
    // Cancel has focus first (Capture is off until the camera is ready); the page behind is blocked,
    // and closing returns focus to "+ Add clothes" (the menu item that opened this is gone by then).
    ModalDialogs.open(modal, {
        initialFocus: document.getElementById('camera-cancel-btn'),
        returnTo: () => document.getElementById('add-clothes-btn')
    });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showCameraError('Your browser doesn\'t support camera access here.');
        return;
    }
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 } },
            audio: false
        });
        video.srcObject = webcamStream;
        captureBtn.disabled = false;
    } catch (err) {
        const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        const missing = err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError');
        showCameraError(denied
            ? 'Camera access was blocked. Allow the camera for this site in your browser\'s address bar, then try again.'
            : missing ? 'No camera was found on this device.'
            : 'Couldn\'t start the camera. Make sure no other app is using it.');
    }
}

function showCameraError(message) {
    const error = document.getElementById('camera-error');
    error.textContent = message;
    error.classList.remove('hidden');
}

function closeWebcam() {
    if (webcamStream) {
        webcamStream.getTracks().forEach(t => t.stop());
        webcamStream = null;
    }
    document.getElementById('camera-video').srcObject = null;
    document.getElementById('camera-modal').classList.add('hidden');
    ModalDialogs.close(document.getElementById('camera-modal'));
}

function captureWebcamPhoto() {
    const video = document.getElementById('camera-video');
    if (!video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
        closeWebcam();
        if (blob) await addImageFiles([new File([blob], 'New item.jpg', { type: 'image/jpeg' })]);
    }, 'image/jpeg', 0.9);
}

document.addEventListener('DOMContentLoaded', () => {
    const itemUpload = document.getElementById('item-upload');
    const categoryTabs = document.getElementById('category-tabs');
    const seasonFilter = document.getElementById('season-filter');
    const tagQueueBtn = document.getElementById('tag-queue-btn');

    categoryTabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            categoryTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeCategory = e.target.dataset.category;
            renderCloset();
        }
    });

    seasonFilter.addEventListener('change', (e) => {
        activeSeason = e.target.value;
        renderCloset();
    });

    // "+ Add clothes" (file picker) and phone camera (`capture` input) share
    // one handler. On touch devices "Take photo" opens the native camera;
    // on laptops/desktops it opens an in-page webcam preview instead.
    const itemCamera = document.getElementById('item-camera');
    [itemUpload, itemCamera].forEach(input => input.addEventListener('change', async (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        await addImageFiles(files);
    }));

    // "+ Add clothes" dropdown: Upload a photo / Take a photo.
    const addMenu = document.getElementById('add-menu');
    const addBtn = document.getElementById('add-clothes-btn');
    const addList = document.getElementById('add-menu-list');
    const setAddMenuOpen = (open) => {
        addList.classList.toggle('hidden', !open);
        addBtn.setAttribute('aria-expanded', String(open));
    };
    addBtn.addEventListener('click', () => setAddMenuOpen(addList.classList.contains('hidden')));
    document.addEventListener('click', (e) => { if (!addMenu.contains(e.target)) setAddMenuOpen(false); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !addList.classList.contains('hidden')) { setAddMenuOpen(false); addBtn.focus(); }
    });
    document.getElementById('menu-upload-btn').addEventListener('click', () => {
        setAddMenuOpen(false);
        itemUpload.click();
    });
    document.getElementById('menu-camera-btn').addEventListener('click', () => {
        setAddMenuOpen(false);
        if (window.matchMedia('(pointer: coarse)').matches) itemCamera.click();
        else openWebcam();
    });
    // "Add from a link" only appears once the server function behind it is set up (js/features.js).
    const linkBtn = document.getElementById('menu-link-btn');
    if (featureEnabled('linkImport')) linkBtn.classList.remove('hidden');
    linkBtn.addEventListener('click', () => { setAddMenuOpen(false); LinkImport.open(); });
    document.getElementById('camera-capture-btn').addEventListener('click', captureWebcamPhoto);
    document.getElementById('camera-cancel-btn').addEventListener('click', closeWebcam);

    tagQueueBtn.addEventListener('click', () => {
        document.querySelector('.nav-btn[data-tab="closet-view"]').click();
        openNextUntaggedItem();
    });

    // Click the dark area around a popup (or press Esc) to close it. The edit popup asks
    // first if there are unsaved changes; the camera has nothing to lose.
    closeOnBackdrop(document.getElementById('edit-modal'), requestCloseEditModal);
    closeOnBackdrop(document.getElementById('camera-modal'), closeWebcam);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!document.getElementById('edit-modal').classList.contains('hidden')) requestCloseEditModal();
        if (!document.getElementById('camera-modal').classList.contains('hidden')) closeWebcam();
    });

    document.getElementById('modal-category').addEventListener('change', () => showCategoryNote({ text: '' }));
    document.getElementById('save-item-btn').addEventListener('click', saveEditModal);
    document.getElementById('cancel-item-btn').addEventListener('click', requestCloseEditModal);
    document.getElementById('edit-close-btn').addEventListener('click', requestCloseEditModal);
    document.getElementById('delete-item-btn').addEventListener('click', deleteEditingItem);

    watchCardGrid();
    document.querySelectorAll('.build-trigger').forEach(btn => btn.addEventListener('click', () => setBuildMode(true)));
    document.getElementById('build-done-btn').addEventListener('click', requestExitBuildMode);
    document.getElementById('save-outfit-btn').addEventListener('click', saveOutfitFromBuilder);
    // Typing a name clears an old complaint about it.
    document.getElementById('outfit-name-input').addEventListener('input', () => setBuilderMessage(''));
    document.getElementById('outfit-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveOutfitFromBuilder(); }
    });

    window.waitForAuth().then(initClosetLiveData);
});

function initClosetLiveData() {
    Store.onClosetChange((closet) => {
        liveCloset = closet;
        renderCloset();
        renderBuildBar();
        updateTagQueueUI();
    });
    Store.onSavedOutfitsChange((outfits) => {
        liveSavedOutfits = outfits;
        renderSavedOutfitsList();
    });
}

function renderCloset() {
    const grid = document.getElementById('full-closet-grid');
    if (!grid) return;
    // The cards are rebuilt on every change; keep keyboard focus on the same piece's card.
    const focused = document.activeElement;
    const refocusItem = (grid.contains(focused) && focused.classList && focused.classList.contains('closet-card')) ? focused.dataset.itemId : null;
    grid.innerHTML = '';
    queueMicrotask(() => {
        if (!refocusItem || document.activeElement !== document.body) return;       // only if focus was dropped by the redraw
        const again = cardForItem(refocusItem);
        if (again) again.focus({ preventScroll: true });
    });

    let filtered = activeCategory === 'all' ? liveCloset : liveCloset.filter(i => i.category === activeCategory);
    if (activeSeason !== 'all') filtered = filtered.filter(i => i.season === activeSeason || i.season === 'all-season');

    if (filtered.length === 0) {
        grid.innerHTML = '<p style="grid-column: span 3; text-align: center; color: #888; margin-top: 30px;">No items match this filter.</p>';
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'closet-card';
        card.title = item.name;                      // the full name, when a long one is shortened
        card.dataset.itemId = item.id;
        card.innerHTML = `
            <img src="${itemPhoto(item)}" alt="">
            <div class="closet-card-info">
                <div class="closet-card-header-row">
                    <span class="color-dot" style="background:${item.color || '#ccc'}"></span>
                    <span class="closet-card-name">${escapeHtml(item.name)}</span>
                </div>
                <button type="button" class="name-more hidden" tabindex="-1" aria-hidden="true">Show full name</button>
                <div class="tags-row">
                    ${buildMode ? `<span class="badge badge-category">${escapeHtml(item.category)}</span>` : ''}
                    <span class="badge">${item.occasion}</span>
                    <span class="badge">${item.season}</span>
                    ${!item.tagged && item.categoryGuess ? `<span class="badge badge-guess" title="Guessed from the name. Open the item and save it to confirm.">guessed: ${escapeHtml(item.category)}</span>` : ''}
                    ${!item.tagged ? '<span class="badge badge-untagged">needs tagging</span>' : ''}
                </div>
            </div>
        `;
        card.tabIndex = 0;
        // "Show full name": reads a long name in place. It only ever appears for a name that is
        // actually cut off. It is a sighted-user aid (hidden from screen readers and the Tab
        // order) because the card's own label already gives them the full name. Pressing it never
        // opens the editor or toggles the selection.
        const more = card.querySelector('.name-more');
        more.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = card.classList.toggle('name-expanded');
            more.textContent = open ? 'Show less' : 'Show full name';
        });
        if (buildMode) {
            // Building an outfit: the card is a checkbox. Tapping, Space or Enter selects it.
            card.classList.add('selectable');
            card.insertAdjacentHTML('afterbegin', '<span class="select-mark" aria-hidden="true">✓</span>');
            card.setAttribute('role', 'checkbox');
            card.setAttribute('aria-label', `${item.name}, ${item.category}, ${item.occasion}`);
            setCardSelected(card, outfitBuilderSelectedIds.includes(item.id));
            card.addEventListener('click', () => toggleBuildSelection(item.id, card));
            card.addEventListener('keydown', (e) => {
                if (e.target !== card) return;     // a key on the card's inner "Show full name" button isn't a selection
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBuildSelection(item.id, card); }
            });
        } else {
            // Normally the whole card opens the item's details (no gear icon needed).
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', `Open details for ${item.name}`);
            card.addEventListener('click', () => openEditModal(item.id));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditModal(item.id); }
            });
        }
        grid.appendChild(card);
    });
    updateNameOverflow();
}

// Shows "Show full name" on exactly those cards whose name is cut off at two lines
// (or already expanded, so it can be closed). The sizes only exist while the Closet tab
// is showing, so this also re-runs whenever the card grid changes size or appears
// (window resized, phone turned, tab opened): see watchCardGrid.
function updateNameOverflow() {
    document.querySelectorAll('#full-closet-grid .closet-card').forEach(card => {
        const name = card.querySelector('.closet-card-name');
        const more = card.querySelector('.name-more');
        if (!name || !more) return;
        const cutOff = name.scrollHeight > name.clientHeight + 1;
        more.classList.toggle('hidden', !(cutOff || card.classList.contains('name-expanded')));
    });
}
function watchCardGrid() {
    const grid = document.getElementById('full-closet-grid');
    if (!grid) return;
    if (window.ResizeObserver) {
        new ResizeObserver(() => updateNameOverflow()).observe(grid);
    } else {
        let timer = null;
        window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(updateNameOverflow, 120); });
    }
}

function updateTagQueueUI() {
    const btn = document.getElementById('tag-queue-btn');
    if (!btn) return;
    const count = liveCloset.filter(i => !i.tagged).length;
    btn.textContent = `${count} to tag`;
    btn.classList.toggle('hidden', count === 0);
}

function openNextUntaggedItem() {
    const next = liveCloset.find(i => !i.tagged);
    if (next) {
        editFromTagQueue = true;
        openEditModal(next.id);
    }
}

function openEditModal(itemId) {
    const item = liveCloset.find(i => i.id === itemId);
    if (!item) return;
    currentEditingItemId = itemId;

    document.getElementById('modal-name').value = item.name;
    document.getElementById('modal-img').alt = `Photo of ${item.name}`;      // not a generic "preview": say which piece it is
    // Where an item added from a link came from (only ever a plain http(s) address).
    const sourceLink = document.getElementById('modal-source-link');
    const hasSource = typeof item.sourceUrl === 'string' && /^https?:\/\//i.test(item.sourceUrl);
    document.getElementById('modal-source').classList.toggle('hidden', !hasSource);
    if (hasSource) {
        sourceLink.href = item.sourceUrl;
        try { sourceLink.textContent = new URL(item.sourceUrl).hostname.replace(/^www\./, ''); } catch (e) { sourceLink.textContent = 'the store'; }
    }
    // For an item that hasn't been tagged yet the Category field starts as a SUGGESTION (a guess
    // from the name, or the category just confirmed on the previous item), and says so. Nothing is
    // saved until the owner presses Save; Cancel leaves the item exactly as it was.
    const suggestion = categorySuggestionFor(item, lastTaggedCategory);
    document.getElementById('modal-category').value = suggestion.category;
    showCategoryNote(suggestion);
    document.getElementById('modal-occasion').value = item.occasion;
    document.getElementById('modal-season').value = item.season;
    document.getElementById('modal-color').value = item.color || '#cccccc';

    document.getElementById('edit-modal').classList.remove('hidden');
    PhotoFrame.load(item);          // after the popup is visible: the frame needs a size
    editSnapshot = readEditForm();  // what "unchanged" means for this popup
    // Focus moves into the window (the name field; on a phone just the first control, so the
    // on-screen keyboard doesn't pop up), the page behind is blocked, and closing returns focus to
    // the card that opened it, or to that piece's new card if the closet was redrawn meanwhile.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    ModalDialogs.open(document.getElementById('edit-modal'), {
        initialFocus: coarse ? null : document.getElementById('modal-name'),
        returnTo: () => cardForItem(itemId) || document.querySelector('.nav-btn[data-tab="closet-view"]')
    });
    // Focus lands with the caret after the name, not with the whole name selected, so the next key
    // typed can't silently replace it.
    const nameField = document.getElementById('modal-name');
    if (document.activeElement === nameField) nameField.setSelectionRange(nameField.value.length, nameField.value.length);
}

// The line under the Category field that says it's only a suggestion (and an amber outline on
// the field itself). Cleared as soon as the owner picks a category.
function showCategoryNote(suggestion) {
    const note = document.getElementById('modal-category-note');
    const select = document.getElementById('modal-category');
    note.textContent = suggestion.text || '';
    note.classList.toggle('hidden', !suggestion.text);
    select.classList.toggle('is-unconfirmed', !!suggestion.text);
}

// The values currently in the edit form.
function readEditForm() {
    return {
        name: document.getElementById('modal-name').value,
        category: document.getElementById('modal-category').value,
        occasion: document.getElementById('modal-occasion').value,
        season: document.getElementById('modal-season').value,
        color: document.getElementById('modal-color').value
    };
}

// Anything typed, picked, or reframed since the popup opened?
function isEditDirty() {
    if (!editSnapshot) return false;
    const now = readEditForm();
    return Object.keys(now).some(k => now[k] !== editSnapshot[k]) || PhotoFrame.isChanged();
}

// Close button, Cancel, Esc and a click outside all come here: nothing changed closes
// at once; unsaved changes ask before they're thrown away.
async function requestCloseEditModal() {
    if (document.getElementById('edit-modal').classList.contains('hidden')) return;
    if (isEditDirty()) {
        const discard = await confirmDialog({
            title: 'Discard your changes?',
            message: 'You changed this item but haven’t saved. If you close now, those changes are lost.',
            confirmLabel: 'Discard changes',
            cancelLabel: 'Keep editing'
        });
        if (!discard) return;
    }
    closeEditModal();
}

function closeEditModal() {
    PhotoFrame.unload();
    document.getElementById('edit-modal').classList.add('hidden');
    ModalDialogs.close(document.getElementById('edit-modal'));      // focus goes back to where it was
    currentEditingItemId = null;
    editFromTagQueue = false;
    editSnapshot = null;
}

async function saveEditModal() {
    if (!currentEditingItemId) return;
    const existing = liveCloset.find(i => i.id === currentEditingItemId);
    if (!existing) return;

    const patch = {
        name: document.getElementById('modal-name').value.trim() || existing.name,
        category: document.getElementById('modal-category').value,
        occasion: document.getElementById('modal-occasion').value,
        season: document.getElementById('modal-season').value,
        color: document.getElementById('modal-color').value,
        tagged: true,
        ...(existing.categoryGuess ? { categoryGuess: null } : {}),   // saving confirms it: no longer a guess
        ...PhotoFrame.buildPatch()      // the framed picture, only if it was changed
    };
    // Tagging an item remembers its category as the suggestion for the next untagged one.
    if (!existing.tagged) lastTaggedCategory = patch.category;

    const id = currentEditingItemId;
    const wasTagQueue = editFromTagQueue;
    closeEditModal();
    await Store.updateClosetItem(id, patch);
    if (wasTagQueue) openNextUntaggedItem();
}

// Deleting a piece also takes it out of every planned day and saved outfit, so the
// confirmation spells that out first. Cancel changes nothing, and the edit popup
// (with anything typed in it) stays open.
async function deleteEditingItem() {
    if (!currentEditingItemId) return;
    const id = currentEditingItemId;
    const item = liveCloset.find(i => i.id === id);
    if (!item) return;

    const impact = itemDeletionImpact(id, plannerOutfits, liveSavedOutfits);
    const text = describeItemDeletion(item.name, impact);
    const sure = await confirmDialog({
        title: `Delete “${item.name}”?`,
        message: text.message,
        details: text.details,
        note: 'This can’t be undone.',
        confirmLabel: 'Delete item'
    });
    if (!sure) return;
    if (currentEditingItemId !== id) return;      // the popup was closed in the meantime

    closeEditModal();
    try {
        await Store.deleteClosetItem(id);
        await Store.removeItemFromSchedule(id);
        const outfits = await Store.getSavedOutfits();
        for (const outfit of outfits) {
            if (outfit.itemIds.includes(id)) {
                const itemIds = outfit.itemIds.filter(x => x !== id);
                if (itemIds.length === 0) await Store.deleteSavedOutfit(outfit.id);
                else await Store.addSavedOutfit({ ...outfit, itemIds });
            }
        }
    } catch (err) {
        console.error('Deleting an item failed', err);
        await confirmDialog({
            title: 'Couldn’t finish deleting',
            message: `Something went wrong while deleting “${item.name}”. Check your connection and try again.`,
            confirmLabel: 'OK',
            cancelLabel: '',
            danger: false
        });
    }
}

// --- Saved Outfits builder (Closet tab) ---

// "Build an outfit" mode. The closet cards themselves become the picker: each shows
// its name and a checkbox, tapping one selects it (it doesn't open the editor), and a
// bar above them shows how many are selected, which ones (by name), and holds the
// name field and Save button. Category/season filters still work, so a big closet can
// be searched while the selection is kept.

function setCardSelected(card, selected) {
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-checked', String(selected));
}

function cardForItem(itemId) {
    return [...document.querySelectorAll('#full-closet-grid .closet-card')].find(c => c.dataset.itemId === itemId);
}

function setBuildMode(on) {
    if (buildMode === on) return;
    buildMode = on;
    const bar = document.getElementById('build-bar');
    bar.classList.toggle('hidden', !on);
    document.getElementById('closet-view').classList.toggle('is-building', on);
    document.querySelectorAll('.build-trigger').forEach(b => {
        b.classList.toggle('hidden', on);
        b.setAttribute('aria-expanded', String(on));
    });
    if (!on) {
        outfitBuilderSelectedIds = [];
        document.getElementById('outfit-name-input').value = '';
        setBuilderMessage('');
    }
    renderCloset();
    renderBuildBar();
    if (on) {
        bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });   // visible even if started from the lower button
        bar.focus({ preventScroll: true });                              // so a screen reader announces the builder
    }
}

// Done: leaves the mode, asking first if there's an unsaved outfit in progress.
async function requestExitBuildMode() {
    const n = outfitBuilderSelectedIds.length;
    const nameTyped = document.getElementById('outfit-name-input').value.trim() !== '';
    if (n > 0 || nameTyped) {
        const leave = await confirmDialog({
            title: 'Stop building this outfit?',
            message: n > 0
                ? `Your ${pluralize(n, 'selected piece')} won’t be saved as an outfit.`
                : 'The name you typed won’t be saved.',
            confirmLabel: 'Discard outfit',
            cancelLabel: 'Keep building'
        });
        if (!leave) return;
    }
    setBuildMode(false);
    const trigger = [...document.querySelectorAll('.build-trigger')].find(b => b.offsetParent !== null);
    if (trigger) trigger.focus({ preventScroll: true });
}

function toggleBuildSelection(itemId, card) {
    const was = outfitBuilderSelectedIds.includes(itemId);
    outfitBuilderSelectedIds = was
        ? outfitBuilderSelectedIds.filter(id => id !== itemId)
        : [...outfitBuilderSelectedIds, itemId];
    setCardSelected(card, !was);        // updated in place, so keyboard focus stays on this card
    setBuilderMessage('');
    renderBuildBar();
}

// The bar's count and the list of selected pieces (by name, head to toe).
function renderBuildBar() {
    if (!buildMode) return;
    // A piece deleted elsewhere drops out of the selection.
    const known = new Set(liveCloset.map(i => i.id));
    outfitBuilderSelectedIds = outfitBuilderSelectedIds.filter(id => known.has(id));

    const n = outfitBuilderSelectedIds.length;
    document.getElementById('build-count').textContent = `${pluralize(n, 'piece')} selected`;
    document.getElementById('build-bar').classList.toggle('has-selection', n > 0);   // phones then hide the long hint

    const box = document.getElementById('build-selected');
    box.innerHTML = '';
    if (n === 0) {
        box.innerHTML = '<span class="build-empty">Nothing selected yet.</span>';
        return;
    }
    const selectedItems = sortHeadToToe(outfitBuilderSelectedIds.map(id => liveCloset.find(i => i.id === id)).filter(Boolean));
    selectedItems.forEach(item => {
        // Each chip says what kind of piece it is; if two selected pieces share a name
        // (and a kind), it adds the occasion and season so they can be told apart.
        const twin = selectedItems.some(o => o !== item && o.name === item.name && o.category === item.category);
        const meta = [item.category, ...(twin ? [item.occasion, item.season] : [])].filter(Boolean).join(' · ');
        const chip = document.createElement('span');
        chip.className = 'build-chip';
        chip.title = `${item.name} (${meta})`;
        const img = document.createElement('img');
        img.src = itemPhoto(item);
        img.alt = '';
        const label = document.createElement('span');
        label.className = 'build-chip-text';
        const name = document.createElement('span');
        name.className = 'build-chip-name';
        name.textContent = item.name;
        const kind = document.createElement('span');
        kind.className = 'build-chip-meta';
        kind.textContent = meta;
        label.append(name, kind);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'build-chip-remove';
        remove.setAttribute('aria-label', `Remove ${item.name} from this outfit`);
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            outfitBuilderSelectedIds = outfitBuilderSelectedIds.filter(id => id !== item.id);
            const card = cardForItem(item.id);
            if (card) setCardSelected(card, false);
            setBuilderMessage('');
            renderBuildBar();
            document.getElementById('build-bar').focus({ preventScroll: true });   // the chip that had focus is gone
        });
        chip.append(img, label, remove);
        box.appendChild(chip);
    });
}

// The line under the pieces that says why Save Outfit didn't save, or that it did.
// kind: 'error' | 'success' | '' (empty text hides it).
function setBuilderMessage(text, kind = '') {
    const el = document.getElementById('outfit-builder-message');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-success', kind === 'success');
    if (kind !== 'error') document.getElementById('outfit-name-input').removeAttribute('aria-invalid');
}

// What's wrong with the outfit being built, or '' if it's ready to save. Pieces are
// checked first, then the name.
function outfitBuilderProblem(name, pieceCount) {
    if (pieceCount === 0) return 'Pick at least one piece.';
    if (!name) return 'Give the outfit a name first.';
    return '';
}

async function saveOutfitFromBuilder() {
    if (outfitBuilderBusy) return;
    const nameInput = document.getElementById('outfit-name-input');
    const name = nameInput.value.trim();

    // Nothing is cleared when something is missing: the pieces and name stay as they were.
    const problem = outfitBuilderProblem(name, outfitBuilderSelectedIds.length);
    if (problem) {
        setBuilderMessage(problem, 'error');
        if (!name && outfitBuilderSelectedIds.length > 0) {
            nameInput.setAttribute('aria-invalid', 'true');
            nameInput.focus();
        }
        return;
    }

    outfitBuilderBusy = true;
    const itemIds = [...outfitBuilderSelectedIds];
    const rawName = nameInput.value;
    const saving = Store.addSavedOutfit({ id: 'outfit_' + Date.now(), name, itemIds });
    nameInput.value = '';
    outfitBuilderSelectedIds = [];
    renderCloset();
    renderBuildBar();
    setBuilderMessage(`Saved “${name}”. Pick more pieces to build another outfit, or press Done.`, 'success');
    outfitBuilderBusy = false;

    // If the save fails, give the user their pieces and name back.
    saving.catch(err => {
        console.error('Saving an outfit failed', err);
        if (!nameInput.value && outfitBuilderSelectedIds.length === 0) {
            setBuildMode(true);                  // (in case they pressed Done in the meantime)
            nameInput.value = rawName;
            outfitBuilderSelectedIds = itemIds;
            renderCloset();
            renderBuildBar();
        }
        setBuilderMessage('Couldn’t save the outfit. Please try again.', 'error');
    });
}

function renderSavedOutfitsList() {
    const list = document.getElementById('saved-outfits-list');
    if (!list) return;
    list.innerHTML = '';

    if (liveSavedOutfits.length === 0) {
        list.innerHTML = '<p style="color:#888; font-size:0.85rem;">No saved outfits yet. Press “Build an outfit”, tap the pieces you want, name the outfit and save it.</p>';
        return;
    }

    liveSavedOutfits.forEach(outfit => {
        const card = document.createElement('div');
        card.className = 'saved-outfit-card';
        const pieces = sortHeadToToe(outfit.itemIds
            .map(id => liveCloset.find(i => i.id === id))
            .filter(Boolean));
        const thumbs = pieces.map(i => `<img src="${itemPhoto(i)}" alt="">`).join('');
        // The thumbnails are the only place the pieces show, so they are described once, in words
        // ("Pieces: Blue top, Black skirt"), and the pictures themselves stay silent.
        card.innerHTML = `
            <div class="saved-outfit-thumbs" aria-hidden="true">${thumbs}</div>
            <div class="saved-outfit-name">${escapeHtml(outfit.name)}</div>
            <span class="sr-only saved-outfit-pieces"></span>
            <button class="edit-icon-btn" type="button" aria-label="Delete saved outfit ${escapeHtml(outfit.name)}" data-outfit-id="${escapeHtml(outfit.id)}">🗑️</button>
        `;
        card.querySelector('.saved-outfit-pieces').textContent = outfitPiecesSummary(pieces.map(i => i.name));
        card.querySelector('button').addEventListener('click', async () => {
            const sure = await confirmDialog({
                title: `Delete “${outfit.name}”?`,
                message: 'This saved outfit will be deleted. Your clothing pieces and any days you already planned with it are not affected.',
                confirmLabel: 'Delete outfit'
            });
            if (!sure) return;
            try {
                await Store.deleteSavedOutfit(outfit.id);
            } catch (err) {
                console.error('Deleting a saved outfit failed', err);
                await confirmDialog({ title: 'Couldn’t delete the outfit', message: 'Something went wrong. Please try again.', confirmLabel: 'OK', cancelLabel: '', danger: false });
            }
        });
        list.appendChild(card);
    });
}
