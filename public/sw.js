/* SportChat service worker: офлайн-оболочка PWA.
 * Стратегия: сеть в приоритете (данные всегда свежие), кэш — как офлайн-фолбэк
 * для оболочки (index/css/js/иконки). API и WebSocket никогда не кэшируются. */

const VERSION = 'v1';
const CACHE = `sportchat-${VERSION}`;
const CORE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/main.js', '/js/chat.js', '/js/events.js', '/js/profile.js', '/js/feed.js', '/js/stats.js', '/js/livepanel.js', '/js/coupons.js',
  '/js/rail.js', '/js/settings.js', '/js/api.js', '/js/md.js', '/js/util.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;

  // навигация: сеть → при офлайне отдаём оболочку из кэша
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // прочие GET-ресурсы: сеть → кэш (свежесть важнее офлайна)
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && (url.origin === location.origin)) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
