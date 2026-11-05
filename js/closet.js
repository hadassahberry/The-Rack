const CATEGORIES = ['tops', 'bottoms', 'outerwear', 'shoes', 'dresses', 'accessories'];

let activeCategory = 'all';
let activeSeason = 'all';
let currentEditingItemId = null;
let editFromTagQueue = false;
let outfitBuilderSelectedIds = [];

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

    // Click the dark area around a popup (or press Esc) to close it without saving.
    closeOnBackdrop(document.getElementById('edit-modal'), closeEditModal);
    closeOnBackdrop(document.getElementById('camera-modal'), closeWebcam);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!document.getElementById('edit-modal').classList.contains('hidden')) closeEditModal();
        if (!document.getElementById('camera-modal').classList.contains('hidden')) closeWebcam();
    });

    document.getElementById('save-item-btn').addEventListener('click', saveEditModal);
    document.getElementById('delete-item-btn').addEventListener('click', deleteEditingItem);

    document.getElementById('save-outfit-btn').addEventListener('click', saveOutfitFromBuilder);

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
            <img src="${item.image}">
            <div class="closet-card-info">
                <div class="closet-card-header-row">
                    <span class="color-dot" style="background:${item.color || '#ccc'}"></span>
                    <span class="closet-card-name">${item.name}</span>
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

    document.getElementById('modal-img').src = item.image;
    document.getElementById('modal-name').value = item.name;
    document.getElementById('modal-category').value = item.category;
    document.getElementById('modal-occasion').value = item.occasion;
    document.getElementById('modal-season').value = item.season;
    document.getElementById('modal-color').value = item.color || '#cccccc';

    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    currentEditingItemId = null;
    editFromTagQueue = false;
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
        tagged: true
    };

    const id = currentEditingItemId;
    const wasTagQueue = editFromTagQueue;
    closeEditModal();
    await Store.updateClosetItem(id, patch);
    if (wasTagQueue) openNextUntaggedItem();
}

async function deleteEditingItem() {
    if (!currentEditingItemId) return;
    const id = currentEditingItemId;
    closeEditModal();

    await Store.deleteClosetItem(id);

    const schedule = await Store.getSchedule();
    for (const dateKey of Object.keys(schedule)) {
        if (schedule[dateKey].includes(id)) {
            await Store.setScheduleDay(dateKey, schedule[dateKey].filter(x => x !== id));
        }
    }

    const outfits = await Store.getSavedOutfits();
    for (const outfit of outfits) {
        if (outfit.itemIds.includes(id)) {
            const itemIds = outfit.itemIds.filter(x => x !== id);
            if (itemIds.length === 0) await Store.deleteSavedOutfit(outfit.id);
            else await Store.addSavedOutfit({ ...outfit, itemIds });
        }
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
        p.innerHTML = `<img src="${item.image}">`;
        p.addEventListener('click', () => {
            if (outfitBuilderSelectedIds.includes(item.id)) {
                outfitBuilderSelectedIds = outfitBuilderSelectedIds.filter(id => id !== item.id);
            } else {
                outfitBuilderSelectedIds.push(item.id);
            }
            renderOutfitPickerGrid();
        });
        grid.appendChild(p);
    });
}

async function saveOutfitFromBuilder() {
    const nameInput = document.getElementById('outfit-name-input');
    const name = nameInput.value.trim();
    if (!name || outfitBuilderSelectedIds.length === 0) return;

    const itemIds = [...outfitBuilderSelectedIds];
    nameInput.value = '';
    outfitBuilderSelectedIds = [];
    renderOutfitPickerGrid();

    await Store.addSavedOutfit({ id: 'outfit_' + Date.now(), name, itemIds });
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
        const thumbs = outfit.itemIds
            .map(id => liveCloset.find(i => i.id === id))
            .filter(Boolean)
            .map(i => `<img src="${i.image}">`)
            .join('');
        card.innerHTML = `
            <div class="saved-outfit-thumbs">${thumbs}</div>
            <div class="saved-outfit-name">${outfit.name}</div>
            <button class="edit-icon-btn" data-outfit-id="${outfit.id}">🗑️</button>
        `;
        card.querySelector('button').addEventListener('click', () => Store.deleteSavedOutfit(outfit.id));
        list.appendChild(card);
    });
}
