// Minimal network-first service worker (M2 stub, V5). Online: always the network, and a copy is kept; offline: the last copy.
// V6 (26.10): every same-origin request is REVALIDATED (cache:'no-cache': a conditional request, a 304 costs no body). The host sends JS/CSS with max-age=3600, and a plain fetch(req) in a
// service worker goes through the browser's HTTP cache, so a visitor who loaded the previous version less than an hour ago got a MIX of old and new modules («Не се зарежда»).
// The page that is open while the new worker takes over may still hold a mix (it was loaded under the old worker); the next load is clean. (A forced reload from the worker, WindowClient.navigate, was tried: it hangs
// on a URL with a #fragment, so it is not used.)
// The full offline strategy (versioned precache, data refresh, update prompt) arrives in milestone M6.
const CACHE = 'bns-v5-11';   // v5: its own cache name (never serves v4 or the July data of an older build); the old cache is deleted on activate
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: false });
      if (hit) return hit;
      throw err;
    }
  })());
});
