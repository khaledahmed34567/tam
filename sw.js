/* Minimal service worker — only exists so the browser considers this
   admin panel "installable" as an app. It does not cache or intercept
   anything, so it never changes the app's existing behavior. */
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { self.clients.claim(); });
self.addEventListener("fetch", (e) => { /* pass-through, no caching */ });
