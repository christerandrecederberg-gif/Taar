// Offline-støtte. Henter nyeste versjon fra nett først (så oppdateringer vises med en gang),
// og faller tilbake til lagret kopi når du er uten nett eller nettet er tregt.
const VERSION = 'v12';
const CACHE = `taar-${VERSION}`;
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './logo.svg', './vendor/zxing.min.js',
  './fonts/cormorant-garamond-latin-500-normal.woff2', './fonts/cormorant-garamond-latin-600-normal.woff2',
  './fonts/cormorant-garamond-latin-600-italic.woff2', './fonts/spectral-latin-300-italic.woff2',
  './fonts/spectral-latin-300-normal.woff2', './fonts/inter-latin-300-normal.woff2',
  './fonts/inter-latin-400-normal.woff2', './fonts/inter-latin-600-normal.woff2'];
const NETWORK_TIMEOUT = 3500;

self.addEventListener('install', (e) => {
  // cache: 'reload' hopper over nettleserens HTTP-mellomlager, så vi ikke lagrer en gammel fil.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Fonter, bilder og skannerbiblioteket endres ikke mellom versjoner: bruk lagret kopi direkte.
  if (/\.(woff2|png|svg)$/.test(url.pathname) || url.pathname.endsWith('zxing.min.js')) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    network.catch(() => {});
    try {
      const res = await Promise.race([network, new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT))]);
      if (res) return res;
    } catch (err) { /* uten nett */ }
    const cached = await cache.match(e.request, { ignoreSearch: true });
    return cached || network;
  })());
});
