// Offline-first service worker: the app shell comes from the cache (instant open, works offline)
// and refreshes in the background. Bump VERSION when you change files so phones pick up the update.
const VERSION = 'horizon-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const fonts = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !fonts) return; // Google sign-in and Calendar API always go to the network
  if (req.mode === 'navigate') { // any page load → the cached app
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    e.waitUntil(refresh(new Request('index.html')));
    return;
  }
  // stale-while-revalidate: answer from cache, update it in the background
  e.respondWith(caches.match(req).then(hit => {
    const net = refresh(req);
    return hit || net;
  }));
});
function refresh(req) {
  return fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req));
}

// Notification buttons: hand the action to the open app, or open it with the action in the URL.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = (e.notification.data && e.notification.data.id) || '';
  const act = e.action || 'open';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    if (cs[0]) { cs[0].postMessage({ act, id }); return cs[0].focus(); }
    return self.clients.openWindow(`./?act=${act}&id=${encodeURIComponent(id)}`);
  }));
});
