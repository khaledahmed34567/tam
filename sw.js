/* Minimal service worker — only exists to satisfy installability requirements
   (Chrome/Edge/Android "Install app"). It caches the small app shell so the
   panel still opens (to the login/boot screen) if you're briefly offline,
   but every Firebase/Firestore request always goes straight to the network —
   this is an admin dashboard, so data must never be served stale. */

const CACHE_NAME = "omar-tareeq-admin-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept anything but our own same-origin static app shell files —
  // Firebase Auth/Firestore/Storage calls (and fonts) must always hit the network.
  if (url.origin !== self.location.origin){
    return;
  }

  const isShellFile = APP_SHELL.some((p) => url.pathname.endsWith(p.replace("./", "/")) || url.pathname === "/" );

  if (event.request.method !== "GET" || !isShellFile){
    return; // let the browser handle it normally (network)
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
