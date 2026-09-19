/* JARVIS Service Worker — notificaciones en segundo plano */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : 'Nuevo mensaje' }; }
  const title = data.title || 'JARVIS';
  const options = {
    body: data.body || 'Nuevo mensaje',
    tag: data.tag || 'jarvis-notification',
    renotify: true,
    vibrate: [180, 80, 180],
    data: { url: data.url || '/?jarvis=whatsapp', phone: data.phone || '' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/?jarvis=whatsapp', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
