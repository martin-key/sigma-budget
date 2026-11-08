// Minimal network-first service worker (M2 stub, V5). Online: always the network, and a copy is kept; offline: the last copy.
// V6 (26.10): every same-origin request is REVALIDATED (cache:'no-cache': a conditional request, a 304 costs no body). The host sends JS/CSS with max-age=3600, and a plain fetch(req) in a
// service worker goes through the browser's HTTP cache, so a visitor who loaded the previous version less than an hour ago got a MIX of old and new modules («Не се зарежда»).
// The page that is open while the new worker takes over may still hold a mix (it was loaded under the old worker); the next load is clean. (A forced reload from the worker, WindowClient.navigate, was tried: it hangs
// on a URL with a #fragment, so it is not used.)
// The full offline strategy (versioned precache, data refresh, update prompt) arrives in milestone M6.
// V7: every screen is a path (/prihodi). Offline, a page that was never opened falls back to the app shell (/app: app.html, the bare template
// that the build copies from apps/web/public/index.html; the development server answers it with apps/web/public/index.html): the router builds the screen from the address and the copies in the cache. The shell is
// stored on install, so the fallback is there whatever page the visitor landed on (before, landing on /prihodi left /razhodi and / without a copy:
// a network error offline). It is the bare shell, not the start page the server drew, so no other screen's text stands under the address.
const CACHE = 'bns-v7-1';   // its own cache name per address scheme (a v6 copy holds hash-era pages); the old cache is deleted on activate
const START = () => new URL('app', self.registration.scope).href;
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.add(new Request(START(), { cache: 'no-cache' }))).catch(() => {}));   // offline at install: the fallback stays the copies kept below
});
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
      if (req.mode === 'navigate') {
        const shell = (await caches.match(req, { ignoreSearch: true })) || (await caches.match(START()));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
