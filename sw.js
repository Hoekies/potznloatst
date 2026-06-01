const CACHE_NAME = "potzloats-cache-v69";

// Alleen statische assets worden gecachet (afbeeldingen, manifest)
// JS en CSS worden altijd vers opgehaald zodat updates direct werken
const STATIC_ASSETS = [
  "./assets/icons/favicon.png",
  "./assets/branding/opznloatst.png",
  "./assets/branding/potznloatst_donker.png",
  "./assets/branding/potznloatst_licht.png",
  "./manifest.webmanifest",
];

const JS_CSS_PATTERN = /\.(js|css)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  const isNavigation = request.mode === "navigate";
  const isJsOrCss = JS_CSS_PATTERN.test(requestUrl.pathname);

  // HTML, JS en CSS: altijd vers ophalen van de server (network-first)
  // Zo worden code-updates direct zichtbaar na een gewone F5
  if (isNavigation || isJsOrCss) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && !isJsOrCss) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Statische assets (afbeeldingen, manifest): cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }

          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
