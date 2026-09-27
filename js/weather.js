document.addEventListener('DOMContentLoaded', () => {
    const getWeatherBtn = document.getElementById('get-weather-btn');
    const cityInput = document.getElementById('city-input');

    const savedCity = localStorage.getItem('rack_last_city') || "New York";
    cityInput.value = savedCity;
    fetchWeatherForCity(savedCity);

    getWeatherBtn.addEventListener('click', () => {
        const city = cityInput.value.trim();
        if (city) fetchWeatherForCity(city);
    });

    async function fetchWeatherForCity(city) {
        const banner = document.getElementById('weather-banner');
        banner.textContent = `🔍 Finding weather for ${city}...`;

        try {
            const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
            const geoData = await geoRes.json();
            if (!geoData.results) { banner.textContent = `❌ City not found.`; return; }

            const { latitude, longitude, name, country } = geoData.results[0];
            const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`);
            const wData = await wRes.json();

            const tempF = Math.round((wData.current.temperature_2m * 9/5) + 32);
            banner.textContent = `📍 ${name}, ${country}: ${tempF}°F — Clear & Pleasant`;
            localStorage.setItem('rack_last_city', city);
        } catch {
            banner.textContent = `⚠️ Could not load weather.`;
        }
    }
});
