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
