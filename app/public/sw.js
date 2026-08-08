/* MoMo›Me service worker — enables installability + an offline app shell, WITHOUT
   ever caching money data. Deliberately conservative for a payments app:
   - /api/*        → network only (never cached; balances/quotes/payments stay live)
   - non-GET       → passthrough (mutations never touched)
   - /assets/*     → cache-first (Vite filenames are content-hashed = immutable)
   - navigations   → network-first, cached shell only as an OFFLINE fallback (so a
                     new deploy is always picked up online)
*/
const VERSION = "momome-v1";
const SHELL = ["/", "/favicon.svg", "/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // fonts / 3rd-party → default
  if (url.pathname.startsWith("/api/")) return;        // live money data → always network

  if (url.pathname.startsWith("/assets/")) {           // immutable hashed assets
    e.respondWith(
      caches.open(VERSION).then((c) =>
        c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; })),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {                       // pages: fresh online, shell offline
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("/", copy)); return res; })
        .catch(() => caches.match("/")),
    );
  }
});
