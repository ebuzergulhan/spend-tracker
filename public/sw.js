// Minimal service worker — makes the app installable as a PWA.
// No aggressive caching so finance data is always fresh from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
