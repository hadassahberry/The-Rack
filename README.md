# Handoff: The Rack — Wardrobe Planner

## Overview
The Rack is a wardrobe-planning app for an Orthodox Jewish audience: upload every piece of clothing, plan outfits up to a month ahead on a calendar, and get notified when an item is planned again before its per-item "rest days" window has passed. The planner is Shabbos/Yom Tov–aware: Fridays show candle-lighting times, Yom Tov and fast days are labeled on the calendar, and notifications pause on Shabbos and Yom Tov.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing intended look and behavior, not production code to copy directly. The task is to **recreate this design in your production stack** (recommended below: React + AWS Amplify) using its established patterns. `The Rack.dc.html` contains the full template (markup + inline styles) and application logic (a `Component` class near the bottom of the file) — every color, spacing value, and behavior can be read from it directly.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interactions are final. Recreate pixel-perfectly.

## Recommended AWS Amplify Architecture
The prototype keeps all state in browser memory. Production migration:

| Prototype | Production (Amplify Gen 2) |
| --- | --- |
| In-memory `items` array | **Amplify Data** (DynamoDB): `Item` model — name, category, season, occasion, wearCount, lastWorn, restDays, photoKey, tagged, ownerId |
| In-memory `plan` map (dateISO → itemIds) | `PlanEntry` model — date, itemIds[], ownerId |
| `<image-slot>` photo drops | **Amplify Storage** (S3) — upload photo, store key on Item |
| No accounts | **Amplify Auth** (Cognito) — email or social sign-in; all models owner-scoped |
| In-app toast "notifications" | **SNS/Pinpoint** push + scheduled Lambda that checks tomorrow's plan each evening; suppress sends on Shabbos/Yom Tov (query Hebcal, see APIs) |
| Hosting | **Amplify Hosting** connected to the GitHub repo |

## Live APIs (already wired in the prototype — keep them)
- **Geocoding**: `https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=en` (free, no key)
- **Weather**: `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&daily=weather_code,temperature_2m_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=16` (free, no key; 16-day max)
- **Zmanim/luach**: `https://www.hebcal.com/hebcal?v=1&cfg=json&year={y}&maj=on&min=on&mod=off&nx=off&ss=off&mf=off&c=on&b=18&M=on&geo=pos&latitude=..&longitude=..&tzid=..` (free, no key). Items: `category:"candles"` → candle-lighting datetime; `category:"holiday"` with `yomtov:true` → Yom Tov; title starting "Erev" → erev day; `subcat:"fast"` → fast day.
- Weather-code → icon mapping: 0–1 sun, 2–48 cloud, 71–77/85–86 snow, everything else rain.

## Screens / Views
Single-page app, three views behind a top nav, plus a modal.

### 1. Top nav (all views)
- Brand: 26px raspberry circle + "The Rack" in Caprasimo 18px.
- View tabs (Planner / Closet / Wear stats): pill buttons, 14px, active = surface-color fill, inactive = 62%-opacity text. `white-space:nowrap`.
- Right: neutral tag showing untagged count ("2 to tag" / "All tagged"), then primary button "+ Add clothes".

### 2. Planner (default view)
- Header row: ‹ › month arrows (30px icon buttons), month title (h2, Caprasimo 32px), muted note "Notifications pause on Shabbos & Yom Tov.", and right-aligned location field: 15px map-pin icon (Lucide, stroke 2.75) + free-text city input (pill, 170px, datalist suggestions). Commit on Enter/blur → geocode → reload weather + luach.
- Weekday header: SUN–SAT, 10px uppercase, letter-spacing .1em, 50% opacity.
- Month grid: 7 columns, 5 rows, `grid-auto-rows:minmax(94px,1fr)`, 8px gap; the planner pane scrolls if short.
- Day cell (button, radius 16px, padding 7px 8px, flex column, gap 4px, overflow hidden):
  - Optional holy note at top: 9px uppercase, 600 weight, plum-700, ellipsized. Content: Yom Tov/fast name, "🕯 {candle time}" on Fridays, "Shabbos" on Saturdays.
  - Number row: day number (Caprasimo 14px; accent-700 if today) + weather "☀ 84°" (10px, 45% opacity) right-aligned.
  - Up to 2 planned-item chips: 7px color dot + name, 10.5px/14px, `flex:none`, nowrap ellipsis; chip text turns accent-700 when the item violates its rest rule that day. Then "+N more" (10px/13px, flex none) if >2.
  - Backgrounds: selected = accent-100 with 2px accent border; Shabbos/Yom Tov = accent-2-200 (lavender tint); in-month = surface; out-of-month = transparent at 35% opacity.
- Right panel (352px, surface fill, radius ~32px, padding 20px, scrolls):
  - Kicker "PLANNING", selected date (h3), weather line ("☀ 84° · clear and warm" or "Forecast covers the next 16 days").
  - Holy pill when relevant: lavender pill, e.g. "Erev Shabbos · candles 8:05 PM", "Rosh Hashana I — Yom Tov, notifications paused".
  - Planned items: pill rows (bg-color fill, 16px dot, name, amber "3d gap" warning pill when in conflict, × remove button). Dashed empty state "Nothing planned yet".
  - "Saved outfits": secondary pill buttons (Studio casual / Rainy commute / Dinner out) that add a set of items at once.
  - "Add a single piece": category filter pills, then 2-col grid of item tiles (dot + name + meta line "worn 2d ago · rest 7" in accent-700 when conflicting, "rested", or "planned" at 50% opacity when already added). Conflicting tiles get a 1.5px accent-300 border.

### 3. Closet
- h2 "Your closet" + count line. Category filter pills (All / Tops / Bottoms / Outerwear / Shoes / Dresses / Accessories / Untagged); active = accent fill, white text.
- Card grid `repeat(auto-fill, minmax(196px,1fr))`, 18px gap. Each card (surface, radius ~32px, padding 10px):
  - 3:4 photo drop zone (radius 16px, neutral-200 placeholder) with corner badge: "Needs tags" (dark fill) or "Resting" (accent-200/accent-800) when last worn < rest days ago.
  - Name (Caprasimo 15px), sub line "Tops · worn 18× · 2 days ago" (11px muted).
  - Tags: season (lavender tag), occasion (neutral tag), 10px.
  - Rest-rule row: pill (bg fill) "Rest 7 days" + − / + 24px stepper buttons (0–60 days, per item).

### 4. Wear stats
- Summary cards (min 172px): kicker label, Caprasimo 34px value, 11px note — Pieces / Days planned / Avg rest rule / Never worn.
- "Worn the most": 6 rows — name (118px), progress bar (16px tall pill track neutral-200, accent fill proportional to max), count "63×".
- "Neglected — give these a turn": 5 pill rows — color dot, name, "34 days ago" / "never worn".

### 5. Add-clothes modal
- Standard dialog over 50% scrim: kicker "NEW PIECE", title "Add to your closet", body "Snap it now, tag it later — untagged pieces sit in a queue on your closet."
- Segmented control: **Photo** (default) | **Store link**.
- Photo tab: 150px 3:4 drop zone + name input (optional) + "Rest days before repeat" slider (0–30, accent) with live "7 days" readout + hint "You'll get a notification if you plan it again sooner."
- Store link tab: URL input + primary "Pull" button → shows pulled-product preview row (74×96 image, product name, "Sage · cotton blend · from {domain}", lavender tag "Image + details pulled"). In production, fetch the product page's og:image/og:title server-side (Lambda) — the prototype mocks this.
- Actions: Cancel (secondary) / Save to closet (primary). Saving without name/link creates an "Untitled piece" in the Untagged queue.

### 6. Notification toast
- Fixed top-right (below nav, top 72px, width 352px), slide-down 220ms ease-out, auto-dismiss 6s, × to close.
- neutral-100 fill, radius ~28px, shadow-lg, 1px divider border. 26px round icon: accent fill + "!" for warnings, sage/plum accent-2 + "✓" for confirmations. Title Caprasimo 14px, body 12px at 80%.
- Warning copy pattern: "Too soon to repeat — {item} was worn {n} days away — you asked for {rest} days of rest."
- **Suppressed entirely when today is Shabbos or Yom Tov.**

## Interactions & Behavior
- Rest-rule conflict check: for item + target date, scan lastWorn and every other planned date; conflict if any gap < item.restDays. Warn (toast + badges) but never block — the user can always plan anyway.
- Adding an item already planned that day is a no-op. Applying a saved outfit adds each item with individual conflict checks.
- Month arrows page viewM/viewY; luach data lazy-loads per year; plans persist across months.
- Location change: geocode → update label ("Austin, Texas"), forecast, candle times, holidays. Unknown city → warning toast, revert.
- All buttons use themed hover/active states from the accent ramp; focus = 2px accent `:focus-visible` ring.

## State Management
`view, items[], plan{}, sel, viewY/viewM, cat, pickerCat, toast, modal, tab, link, linkFetched, draftName, draftRest, location, locationDraft, geo{lat,lon,tz}, wx{dateISO→{t,code}}, luach{dateISO→{name,type}}, candles{dateISO→time}`. In production: items/plan move to Amplify Data with optimistic updates; wx/luach/candles stay client-side caches.

## Design Tokens
Based on the "Organic" design system (`_ds/…/styles.css` in the repo) with a re-tuned palette (the `:root` override at the top of `The Rack.dc.html`):
- Ground `--color-bg #f8edea` (rosewater), surface `#f1dcd7`, text `#26191d`
- Accent (raspberry rose) `#b95877`; ramp 100–900: `#ffeff4 #ffdbe7 #f7bccf #e396b2 #cc7494 #ad5677 #883f5c #612b42 #3e1c2b`
- Accent-2 (soft plum) `#8d7ba0`; ramp: `#f6f0fb #e9def4 #d5c4e5 #b8a3cd #9a85b1 #7d6994 #5f4e73 #443853 #2c2436`
- Neutral ramp: `#faf3f1 #f1e5e2 #e0cfcc #c5b0ae #a6918f #877372 #685758 #4a3d3f #302629`
- Type: **Caprasimo** (headings, weight 400) over **Figtree** (body), via Google Fonts
- Spacing: 4.4 / 8.8 / 13.2 / 17.6 / 26.4 / 35.2 px; radii 8 / 16 / 28 px (cards ×1.15; buttons/inputs/tags = 999px pills)
- Shadows: `0 1px 2px`, `0 3px 10px`, `0 12px 32px` of `#302629` at 14/16/22%
- Icons: Lucide, stroke-width 2.75

## Assets
No bundled imagery — clothing photos are user-uploaded (S3 in production). The map-pin icon is inline Lucide SVG. Item color dots use ramp tokens.

## Files
- `The Rack.dc.html` — the complete prototype (template + logic + palette override)
- `image-slot.js` — drag-and-drop photo placeholder used by closet cards and the add modal (replace with a real uploader in production)
- `_ds/organic-…/styles.css` — base design-system tokens and component classes (buttons, tags, cards, dialog, nav, forms)
