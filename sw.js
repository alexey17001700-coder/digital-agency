self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    // Удаляем все старые кэши при обновлении
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.map(key => caches.delete(key)));
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Всегда идем в сеть, игнорируя кэш браузера
    e.respondWith(
        fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
    );
});
