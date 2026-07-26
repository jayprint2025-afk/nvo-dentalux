// sw.js — no intercepta API ni métodos no-GET
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const isWrite = req.method !== 'GET';
  const isAPI = url.pathname.startsWith('/api/') || url.origin.includes('localhost:4001');
  if (isWrite || isAPI) return;      // dejar pasar PUT/POST/PATCH/DELETE y la API
  event.respondWith(fetch(req));     // passthrough para lo demás
});
