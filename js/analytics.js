document.addEventListener('DOMContentLoaded', () => {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        if (btn.dataset.tab === 'analytics-view') {
            btn.addEventListener('click', renderAnalytics);
        }
    });
});

function renderAnalytics() {
    const closet = Store.getCloset();
    const schedule = Store.getSchedule();

    document.getElementById('stat-total-items').textContent = closet.length;

    let totalWears = 0;
    let wearCounts = {};
    let categoryCounts = {};
    closet.forEach(i => wearCounts[i.id] = 0);

    for (let day in schedule) {
        schedule[day].forEach(id => {
            totalWears++;
            if (wearCounts[id] !== undefined) wearCounts[id]++;
            const item = closet.find(i => i.id === id);
            if (item) categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
        });
    }

    document.getElementById('stat-total-wears').textContent = totalWears;
    let topCat = Object.keys(categoryCounts).reduce((a, b) => categoryCounts[a] > categoryCounts[b] ? a : b, '—');
    document.getElementById('stat-top-category').textContent = topCat.toUpperCase();

    const wornGrid = document.getElementById('analytics-most-worn');
    wornGrid.innerHTML = '';
    [...closet].sort((a, b) => wearCounts[b.id] - wearCounts[a.id]).slice(0, 4).forEach(item => {
        wornGrid.innerHTML += `
            <div class="worn-card">
                <img src="${item.image}">
                <span>${item.name}</span>
                <span style="font-size:0.7rem; color:#888;">Worn ${wearCounts[item.id]}x</span>
            </div>
        `;
    });
}
