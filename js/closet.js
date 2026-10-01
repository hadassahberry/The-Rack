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

    itemUpload.addEventListener('change', async (e) => {
        const files = [...e.target.files];
        itemUpload.value = '';
        for (const file of files) {
            try {
                const image = await compressImage(file);
                await Store.addClosetItem({
                    id: 'item_' + Date.now() + Math.random().toString(36).substr(2, 5),
                    name: file.name.replace(/\.[^.]+$/, '').substring(0, 20) || 'Item',
                    category: 'tops', occasion: 'casual', season: 'all-season',
                    color: '#cccccc', tagged: false,
                    image
                });
            } catch (err) {
                console.error('Failed to add item', err);
            }
        }
    });

    tagQueueBtn.addEventListener('click', () => {
        document.querySelector('.nav-btn[data-tab="closet-view"]').click();
        openNextUntaggedItem();
    });

    document.getElementById('close-edit-btn').addEventListener('click', closeEditModal);
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
                    <button class="edit-icon-btn" onclick="openEditModal('${item.id}')">⚙️</button>
                </div>
                <div class="tags-row">
                    <span class="badge">${item.occasion}</span>
                    <span class="badge">${item.season}</span>
                    ${!item.tagged ? '<span class="badge badge-untagged">needs tagging</span>' : ''}
                </div>
            </div>
        `;
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
