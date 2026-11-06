// Registers the service worker (see /sw.js) so the app can be installed and
// opens offline. Only on http(s): inside a native app wrapper the files are
// already bundled on the device and this simply does nothing.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.warn('Offline support unavailable:', err);
        });
    });
}
