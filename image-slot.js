document.addEventListener('DOMContentLoaded', () => {
    const itemUpload = document.getElementById('item-upload');
    const closetItemsContainer = document.getElementById('closet-items');
    const weeklyGrid = document.getElementById('weekly-grid');
    const getWeatherBtn = document.getElementById('get-weather-btn');
    const cityInput = document.getElementById('city-input');

    // Local storage state initialization
    let closet = JSON.parse(localStorage.getItem('rack_closet')) || [];
    let schedule = JSON.parse(localStorage.getItem('rack_schedule')) || {};

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // Render initial view
    renderCloset();
    renderCalendar();

    // Weather Initialization
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
        if (cityName) {
            fetchWeatherForCity(cityName);
        }
    });

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
        if (closet.length === 0) {
            closetItemsContainer.innerHTML = '<p style="grid-column: span 2; text-align: center; color: #888; font-size: 0.9rem; margin-top: 20px;">No items yet. Upload some clothes above!</p>';
            return;
        }

        closet.forEach(item => {
            const img = document.createElement('img');
            img.src = item.image;
            img.className = 'clothing-thumb';
            img.draggable = true;
            
            img.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = 'copy';
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
                e.dataTransfer.dropEffect = 'copy';
                dropzone.classList.add('drag-over');
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('drag-over');
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('drag-over');
                const itemId = e.dataTransfer.getData('text/plain');
                if (itemId) {
                    assignItemToDay(day, itemId);
                }
            });

            // Render assigned items for this day
            const assignedIds = schedule[day] || [];
            const isRepeat = checkOutfitRepetition(day, assignedIds);

            assignedIds.forEach((itemId, index) => {
                const itemData = closet.find(i => i.id === itemId);
                if (itemData) {
                    const itemCard = document.createElement('div');
                    itemCard.className = 'slot-item';
                    
                    const img = document.createElement('img');
                    img.src = itemData.image;
                    itemCard.appendChild(img);

                    itemCard.title = "Click to remove item";
                    itemCard.style.cursor = 'pointer';
                    itemCard.addEventListener('click', () => {
                        schedule[day].splice(index, 1);
                        saveAndRefresh();
                    });

                    dropzone.appendChild(itemCard);
                }
            });

            if (assignedIds.length === 0) {
                const emptyText = document.createElement('div');
                emptyText.style.cssText = "color: #bbb; font-size: 0.8rem; text-align: center; margin: auto;";
                emptyText.textContent = "Drop item here";
                dropzone.appendChild(emptyText);
            }

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
        if (!schedule[day].includes(itemId)) {
            schedule[day].push(itemId);
            saveAndRefresh();
        }
    }

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

    // Live weather forecast function using Open-Meteo
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
            console.error(error);
        }
    }
});
