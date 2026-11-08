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
let editBusy = false;             // a save or delete is in progress
let outfitBuilderSelectedIds = [];
let outfitBuilderBusy = false;

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
            const fullName = file.name.replace(/\.[^.]+$/, '');
            const color = await pickItemColor(fullName, image);
            await Store.addClosetItem({
                id: 'item_' + Date.now() + Math.random().toString(36).substr(2, 5),
                name: fullName.substring(0, 20) || 'Item',
                category: 'tops', occasion: 'casual', season: 'all-season',
                color, tagged: false,
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

    document.getElementById('save-item-btn').addEventListener('click', saveEditModal);
    document.getElementById('cancel-item-btn').addEventListener('click', requestCloseEditModal);
    document.getElementById('edit-close-btn').addEventListener('click', requestCloseEditModal);
    document.getElementById('delete-item-btn').addEventListener('click', deleteEditingItem);

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
        renderOutfitPickerGrid();
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
    grid.innerHTML = '';

    let filtered = activeCategory === 'all' ? liveCloset : liveCloset.filter(i => i.category === activeCategory);
    if (activeSeason !== 'all') filtered = filtered.filter(i => i.season === activeSeason || i.season === 'all-season');

    if (filtered.length === 0) {
        grid.innerHTML = '<p style="grid-column: span 3; text-align: center; color: #888; margin-top: 30px;">No items match this filter.</p>';
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'closet-card';
        card.innerHTML = `
            <img src="${itemPhoto(item)}" alt="">
            <div class="closet-card-info">
                <div class="closet-card-header-row">
                    <span class="color-dot" style="background:${item.color || '#ccc'}"></span>
                    <span class="closet-card-name">${escapeHtml(item.name)}</span>
                </div>
                <div class="tags-row">
                    <span class="badge">${item.occasion}</span>
                    <span class="badge">${item.season}</span>
                    ${!item.tagged ? '<span class="badge badge-untagged">needs tagging</span>' : ''}
                </div>
            </div>
        `;
        // The whole card opens the item's details (no gear icon needed).
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Open details for ${item.name}`);
        card.addEventListener('click', () => openEditModal(item.id));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditModal(item.id); }
        });
        grid.appendChild(card);
    });
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
    document.getElementById('modal-category').value = item.category;
    document.getElementById('modal-occasion').value = item.occasion;
    document.getElementById('modal-season').value = item.season;
    document.getElementById('modal-color').value = item.color || '#cccccc';

    document.getElementById('edit-modal').classList.remove('hidden');
    PhotoFrame.load(item);          // after the popup is visible: the frame needs a size
    editSnapshot = readEditForm();  // what "unchanged" means for this popup
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
        ...PhotoFrame.buildPatch()      // the framed picture, only if it was changed
    };

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

function renderOutfitPickerGrid() {
    const grid = document.getElementById('outfit-picker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    liveCloset.forEach(item => {
        const p = document.createElement('div');
        p.className = `picker-item ${outfitBuilderSelectedIds.includes(item.id) ? 'selected' : ''}`;
        p.innerHTML = `<img src="${itemPhoto(item)}" alt="">`;
        p.addEventListener('click', () => {
            if (outfitBuilderSelectedIds.includes(item.id)) {
                outfitBuilderSelectedIds = outfitBuilderSelectedIds.filter(id => id !== item.id);
            } else {
                outfitBuilderSelectedIds.push(item.id);
            }
            setBuilderMessage('');
            renderOutfitPickerGrid();
        });
        grid.appendChild(p);
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
    renderOutfitPickerGrid();
    setBuilderMessage(`Saved “${name}”.`, 'success');
    outfitBuilderBusy = false;

    // If the save fails, give the user their pieces and name back.
    saving.catch(err => {
        console.error('Saving an outfit failed', err);
        if (!nameInput.value && outfitBuilderSelectedIds.length === 0) {
            nameInput.value = rawName;
            outfitBuilderSelectedIds = itemIds;
            renderOutfitPickerGrid();
        }
        setBuilderMessage('Couldn’t save the outfit. Please try again.', 'error');
    });
}

function renderSavedOutfitsList() {
    const list = document.getElementById('saved-outfits-list');
    if (!list) return;
    list.innerHTML = '';

    if (liveSavedOutfits.length === 0) {
        list.innerHTML = '<p style="color:#888; font-size:0.85rem;">No saved outfits yet — select items above and name them to save one.</p>';
        return;
    }

    liveSavedOutfits.forEach(outfit => {
        const card = document.createElement('div');
        card.className = 'saved-outfit-card';
        const thumbs = sortHeadToToe(outfit.itemIds
            .map(id => liveCloset.find(i => i.id === id))
            .filter(Boolean))
            .map(i => `<img src="${itemPhoto(i)}" alt="">`)
            .join('');
        card.innerHTML = `
            <div class="saved-outfit-thumbs">${thumbs}</div>
            <div class="saved-outfit-name">${escapeHtml(outfit.name)}</div>
            <button class="edit-icon-btn" type="button" aria-label="Delete saved outfit ${escapeHtml(outfit.name)}" data-outfit-id="${escapeHtml(outfit.id)}">🗑️</button>
        `;
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
