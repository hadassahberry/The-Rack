# Server side of "Add from a link"

The Rack is otherwise a static site plus Firestore, with no server of its own. Reading a product page
and copying its photo **needs a server**: a browser is not allowed to read most other websites' pages
or copy their pictures (a check against this showed it working for some stores and failing for others,
depending on each store's settings, so it can't be relied on). This folder is that server: one
Firebase **callable Cloud Function**, `importProduct`.

**Nothing in this folder is deployed yet, and nothing here turns on a paid service.** The "Add from a
link" button stays hidden in the app until you finish the steps below.

## What it costs, and what you have to turn on

Cloud Functions needs the Firebase **Blaze (pay as you go) plan**. That means attaching a billing
account (a card) to the project `the-rack-5787`. Blaze has a monthly free allowance for Cloud Functions
(at the time of writing: about 2 million calls, 400,000 GB-seconds and 200,000 GHz-seconds of compute,
and 5 GB of outbound data a month; **check the current numbers on Firebase's pricing page**, I could
not verify them from here). One import is two or three short calls (look at the page, then fetch the
chosen photo), each a second or two at 256 MB, so personal use should stay inside the free allowance.

Things that can still cost a little, or that you should do first:
- **Set a budget alert** in Google Cloud Billing (for example at $1 and $5) before deploying.
- Deploying builds a container image that is kept in Artifact Registry; storage beyond the free
  amount is billed (cents per GB per month). Old images can be cleaned up.
- `maxInstances: 5` in `index.js` limits how many copies can run at once, which caps both cost and abuse.
- A per-person limit of 20 requests a minute is built in.

If you would rather not use Blaze, the same code (`lib/`) could be run on another host's free tier
(for example a small serverless function elsewhere); that would need a different thin wrapper and its
own sign-in check. Say so and I can write one.

## Setup (when you decide to)

1. Upgrade the project to Blaze and add a budget alert (above).
2. `cd functions && npm install`
3. `firebase login`, then from the project folder: `firebase deploy --only functions`
   (the GitHub Action that deploys the website does **not** deploy functions, so pushing code never
   deploys this by accident).
4. In `js/features.js` set `linkImport: true`, commit and push. The "Add from a link" item then appears
   in the "+ Add clothes" menu.
5. To switch it off again: set the flag back to `false` (hides the button), and/or
   `firebase functions:delete importProduct`.

Run the tests any time with `npm test` inside `functions/` (they use only Node itself and a local
fake "internet"; no network, no account).

## What it will and won't do

It looks at **public** product pages. It cannot import from pages that need a login, from stores that
block automatic access (many large stores do), or from pages that build their content only in the
browser with no product data in the HTML. In those cases the app says so plainly and offers
**Upload a photo**, keeping the link you pasted. It never promises every store works.

## Safety rules it enforces (all in `lib/`, all tested)

- Only `http` / `https`, on the normal ports 80 / 443, no username or password in the address,
  no IP-address hosts, no `localhost` or internal-looking names.
- The host name is looked up once and **every** address must be public (not private, loopback,
  link-local, shared, reserved or multicast, including IPv4 hidden inside IPv6). The connection is then
  made to that checked address, so a site that answers differently the second time can't redirect us
  into a private network.
- Every redirect goes through the same checks (at most 5).
- Page limit 2 MB, photo limit 4 MB, counted on bytes actually received (so a compressed "bomb" is cut
  off), a 12-second overall limit, and the content type is checked before reading. A photo must really
  be a JPEG, PNG, GIF, WebP or AVIF by its bytes; SVG and anything else is refused.
- Preview photos are shown by the person's own browser, so only `https` photo addresses on public hosts
  are offered; the chosen photo is then fetched by the server and saved **inside the item** (like every
  upload), so it never depends on the store afterwards.
- Only signed-in people can call it (Firebase checks the token). No cookies or credentials are ever sent
  to other sites. Logs contain only the host name and a short reason, never a full address, credentials,
  or page contents.

Not covered (worth knowing): the function can be asked for any public photo address by a signed-in
person, so in principle it can fetch any public picture up to 4 MB, within the rate limit. Sites also
change their pages, so an import that works today can stop working later.

---

# The visual check for "Help me choose" (`judgeOutfits`)

The rule-based "Help me choose" (`js/outfit-suggest.js`) only sees metadata (colour, warmth, formality, recency),
so it can pair a striped shirt with a plaid skirt. `judgeOutfits` is a second callable function that asks a
**vision model (Google Gemini)** to *look at the photos* of the pieces in each candidate outfit and say whether
they go together (patterns, colours, formality, proportions, overall look). The app uses the verdicts to drop or
push down outfits that clash and to break ties; the rules still choose the candidates.

**Nothing here is deployed, and the feature is OFF.** `RACK_FEATURES.visionCheck` in `js/features.js` is `false`,
so "Help me choose" works exactly as before and nothing is ever sent anywhere, until you finish the steps below.

## How it works

1. You press **Help me choose**. The rules pick up to five candidate outfits from pieces you own.
2. The app makes **one** call: it sends small copies (about 320 px, a few KB each) of the photos of the pieces in
   those candidates (each piece once), their names and kinds, and one line about the day ("Teaching; 52F high, rain").
   Nothing else: no account details, no rest of the closet, no history.
3. The function checks the request (real pictures only, decided from their bytes; size and count limits), asks
   Gemini for a JSON verdict per outfit (`score` 0-10, `clash` true/false, a short reason), cleans the reply and
   returns it. A score of 4 or less counts as a clash.
4. The app drops clashing outfits (or, if too few are left, shows the least bad ones marked "may not look right
   together"), orders the rest by the rules' score with the vision score deciding ties, and shows the top 2-3.
5. **If anything goes wrong** (off, offline, slow, busy, not set up, an unusable reply) the rules' ranking is shown
   as always, with a line saying the visual check was unavailable. Verdicts are remembered while the panel is open,
   so "Warmer", "More casual" etc. only send *new* candidates, and re-showing the same ones sends nothing.

The panel tells the person what is sent: "photos of the pieces in these ideas are sent to Google's Gemini AI, only
when you press Help me choose; on Google's free tier Google may use them to improve its products."

## Where the key lives

The Gemini API key is a **Firebase secret** (Google Secret Manager), named `GEMINI_API_KEY`. It is read only by the
function at run time, sent to Google in a request header, and never put in the app, the repository, a log or a reply
(there is a test for each). The model is a parameter, `GEMINI_MODEL` (default `gemini-3.5-flash-lite`, set in
`index.js`), so it can be changed without editing code.

## API and free tier (checked 2026-11-20, from Google's own pages)

- **Model:** `gemini-3.5-flash-lite` is listed on Google's pricing page with a **Free tier** for text and image
  input ("Free of charge"); `gemini-3.6-flash` and `gemini-3.8-flash` also show a free tier. The REST endpoint is
  `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` with the key in the
  `x-goog-api-key` header. *I could not run a real call from here, so the request shape follows Google's published
  REST pattern but has only been tested against a fake. Make one real call before relying on it.*
- **Limits:** Google does **not** publish the free-tier request limits for these models on its public pages; they are
  shown per project in Google AI Studio and "are not guaranteed". Forum posts reported about 20 requests a day for
  a full Flash model and about 500 a day for Flash-Lite (unofficial; check AI Studio). Limits are **per project, not
  per person**, so they are shared by everyone who uses the app. The app is built for that: one call per tap,
  verdicts cached, its own per-person limit (6 a minute, 80 a day per running copy), and the rules' ranking is shown
  whenever Google says "busy" (HTTP 429).
- **Privacy on the free tier:** Google's pricing page says free-tier content **is used to improve Google's products**
  (paid tier: not). Photos of clothes are sent, so the privacy page (`privacy.html`) must say so before this is
  switched on. I did not edit it: it is legal text that is yours to approve.
- **EEA / UK / Switzerland (corrected 2026-11-22):** the earlier line here, "no restriction", was wrong. Google's
  Gemini API Additional Terms (effective March 23, 2026) say you "may use only Paid Services when making API Clients
  available to users in the European Economic Area, Switzerland, or the United Kingdom". The free tier therefore cannot
  be used for those users. The same terms require developers to be 18 or older and say an API client must not be
  "directed towards or likely to be accessed by individuals under the age of 18". Read the current terms before
  switching this on (see the investigation notes in the project history, 2026-11-22).

## What it costs and the limits

- **Gemini:** free tier, no card needed for the API key (create one in Google AI Studio). Expected use: one call per
  "Help me choose" tap (plus one per tap that shows *different* candidates), roughly 10-30 KB per photo and 4-8
  photos per call. A person using it a few times a day makes a few calls a day.
- **Firebase function:** Cloud Functions needs the **Blaze plan** (a billing account on the project), even though
  Blaze includes a monthly free allowance (about 2 million calls, 400,000 GB-seconds, 200,000 CPU-seconds, 5 GB
  outbound; **check Firebase's pricing page**). A check is one call lasting a few seconds at 256 MB, so personal use
  is far inside that. `maxInstances: 2` caps cost and abuse. Secret Manager's free allowance covers a couple of secret
  versions; deployed images sit in Artifact Registry (cents per GB beyond the free amount).
- **So "free" means free in practice, but not free of a billing account.** Set a budget alert (for example $1)
  first. If you would rather not add a billing account, the same `lib/outfit-judge.js` could run on another free host.

## Setup (when you decide to)

1. Upgrade the project to Blaze and add a budget alert.
2. Create a key in Google AI Studio (free tier). Then, from the project folder:
   `firebase functions:secrets:set GEMINI_API_KEY` (paste the key when asked).
3. `cd functions && npm install`, then `firebase deploy --only functions:judgeOutfits`
   (the GitHub Action that deploys the website never deploys functions).
4. Make one real call and confirm it answers (if the model name has changed, set `GEMINI_MODEL`).
5. Update `privacy.html` to say photos of pieces are sent to Google's Gemini API when the person uses Help me choose.
6. In `js/features.js` set `visionCheck: true`, commit and push.
7. To switch it off: set the flag back to `false` (nothing is sent), and/or `firebase functions:delete judgeOutfits`.

Tests: `npm test` in `functions/` (the model call is faked); the app side is `tests/outfit-vision.test.js`.
