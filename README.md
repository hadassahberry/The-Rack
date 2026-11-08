# The-Rack 👗📅

**The-Rack** is a lightweight, web-based digital closet and outfit planner. It helps you organize your wardrobe, plan outfits on a real monthly calendar (Jewish-holiday and Shabbat aware), avoid recent outfit repetition, and check the forecast so you can dress for the weather.

---

## ✨ Features

- **Digital Closet:** Upload photos of your tops, bottoms, outerwear, shoes, dresses, and accessories, and tag each with a category, occasion, season, and color.
- **Planner with Week / 2 Weeks / Month views:** A calendar (month by default) where each day shows its assigned outfit, the day's forecast (within the ~16-day forecast window), and any Jewish holiday — including Shabbat candle-lighting times.
- **Today and the selected day:** today always has its own marker (a filled date badge and a stripe along the top of its day), separate from the pink outline that follows the day you clicked. The **Today** button beside the ‹ › arrows returns to the current date in whichever view is open and selects it.
- **Switching between Week, 2 weeks and Month** keeps you where you are looking: the new view is built around the day you selected if you can see it, otherwise around today if you can see that, otherwise around what's on screen now (it never jumps back to a day you've navigated away from). Your selected day is never cleared by switching views. A line under the title says where the range sits ("This week", "Next week", "3 months from now", "Ended last week"), and the Today button is there in every view.
- **Photos on the calendar:** each day shows small photos of what's planned. Each outfit (activity) is its own stack, a top directly above its bottom above its shoes, and several outfits on one day stand side by side with their activity names, so different activities never mix. Settings → Outfit photos switches this off to show names instead.
- **Head to toe:** an outfit's pieces always show in the same order, with a top above a bottom (outerwear, tops, dresses, bottoms, shoes, accessories), wherever they appear.
- **Planning popup:** click any day and a popup opens over the calendar (a dialog on a computer, a sheet from the bottom on a phone); close it with ✕, Esc, or a click outside. It shows the day's outfit, a rewear "gap" warning when an item was recently worn nearby, saved outfits you can apply in one click, and a photo picker filtered by category, so you choose by sight, not just by name.
- **Less repetitive tagging:** a new photo's category is guessed from its name ("…skirt" → Bottoms, "…boots" → Shoes) instead of always starting as Tops; a name that lists several things ("top and skirt set") or has no clothing word gets no guess. While you work through **N to tag**, the next item also opens with the category you just confirmed. Every suggestion is shown as one (an amber outline, "We guessed Bottoms from the name. Please check it.", a dashed "Guessed: Bottoms" badge on the card) and the item stays "needs tagging" until you press Save, so a guess is never treated as confirmed. Cancelling saves nothing, and items you've already tagged are never changed.
- **Readable names:** closet card names get two lines (long unbroken words are broken to fit) instead of one cut-off line. If a name is still cut off, a **Show full name** link on the card reads the rest in place (and **Show less** puts it back), with no need to open the editor. Hovering a card still shows the full name on a computer.
- **Photo framing:** open any item (or tag a new one) and choose what part of its photo shows. Drag to move it and zoom with the slider, mouse wheel or a two-finger pinch, for example to focus on the shirt and not the pants (all the way out shows the whole photo). The original photo is never changed; the framed square is saved next to it and used on the calendar, in the closet and everywhere else, and you can change the framing again any time.
- **Applying a saved outfit tells you what it did.** Pieces are never swapped silently: if the outfit is already planned (in the highlighted outfit or any other on that day) you get "Already planned… Nothing was changed." and no duplicate is made, and saved-outfit buttons show "✓ Planned" when they're already on the day. On an empty day it's added; into a highlighted outfit with no pieces it fills that outfit; into one that has other pieces it replaces them and keeps the activity (with an **Undo**); and an outfit you've marked as worn is left alone and the saved outfit is added as another outfit instead.
- **Saved Outfits:** Press **Build an outfit** in the Closet tab and the closet cards turn into checkboxes: tap (or Tab to a card and press Space / Enter) to add or remove a piece. Tapping a card in this mode selects it; outside it, a card opens its editor as usual. A bar that stays in view shows how many pieces are selected, lists them by name and kind (with the occasion and season added when two pieces share a name), and holds the name field and Save button. The category and season filters keep working, and your selection is kept while you filter.
- **Rested vs. Planned:** Items already assigned to a day are marked "planned"; everything else is "rested" and ready to wear.
- **Wear Stats:** Planning an outfit is not wearing it. Press **Mark as worn** on an outfit for today or a past day (future days can't be marked) and only those count: wears marked, top category worn, and your most-worn pieces, shown next to how many outfits are planned ahead. Past plans nobody marked aren't counted; Wear stats lists them and offers an optional "Mark them as worn" (after asking). Nothing already saved is turned into a wear automatically.
- **Safer deleting:** removing a planned outfit, deleting a saved outfit, or deleting a piece of clothing asks first. Deleting a piece spells out what it affects (planned days, wear history, saved outfits, including any saved outfit that would be deleted because that piece was its only one). Cancel, Esc or a click outside changes nothing. Saving an outfit with no pieces or no name explains what's missing and keeps what you picked.
- **Edit item:** a visible Cancel and × (Esc and clicking outside work too) warn before throwing away unsaved changes, and Delete is kept apart from Save.
- **Sign-in:** the app opens on a loading screen until the sign-in check finishes (no flash of the sign-in form for people already signed in); if it can't answer, you get the sign-in form with a note rather than a spinner that never ends.
- **Settings page:** Set your location (device location or a typed city), and turn the **weather** and the **Hebrew calendar** on or off. The Hebrew calendar is all-or-nothing: on, Shabbos, Yomim Tovim, candle-lighting and the automatic Shabbos / Yom Tov activities all appear by themselves; off, nothing Jewish is shown anywhere. Choose **°F / °C** (automatic by country by default) and whether the **week starts on Sunday or Monday**. Settings sync with your account; anything switched off is never requested, so your location isn't sent to that service. Locations in Israel automatically get the Israel holiday schedule. Candle lighting is 18 minutes before sunset.
- **More calendars (Settings → Calendars):** besides the Hebrew calendar, switch on **public holidays** for your country (from the free Nager.Date service; only the country code is sent, and a holiday that applies to just part of a country is left out), **Christian holidays** (Christmas, Easter, Lent, Advent…, with a Western or Orthodox Easter), and the **Islamic (Hijri) calendar** (the Hijri date on every day plus Ramadan, Eid and other dates; it uses the browser's built-in calendar, so a date can differ by a day from a locally sighted moon). The last two are worked out on the device and need no internet. Everything starts off except the Hebrew calendar; a switched-off calendar is hidden everywhere.
- **Activity dropdown:** the Activity field on a planned outfit is an editable dropdown with a visible arrow. Opening it lists your own previously saved activities, most recently used first, so you can pick one without retyping; typing narrows the list or lets you enter a new activity (an "Add “…”" row appears at the end). There are no built-in activities: a new account sees "Type an activity to get started." An activity joins the list when it is saved on a plan (Enter, picking a row, or leaving the field), never from unfinished typing, and Escape cancels (first press closes the list, the next restores what was saved). Spaces and capitals don't create duplicates ("class", " Class " and "CLASS" are one activity). Works by mouse, touch and keyboard (↑ ↓ Enter Esc).
- **Repeat warnings:** give an outfit an activity (like "Class") and the app flags it if you wore the same item, or the same whole outfit, to that activity in the last few times. Shabbos and Yom Tov count as activities automatically. A day can hold several outfits. In Settings you choose how many past times to check and which categories count (e.g. tops, bottoms, dresses).
- **Your data:** export a copy of your whole closet as a file, clear your closet, sign out, or delete your account, all from Settings.
- **Local Persistence:** Everything — closet, schedule, saved outfits, location — is saved in the browser's local storage. No account or server needed.

---

## 🛠️ Project Structure

- `index.html` — App markup: header/nav, the Planner (calendar + planning panel), Closet, Wear Stats, and the item-edit modal.
- `css/` — `variables.css` (design tokens), `layout.css` (page/header structure), `components.css` (calendar, planning panel, closet, modal styling).
- `js/state.js` — localStorage-backed data access (closet, schedule, saved outfits, location, misc. caches).
- `js/geolocation.js` — resolves and persists the location used for weather/holidays (browser geolocation → manual search → default).
- `js/weather.js` — Open-Meteo daily forecast (up to 16 days out).
- `js/holidays.js` — Hebcal Jewish calendar/candle-lighting lookup for the visible month.
- `js/confirm.js` — the shared "Are you sure?" window and the wording of what deleting a piece affects.
- `js/photo-frame.js` — the move-and-zoom photo framing editor and its geometry.
- `js/closet.js` — closet CRUD, tagging queue, saved-outfit builder.
- `js/calendar.js` — month grid + planning panel rendering and interactions.
- `js/analytics.js` — Wear Stats view.
- `js/navigation.js` — tab switching.
- `js/app.js` — applies your settings once you're signed in: fetches location → weather / holidays only for what's switched on.
- `js/settings.js` — the Settings page (location, switches, credits).
- `js/calendars.js` — public holidays (Nager.Date), Christian holidays and the Hijri calendar.
- `js/repeats.js` — the repeat-warning logic (pure functions, no page access).

---

## 🚀 Getting Started

1. Open `index.html` locally in any modern browser, or serve the folder with any static file server (e.g. `npx serve .`).
2. Allow (or deny) the location prompt after you sign in, or open **Settings** and type a city.
3. Click **"+ Add clothes"** and choose **Upload a photo** or **Take a photo** (phone camera, or webcam on a laptop), then tag each one (category, occasion, season, color) — the header's "N to tag" pill tracks what's left.
4. Click any day on the calendar and use the Planning panel to apply a saved outfit or add single pieces.
5. Build reusable outfits in the Closet tab's "Saved Outfits" section.
