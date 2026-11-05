
"use strict";

/*
 * ITTEN — LABORATÓRIO CROMÁTICO
 * Service Worker — Versão 3
 *
 * Atualização:
 * - Compatibilidade com a abertura cinematográfica.
 * - Renovação do cache dos arquivos HTML, CSS e JS.
 * - Funcionamento offline preservado.
 * - Exclusão automática de caches antigos do Itten.
 */

const CACHE_NAME = "itten-static-v3";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// INSTALAÇÃO
// Armazena os recursos essenciais antes da ativação.
// Uma falha no download impede a instalação incompleta.

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ATIVAÇÃO
// Remove caches antigos pertencentes ao Itten
// e permite que a nova versão controle as páginas.

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

// INTERCEPTAÇÃO DE REQUISIÇÕES
// Utiliza cache-first para recursos locais.
// Caso não exista uma cópia armazenada,
// tenta buscar o recurso pela rede.

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Não interceptar recursos externos.
  if (url.origin !== self.location.origin) return;

  // Restringir a atuação ao escopo do aplicativo.
  const scopePath = new URL(
    self.registration.scope
  ).pathname;

  if (!url.pathname.startsWith(scopePath)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Procurar primeiro no cache atual.
      const cached = await cache.match(request);

      if (cached) return cached;

      try {
        // Buscar recurso ainda não armazenado.
        const response = await fetch(request);

        // Armazenar respostas locais válidas.
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

      } catch (error) {

        // Se a navegação falhar offline,
        // apresentar a página principal armazenada.
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
