// Offline cache for Tengen. Network-first so code updates always show on
// reload when online, with a cache fallback when offline / on the home screen.
const CACHE = "tengen-v10";
const ASSETS = [
  "./", "./index.html", "./styles.css",
  "./js/app.js", "./js/engine.js", "./js/ai.js",
  "./js/transport.js", "./js/config.js",
  "./manifest.webmanifest", "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Network-first: always try the network and refresh the cache; fall back to
  // the cached copy (then the app shell) only when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
