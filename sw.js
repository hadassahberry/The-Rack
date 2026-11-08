// Service worker: lets the installed app open without a connection.
//
// Strategy is NETWORK-FIRST for this site's own files: when you're online you
// always get the newest version (so a deploy is never hidden behind a stale
// cache), and the copy it saves is only used when the network fails. Requests
// to other sites (Firebase, weather, holidays) are left completely alone.
const CACHE = 'rack-shell-v1';

// Seeds the cache on first install so the very first offline open works.
// Anything else the app loads gets added automatically as it's fetched.
const SHELL = [
    './', 'index.html', 'manifest.webmanifest',
    'css/variables.css', 'css/layout.css', 'css/components.css',
    'js/firebase-config.js', 'js/firebase-init.js', 'js/state.js', 'js/auth.js', 'js/geolocation.js',
    'js/weather.js', 'js/holidays.js', 'js/calendars.js', 'js/view-range.js', 'js/colors.js', 'js/repeats.js', 'js/photo-frame.js', 'js/confirm.js', 'js/category-guess.js', 'js/closet.js', 'js/analytics.js',
    'js/calendar.js', 'js/navigation.js', 'js/settings.js', 'js/account.js', 'js/pwa.js', 'js/app.js',
    'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/logo.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;        // other sites: not ours to cache
    if (url.pathname.startsWith('/__/')) return;            // Firebase's own auth endpoints

    event.respondWith(
        fetch(req)
            .then((res) => {
                // Don't keep URLs with query strings (e.g. password-reset links carry one-time codes).
                if (res.ok && !url.search) {
                    const copy = res.clone();
                    caches.open(CACHE).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(() =>
                caches.match(req).then((cached) =>
                    cached || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())
                )
            )
    );
});
