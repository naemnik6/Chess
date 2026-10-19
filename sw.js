/* =========================================================================
   Сервис-воркер офлайн-режима.
   Регистрируется только когда страница открыта по http(s) (в песочницах и
   на file:// молча не включается). Стратегия:
     • навигация  — сеть прежде всего, при недоступности сети отдаём кэш;
     • ядро и иконки — кэш прежде всего, сеть обновляет кэш;
     • чужиеOrigin — не трогаем (/lichess, шрифты и т.п.).
   Версию меняем вместе со сборкой, чтобы старые кэши выметались.
   ========================================================================= */
const VERSION = 'chesster-2.2-2026-10-15';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './desktop/icons/icon-192.png',
  './desktop/icons/icon-512.png',
  './desktop/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // кэшируем по одному: отсутствие какой-то иконки не должно ронять установку
    for (const url of CORE) {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { /* пропускаем */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // lichess и прочее — мимо

  // навигация: пытаемся сеть, при падении — офлайн-копия приложения
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match('./index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // статика: кэш прежде всего
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(VERSION);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
