// Network first, cache as fallback: always the latest version when online, still opens offline.
const CACHE = 'intern-diary-v3';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/util.js',
  'js/db.js',
  'js/streak.js',
  'js/poster.js',
  'js/export.js',
  'js/ai.js',
  'js/reminder.js',
  'js/plaza.js',
  'js/config.js',
  'js/sound.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
];
// Libraries loaded on demand (Word export, Claude SDK) come from jsDelivr and are cached after their first use.
const CDN = 'cdn.jsdelivr.net';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && url.hostname !== CDN) return;
  // The app's own files are always revalidated, so after an update the browser never mixes
  // a new module with a stale one from its HTTP cache. CDN files are versioned, so they can stay cached.
  const own = url.origin === self.location.origin;
  event.respondWith(
    (own ? fetch(req.url, { cache: 'no-cache' }) : fetch(req))
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow('./');
    }),
  );
});
