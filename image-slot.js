document.addEventListener('DOMContentLoaded', () => {
    // Navigation Tabs
    const navButtons = document.querySelectorAll('.nav-btn');
    const viewSections = document.querySelectorAll('.view-section');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            viewSections.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // App state
    const itemUpload = document.getElementById('item-upload');
    const fullClosetGrid = document.getElementById('full-closet-grid');
    const weeklyGrid = document.getElementById('weekly-grid');
    const categoryTabs = document.getElementById('category-tabs');

    let closet = JSON.parse(localStorage.getItem('rack_closet')) || [];
    let schedule = JSON.parse(localStorage.getItem('rack_schedule')) || {};
    let activeCategory = 'all';

    // Picker Modal elements
    const pickerModal = document.getElementById('picker-modal');
    const pickerTitle = document.getElementById('picker-title');
    const pickerItemsGrid = document.getElementById('picker-items-grid');
    const saveDayBtn = document.getElementById('save-day-btn');
    const closePickerBtn = document.getElementById('close-picker-btn');
    let currentEditingDay = null;
    let tempSelectedIds = [];

    // Edit Modal elements
    const editModal = document.getElementById('edit-modal');
    const modalImg = document.getElementById('modal-img');
    const modalName = document.getElementById('modal-name');
    const modalCategory = document.getElementById('modal-category');
    const saveItemBtn = document.getElementById('save-item-btn');
    const deleteItemBtn = document.getElementById('delete-item-btn');
    const closeEditBtn = document.getElementById('close-edit-btn');
    let editingItemId = null;

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    renderCloset();
    renderCalendar();

    // Category filtering in closet view
    categoryTabs.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            activeCategory = e.target.dataset.category;
            renderCloset();
        }
    });

    // Handle File Uploads
    itemUpload.addEventListener('change', (e) => {
        const files = e.target.files;
        for (let file of files) {
            const reader = new FileReader();
            reader.onload = function(uploadEvent) {
                const newItem = {
                    id: 'item_' + Date.now() + Math.random().toString(36).substr(2, 5),
                    name: file.name.substring(0, 15) || 'Wardrobe Item',
                    category: 'tops',
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

    // Render Full Closet Grid
    function renderCloset() {
        fullClosetGrid.innerHTML = '';
        const filteredItems = activeCategory === 'all' 
            ? closet 
            : closet.filter(i => i.category === activeCategory);

        if (filteredItems.length === 0) {
            fullClosetGrid.innerHTML = '<p style="grid-column: span 3; text-align: center; color: #888; margin-top: 30px;">No items in this category yet. Click "+ Add New Item" above!</p>';
            return;
        }

        filteredItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'closet-card';

            const img = document.createElement('img');
            img.src = item.image;
            card.appendChild(img);

            const info = document.createElement('div');
            info.className = 'closet-card-info';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'closet-card-name';
            nameSpan.textContent = item.name;
            info.appendChild(nameSpan);

            const editBtn = document.createElement('button');
            editBtn.className = 'edit-icon-btn';
            editBtn.innerHTML = '⚙️';
            editBtn.title = "Edit Item";
            editBtn.addEventListener('click', () => openEditModal(item));
            info.appendChild(editBtn);

            card.appendChild(info);
            fullClosetGrid.appendChild(card);
        });
    }

    // Render Weekly Calendar Grid
    function renderCalendar() {
        weeklyGrid.innerHTML = '';
        days.forEach(day => {
            const col = document.createElement('div');
            col.className = 'day-column';
            col.addEventListener('click', () => openPickerModal(day));

            const header = document.createElement('div');
            header.className = 'day-header';
            header.textContent = day;
            col.appendChild(header);

            const previewContainer = document.createElement('div');
            previewContainer.className = 'day-outfits-preview';

            const assignedIds = schedule[day] || [];
            const isRepeat = checkOutfitRepetition(day, assignedIds);

            if (assignedIds.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'day-empty-prompt';
                empty.textContent = 'Tap to select outfit';
                previewContainer.appendChild(empty);
            } else {
                assignedIds.forEach(itemId => {
                    const itemData = closet.find(i => i.id === itemId);
                    if (itemData) {
                        const mini = document.createElement('div');
                        mini.className = 'mini-slot-item';
                        const img = document.createElement('img');
                        img.src = itemData.image;
                        mini.appendChild(img);
                        previewContainer.appendChild(mini);
                    }
                });
            }

            col.appendChild(previewContainer);

            if (isRepeat && assignedIds.length > 0) {
                const warning = document.createElement('div');
                warning.className = 'repeat-warning';
                warning.textContent = '🔁 Repeated recently!';
                col.appendChild(warning);
            }

            weeklyGrid.appendChild(col);
        });
    }

    // Click-to-Select Day Picker Modal
    function openPickerModal(day) {
        currentEditingDay = day;
        pickerTitle.textContent = `Plan Outfit for ${day}`;
        tempSelectedIds = [...(schedule[day] || [])];
        
        pickerItemsGrid.innerHTML = '';
        if (closet.length === 0) {
            pickerItemsGrid.innerHTML = '<p style="grid-column: span 3; text-align: center; color: #888;">Your closet is empty! Add items in the "My Closet" tab first.</p>';
        } else {
            closet.forEach(item => {
                const pItem = document.createElement('div');
                pItem.className = 'picker-item';
                if (tempSelectedIds.includes(item.id)) {
                    pItem.classList.add('selected');
                }

                const img = document.createElement('img');
                img.src = item.image;
                pItem.appendChild(img);

                pItem.addEventListener('click', () => {
                    if (tempSelectedIds.includes(item.id)) {
                        tempSelectedIds = tempSelectedIds.filter(id => id !== item.id);
                        pItem.classList.remove('selected');
                    } else {
                        tempSelectedIds.push(item.id);
                        pItem.classList.add('selected');
                    }
                });

                pickerItemsGrid.appendChild(pItem);
            });
        }

        pickerModal.classList.remove('hidden');
    }

    closePickerBtn.addEventListener('click', () => pickerModal.classList.add('hidden'));

    saveDayBtn.addEventListener('click', () => {
        if (tempSelectedIds.length > 0) {
            schedule[currentEditingDay] = tempSelectedIds;
        } else {
            delete schedule[currentEditingDay];
        }
        saveAndRefresh();
        pickerModal.classList.add('hidden');
    });

    // Item Edit Modal Functions
    function openEditModal(item) {
        editingItemId = item.id;
        modalImg.src = item.image;
        modalName.value = item.name;
        modalCategory.value = item.category || 'tops';
        editModal.classList.remove('hidden');
    }

    closeEditBtn.addEventListener('click', () => editModal.classList.add('hidden'));

    saveItemBtn.addEventListener('click', () => {
        const item = closet.find(i => i.id === editingItemId);
        if (item) {
            item.name = modalName.value.trim() || 'Item';
            item.category = modalCategory.value;
            saveAndRefresh();
        }
        editModal.classList.add('hidden');
    });

    deleteItemBtn.addEventListener('click', () => {
        closet = closet.filter(i => i.id !== editingItemId);
        for (let day in schedule) {
            schedule[day] = schedule[day].filter(id => id !== editingItemId);
        }
        saveAndRefresh();
        editModal.classList.add('hidden');
    });

    // Outfit Repetition Checker
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

    // Weather API Integration
    const getWeatherBtn = document.getElementById('get-weather-btn');
    const cityInput = document.getElementById('city-input');

    const savedCity = localStorage.getItem('rack_last_city');
    if (savedCity) {
        cityInput.value = savedCity;
        fetchWeatherForCity(savedCity);
    } else {
        cityInput.value = "New York";
        fetchWeatherForCity("New York");
    }

    getWeatherBtn.addEventListener('click', () => {
        const cityName = cityInput.value.trim();
        if (cityName) fetchWeatherForCity(cityName);
    });

    async function fetchWeatherForCity(city) {
        const banner = document.getElementById('weather-banner');
        banner.textContent = `🔍 Finding weather for ${city}...`;

        try {
            const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
            const geoData = await geoResponse.json();

            if (!geoData.results || geoData.results.length === 0) {
                banner.textContent = `❌ City not found. Try another location.`;
                return;
            }

            const { latitude, longitude, name, country } = geoData.results[0];
            const weatherResponse = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`);
            const weatherData = await weatherResponse.json();

            const tempC = weatherData.current.temperature_2m;
            const tempF = Math.round((tempC * 9/5) + 32);
            const code = weatherData.current.weather_code;

            let condition = "Clear & Pleasant";
            if (code >= 1 && code <= 3) condition = "Partly Cloudy";
            else if (code >= 51 && code <= 67) condition = "Rainy — Grab a jacket & boots!";
            else if (code >= 71 && code <= 77) condition = "Snowy — Bundle up warmly!";

            banner.textContent = `📍 ${name}, ${country}: ${tempF}°F (${tempC}°C) — ${condition}`;
            localStorage.setItem('rack_last_city', city);
        } catch (error) {
            banner.textContent = `⚠️ Could not load weather data. Check your connection.`;
        }
    }
});
