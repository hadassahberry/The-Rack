# The-Rack 👗📅

**The-Rack** is a lightweight, web-based digital closet and outfit planner. It helps you organize your wardrobe, plan outfits on a real monthly calendar (Jewish-holiday and Shabbat aware), avoid recent outfit repetition, and check the forecast so you can dress for the weather.

---

## ✨ Features

- **Digital Closet:** Upload photos of your tops, bottoms, outerwear, shoes, dresses, and accessories, and tag each with a category, occasion, season, and color.
- **Monthly Planner:** A full month calendar (not just one week) where each day shows its assigned outfit, the day's forecast (within the ~16-day forecast window), and any Jewish holiday — including Shabbat candle-lighting times.
- **Planning Panel:** Pick a day to see its outfit, a rewear "gap" warning when an item was recently worn nearby, saved outfits you can apply in one click, and a quick single-item picker filtered by category.
- **Saved Outfits:** Build and name reusable outfit combinations from the Closet tab.
- **Rested vs. Planned:** Items already assigned to a day are marked "planned"; everything else is "rested" and ready to wear.
- **Wear Stats:** Totals, top category, and your most-worn pieces.
- **Location-aware:** Tries browser geolocation on first load (falls back to manual city search) to drive both weather and holiday/candle-lighting data.
- **Local Persistence:** Everything — closet, schedule, saved outfits, location — is saved in the browser's local storage. No account or server needed.

---

## 🛠️ Project Structure

- `index.html` — App markup: header/nav, the Planner (calendar + planning panel), Closet, Wear Stats, and the item-edit modal.
- `css/` — `variables.css` (design tokens), `layout.css` (page/header structure), `components.css` (calendar, planning panel, closet, modal styling).
- `js/state.js` — localStorage-backed data access (closet, schedule, saved outfits, location, misc. caches).
- `js/geolocation.js` — resolves and persists the location used for weather/holidays (browser geolocation → manual search → default).
- `js/weather.js` — Open-Meteo daily forecast (up to 16 days out).
- `js/holidays.js` — Hebcal Jewish calendar/candle-lighting lookup for the visible month.
- `js/closet.js` — closet CRUD, tagging queue, saved-outfit builder.
- `js/calendar.js` — month grid + planning panel rendering and interactions.
- `js/analytics.js` — Wear Stats view.
- `js/navigation.js` — tab switching.
- `js/app.js` — bootstraps location → weather → holidays after the initial paint.

---

## 🚀 Getting Started

1. Open `index.html` locally in any modern browser, or serve the folder with any static file server (e.g. `npx serve .`).
2. Allow (or deny) the location prompt, or type a city into the search pill on the Planner tab.
3. Click **"+ Add clothes"** to upload photos, then tag each one (category, occasion, season, color) — the header's "N to tag" pill tracks what's left.
4. Click any day on the calendar and use the Planning panel to apply a saved outfit or add single pieces.
5. Build reusable outfits in the Closet tab's "Saved Outfits" section.
