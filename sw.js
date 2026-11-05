"use strict";

const CACHE_NAME = "itten-static-v4";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(key =>
            key.startsWith("itten-static-") &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  const scopePath = new URL(
    self.registration.scope
  ).pathname;

  if (!url.pathname.startsWith(scopePath)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (
          response.ok &&
          response.type === "basic"
        ) {
          await cache.put(
            request,
            response.clone()
          );
        }

        return response;
      } catch {
        if (request.mode === "navigate") {
          const fallback = await cache.match(
            "./index.html"
          );

          if (fallback) return fallback;
        }

        return Response.error();
      }
    })()
  );
});
