/* JARVIS Service Worker — WhatsApp push + deep link */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : 'Nuevo mensaje' }; }

  const phone = String(data.phone || '');
  const title = data.title || 'JARVIS · WhatsApp';
  const url = data.url || `/?jarvis=whatsapp${phone ? `&phone=${encodeURIComponent(phone)}` : ''}`;
  const options = {
    body: data.body || 'Nuevo mensaje de WhatsApp',
    tag: data.tag || `jarvis-wa-${phone || Date.now()}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [250, 100, 250, 100, 350],
    timestamp: Date.now(),
    actions: [{ action: 'open', title: 'Abrir mensaje' }],
    data: { url, phone, channel: data.channel || 'JARVIS-WA-001' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || '/?jarvis=whatsapp', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('navigate' in client) await client.navigate(target);
      if ('focus' in client) return client.focus();
    }
    return clients.openWindow(target);
  })());
});
