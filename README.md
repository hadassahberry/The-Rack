# The-Rack 👗📅

**The-Rack** is a lightweight, web-based digital closet and weekly outfit planning app. It helps you organize your wardrobe, schedule your looks week-by-week, avoid recent outfit repetitions, and check real-time weather forecasts to match your style to the day's conditions.

---

## ✨ Features

- **Digital Closet Drawer:** Upload photos of your tops, bottoms, shoes, and accessories directly from your device.
- **Weekly Calendar Grid:** Drag and drop your clothing items across a 7-day visual planner (Monday through Sunday) to map out your week in advance. Click any assigned item to remove it.
- **Outfit Repetition Alerts:** Automatically flags when you've worn the exact same combination of items recently to keep your wardrobe rotation fresh.
- **Live Weather Forecast:** Type in any city name to fetch real-time temperatures and conditions so you can plan weather-appropriate layers.
- **Local Persistence:** Securely saves your uploaded closet, weekly schedule, and last searched city right in your browser's local storage.

---

## 🛠️ Project Structure

- `index.html` — The core HTML markup containing the app layout, closet sidebar, and weekly calendar grid container.
- `styles.css` — Modern, boutique-inspired styling using CSS Grid and Flexbox for clean multi-column layouts.
- `image-slot.js` — Client-side logic managing file uploads, local storage state, drag-and-drop interactions, repetition-checking algorithms, and Open-Meteo weather API integration.

---

## 🚀 Getting Started

1. Visit the live app on **GitHub Pages** or open `index.html` locally in any modern web browser.
2. Click **"+ Add Closet Item"** to upload photos of your wardrobe.
3. Type your city into the weather search bar and click **Update Weather**.
4. Drag items from your closet sidebar and drop them onto any day of the week to build your outfit schedule!
