const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let currentEditingDay = null;
let tempSelectedIds = [];

document.addEventListener('DOMContentLoaded', () => {
    renderCalendar();

    document.getElementById('close-picker-btn').addEventListener('click', () => {
        document.getElementById('picker-modal').classList.add('hidden');
    });

    document.getElementById('save-day-btn').addEventListener('click', () => {
        let schedule = Store.getSchedule();
        if (tempSelectedIds.length > 0) schedule[currentEditingDay] = tempSelectedIds;
        else delete schedule[currentEditingDay];
        Store.saveSchedule(schedule);
        renderCalendar();
        document.getElementById('picker-modal').classList.add('hidden');
    });
});

function renderCalendar() {
    const weeklyGrid = document.getElementById('weekly-grid');
    if (!weeklyGrid) return;
    weeklyGrid.innerHTML = '';
    
    let schedule = Store.getSchedule();
    let closet = Store.getCloset();

    days.forEach(day => {
        const col = document.createElement('div');
        col.className = 'day-column';
        col.addEventListener('click', () => openPickerModal(day));

        col.innerHTML = `<div class="day-header">${day}</div>`;
        const preview = document.createElement('div');
        preview.className = 'day-outfits-preview';

        const assignedIds = schedule[day] || [];
        if (assignedIds.length === 0) {
            preview.innerHTML = `<div class="day-empty-prompt">Tap to build look</div>`;
        } else {
            assignedIds.forEach(id => {
                const item = closet.find(i => i.id === id);
                if (item) preview.innerHTML += `<div class="mini-slot-item"><img src="${item.image}"></div>`;
            });
        }
        col.appendChild(preview);
        weeklyGrid.appendChild(col);
    });
}

function openPickerModal(day) {
    currentEditingDay = day;
    document.getElementById('picker-title').textContent = `Lookbook Builder for ${day}`;
    tempSelectedIds = [...(Store.getSchedule()[day] || [])];
    
    updateCanvasPreview();
    renderPickerGrid();
    document.getElementById('picker-modal').classList.remove('hidden');
}

function renderPickerGrid() {
    const grid = document.getElementById('picker-items-grid');
    grid.innerHTML = '';
    Store.getCloset().forEach(item => {
        const p = document.createElement('div');
        p.className = `picker-item ${tempSelectedIds.includes(item.id) ? 'selected' : ''}`;
        p.innerHTML = `<img src="${item.image}">`;
        p.addEventListener('click', () => {
            if (tempSelectedIds.includes(item.id)) tempSelectedIds = tempSelectedIds.filter(id => id !== item.id);
            else tempSelectedIds.push(item.id);
            renderPickerGrid();
            updateCanvasPreview();
        });
        grid.appendChild(p);
    });
}

function updateCanvasPreview() {
    const box = document.getElementById('canvas-preview-box');
    box.innerHTML = '';
    if (tempSelectedIds.length === 0) {
        box.innerHTML = `<span class="canvas-placeholder">Select items to preview</span>`;
        return;
    }
    tempSelectedIds.forEach(id => {
        const item = Store.getCloset().find(i => i.id === id);
        if (item) box.innerHTML += `<div class="canvas-item"><img src="${item.image}"></div>`;
    });
}
