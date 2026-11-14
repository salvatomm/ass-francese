// Offline-first service worker. tools/build.py rewrites VERSION whenever any app file or content
// changes, so a deploy always installs a fresh cache (no stale app forever).
const VERSION = '630f3e626739';
const CACHE = `francese-${VERSION}`;
const ASSETS = ['./', 'index.html', 'app.js', 'core.js', 'db.js', 'sync.js', 'style.css',
  'manifest.webmanifest', 'content/bundle.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('francese-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase etc. go to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true })
      || (e.request.mode === 'navigate' && await cache.match('index.html'));
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return new Response('Offline', { status: 503 });
    }
  })());
});
