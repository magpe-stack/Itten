
"use strict";

const CACHE_NAME = "itten-static-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

// Instalação atômica: só ativa o cache quando
// todos os recursos essenciais estiverem disponíveis.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Remove versões antigas para evitar arquivos incompatíveis.
self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key => key.startsWith("itten-static-") &&
                         key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// Cache-first para arquivos locais.
// Arquivos externos não são armazenados nem interceptados.
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (!url.pathname.startsWith(
    new URL(self.registration.scope).pathname
  )) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);

      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }

        return response;
      } catch (error) {
        if (request.mode === "navigate") {
          const fallback = await caches.match("./index.html");
          if (fallback) return fallback;
        }

        return Response.error();
      }
    })()
  );
});
