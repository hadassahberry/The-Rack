let activeCategory = 'all';
let activeSeason = 'all';

document.addEventListener('DOMContentLoaded', () => {
    const itemUpload = document.getElementById('item-upload');
    const categoryTabs = document.getElementById('category-tabs');
    const seasonFilter = document.getElementById('season-filter');

    categoryTabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
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
                    name: file.name.substring(0, 15) || 'Item',
                    category: 'tops', occasion: 'casual', season: 'all-season',
                    image: ev.target.result
                });
                Store.saveCloset(closet);
                renderCloset();
            };
            reader.readAsDataURL(file);
        }
    });

    renderCloset();
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
                    <span class="closet-card-name">${item.name}</span>
                    <button class="edit-icon-btn" onclick="openEditModal('${item.id}')">⚙️</button>
                </div>
                <div class="tags-row">
                    <span class="badge">${item.occasion}</span>
                    <span class="badge">${item.season}</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}
