const CATEGORIES = ['tops', 'bottoms', 'outerwear', 'shoes', 'dresses', 'accessories'];

let activeCategory = 'all';
let activeSeason = 'all';
let currentEditingItemId = null;
let editFromTagQueue = false;

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

    itemUpload.addEventListener('change', (e) => {
        for (let file of e.target.files) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                let closet = Store.getCloset();
                closet.push({
                    id: 'item_' + Date.now() + Math.random().toString(36).substr(2, 5),
                    name: file.name.replace(/\.[^.]+$/, '').substring(0, 20) || 'Item',
                    category: 'tops', occasion: 'casual', season: 'all-season',
                    color: '#cccccc', tagged: false,
                    image: ev.target.result
                });
                Store.saveCloset(closet);
                renderCloset();
                updateTagQueueUI();
                window.dispatchEvent(new Event('rack:closet-changed'));
            };
            reader.readAsDataURL(file);
        }
        itemUpload.value = '';
    });

    tagQueueBtn.addEventListener('click', () => {
        document.querySelector('.nav-btn[data-tab="closet-view"]').click();
        openNextUntaggedItem(true);
    });

    document.getElementById('close-edit-btn').addEventListener('click', closeEditModal);
    document.getElementById('save-item-btn').addEventListener('click', saveEditModal);
    document.getElementById('delete-item-btn').addEventListener('click', deleteEditingItem);

    document.getElementById('save-outfit-btn').addEventListener('click', saveOutfitFromBuilder);

    renderCloset();
    renderOutfitPickerGrid();
    renderSavedOutfitsList();
    updateTagQueueUI();
});

function renderCloset() {
    const grid = document.getElementById('full-closet-grid');
    if (!grid) return;
    grid.innerHTML = '';

    let closet = Store.getCloset();
    let filtered = activeCategory === 'all' ? closet : closet.filter(i => i.category === activeCategory);
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
    const count = Store.getCloset().filter(i => !i.tagged).length;
    btn.textContent = `${count} to tag`;
    btn.classList.toggle('hidden', count === 0);
}

function openNextUntaggedItem() {
    const next = Store.getCloset().find(i => !i.tagged);
    if (next) {
        editFromTagQueue = true;
        openEditModal(next.id);
    }
}

function openEditModal(itemId) {
    const item = Store.getCloset().find(i => i.id === itemId);
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

function saveEditModal() {
    if (!currentEditingItemId) return;
    let closet = Store.getCloset();
    const item = closet.find(i => i.id === currentEditingItemId);
    if (!item) return;

    item.name = document.getElementById('modal-name').value.trim() || item.name;
    item.category = document.getElementById('modal-category').value;
    item.occasion = document.getElementById('modal-occasion').value;
    item.season = document.getElementById('modal-season').value;
    item.color = document.getElementById('modal-color').value;
    item.tagged = true;

    Store.saveCloset(closet);
    renderCloset();
    renderOutfitPickerGrid();
    updateTagQueueUI();
    window.dispatchEvent(new Event('rack:closet-changed'));

    const wasTagQueue = editFromTagQueue;
    closeEditModal();
    if (wasTagQueue) openNextUntaggedItem();
}

function deleteEditingItem() {
    if (!currentEditingItemId) return;
    let closet = Store.getCloset().filter(i => i.id !== currentEditingItemId);
    Store.saveCloset(closet);

    let schedule = Store.getSchedule();
    Object.keys(schedule).forEach(date => {
        schedule[date] = schedule[date].filter(id => id !== currentEditingItemId);
        if (schedule[date].length === 0) delete schedule[date];
    });
    Store.saveSchedule(schedule);

    let outfits = Store.getSavedOutfits();
    outfits.forEach(o => { o.itemIds = o.itemIds.filter(id => id !== currentEditingItemId); });
    Store.saveSavedOutfits(outfits);

    renderCloset();
    renderOutfitPickerGrid();
    renderSavedOutfitsList();
    updateTagQueueUI();
    window.dispatchEvent(new Event('rack:closet-changed'));
    window.dispatchEvent(new Event('rack:schedule-changed'));
    window.dispatchEvent(new Event('rack:outfits-changed'));

    closeEditModal();
}

// --- Saved Outfits builder (Closet tab) ---

let outfitBuilderSelectedIds = [];

function renderOutfitPickerGrid() {
    const grid = document.getElementById('outfit-picker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    Store.getCloset().forEach(item => {
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

function saveOutfitFromBuilder() {
    const nameInput = document.getElementById('outfit-name-input');
    const name = nameInput.value.trim();
    if (!name || outfitBuilderSelectedIds.length === 0) return;

    let outfits = Store.getSavedOutfits();
    outfits.push({ id: 'outfit_' + Date.now(), name, itemIds: [...outfitBuilderSelectedIds] });
    Store.saveSavedOutfits(outfits);

    nameInput.value = '';
    outfitBuilderSelectedIds = [];
    renderOutfitPickerGrid();
    renderSavedOutfitsList();
    window.dispatchEvent(new Event('rack:outfits-changed'));
}

function renderSavedOutfitsList() {
    const list = document.getElementById('saved-outfits-list');
    if (!list) return;
    list.innerHTML = '';

    const outfits = Store.getSavedOutfits();
    const closet = Store.getCloset();

    if (outfits.length === 0) {
        list.innerHTML = '<p style="color:#888; font-size:0.85rem;">No saved outfits yet — select items above and name them to save one.</p>';
        return;
    }

    outfits.forEach(outfit => {
        const card = document.createElement('div');
        card.className = 'saved-outfit-card';
        const thumbs = outfit.itemIds
            .map(id => closet.find(i => i.id === id))
            .filter(Boolean)
            .map(i => `<img src="${i.image}">`)
            .join('');
        card.innerHTML = `
            <div class="saved-outfit-thumbs">${thumbs}</div>
            <div class="saved-outfit-name">${outfit.name}</div>
            <button class="edit-icon-btn" data-outfit-id="${outfit.id}">🗑️</button>
        `;
        card.querySelector('button').addEventListener('click', () => deleteSavedOutfit(outfit.id));
        list.appendChild(card);
    });
}

function deleteSavedOutfit(outfitId) {
    let outfits = Store.getSavedOutfits().filter(o => o.id !== outfitId);
    Store.saveSavedOutfits(outfits);
    renderSavedOutfitsList();
    window.dispatchEvent(new Event('rack:outfits-changed'));
}
