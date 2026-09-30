// Night Kitchen service worker.
// Goal: the app shell (especially /grocery) opens instantly with zero signal.
// Data is NOT cached here — the grocery page is local-first via localStorage;
// API requests pass straight through so nothing stale ever renders.

// Bumping these purges every older cache on activate (see the activate
// handler) — do it when cached shells from old deploys could bite.
const SHELL_CACHE = "nk-shell-v2";
const ASSET_CACHE = "nk-assets-v2";
const SHELL_PAGES = ["/", "/grocery"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_PAGES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: network only. Offline behavior is the client's job (op queue).
  if (url.pathname.startsWith("/api/")) return;

  // Hashed build assets + icons: cache-first (immutable)
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // Navigations: network-first with cache fallback, so a deploy updates the
  // shell when online but checkout-line dead zones still open the list.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          const hit = await cache.match(request, { ignoreSearch: true });
          if (hit) return hit;
          const grocery = await cache.match("/grocery");
          return grocery ?? cache.match("/");
        }
      })()
    );
  }
});
