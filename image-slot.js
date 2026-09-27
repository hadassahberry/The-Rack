document.addEventListener('DOMContentLoaded', () => {
    const itemUpload = document.getElementById('item-upload');
    const closetItemsContainer = document.getElementById('closet-items');
    const weeklyGrid = document.getElementById('weekly-grid');

    // Local storage state initialization
    let closet = JSON.parse(localStorage.getItem('rack_closet')) || [];
    let schedule = JSON.parse(localStorage.getItem('rack_schedule')) || {};

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // Render initial view
    renderCloset();
    renderCalendar();
    fetchWeather();

    // Handle Image Uploads
    itemUpload.addEventListener('change', (e) => {
        const files = e.target.files;
        for (let file of files) {
            const reader = new FileReader();
            reader.onload = function(uploadEvent) {
                const newItem = {
                    id: 'item_' + Date.now() + Math.random().toString(36).substr(2, 5),
                    image: uploadEvent.target.result
                };
                closet.push(newItem);
                saveAndRefresh();
            };
            reader.readAsDataURL(file);
        }
    });

    function saveAndRefresh() {
        localStorage.setItem('rack_closet', JSON.stringify(closet));
        localStorage.setItem('rack_schedule', JSON.stringify(schedule));
        renderCloset();
        renderCalendar();
    }

    // Render Closet Drawer
    function renderCloset() {
        closetItemsContainer.innerHTML = '';
        closet.forEach(item => {
            const img = document.createElement('img');
            img.src = item.image;
            img.className = 'clothing-thumb';
            img.draggable = true;
            img.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', item.id);
            });
            closetItemsContainer.appendChild(img);
        });
    }

    // Render Weekly Grid Planner
    function renderCalendar() {
        weeklyGrid.innerHTML = '';
        days.forEach(day => {
            const col = document.createElement('div');
            col.className = 'day-column';

            const header = document.createElement('div');
            header.className = 'day-header';
            header.textContent = day;
            col.appendChild(header);

            const dropzone = document.createElement('div');
            dropzone.className = 'day-dropzone';
            dropzone.dataset.day = day;

            // Drag and drop listeners
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('drag-over');
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('drag-over');
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('drag-over');
                const itemId = e.dataTransfer.getData('text/plain');
                assignItemToDay(day, itemId);
            });

            // Render assigned items for this day
            const assignedIds = schedule[day] || [];
            
            // Check for outfit repetition against other days
            const isRepeat = checkOutfitRepetition(day, assignedIds);

            assignedIds.forEach(itemId => {
                const itemData = closet.find(i => i.id === itemId);
                if (itemData) {
                    const itemCard = document.createElement('div');
                    itemCard.className = 'slot-item';
                    
                    const img = document.createElement('img');
                    img.src = itemData.image;
                    itemCard.appendChild(img);
                    dropzone.appendChild(itemCard);
                }
            });

            if (isRepeat && assignedIds.length > 0) {
                const warning = document.createElement('div');
                warning.className = 'repeat-warning';
                warning.textContent = '🔁 Combo repeated recently!';
                col.appendChild(warning);
            }

            col.appendChild(dropzone);
            weeklyGrid.appendChild(col);
        });
    }

    function assignItemToDay(day, itemId) {
        if (!schedule[day]) {
            schedule[day] = [];
        }
        // Prevent duplicate exact item assignment on same day
        if (!schedule[day].includes(itemId)) {
            schedule[day].push(itemId);
            saveAndRefresh();
        }
    }

    // Repetition check logic (compares item combinations across days)
    function checkOutfitRepetition(currentDay, currentItemIds) {
        if (currentItemIds.length === 0) return false;
        
        for (let day of days) {
            if (day === currentDay) continue;
            const otherDayIds = schedule[day] || [];
            if (otherDayIds.length > 0 && arraysEqual(otherDayIds, currentItemIds)) {
                return true;
            }
        }
        return false;
    }

    function arraysEqual(a, b) {
        if (a.length !== b.length) return false;
        const sortedA = [...a].sort();
        const sortedB = [...b].sort();
        return sortedA.every((val, index) => val === sortedB[index]);
    }

    // Mock weather banner updater
    function fetchWeather() {
        const banner = document.getElementById('weather-banner');
        // Simulated weather lookup
        banner.textContent = "🌡️ 72°F & Sunny — Perfect weather for light layers!";
    }
});
