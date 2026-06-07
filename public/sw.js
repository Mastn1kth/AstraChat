/**
 * AstraChat Service Worker
 * - Caches static assets for offline use
 * - Passes through API and WS requests uncached
 */

const CACHE_VERSION = 'astrachat-v1'
const STATIC_EXTENSIONS = ['.js', '.css', '.woff2', '.woff', '.svg', '.png', '.webp']

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Never cache API, WS, or cross-origin requests
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws') ||
    url.origin !== self.location.origin ||
    request.method !== 'GET'
  ) {
    return
  }

  // Cache-first for hashed assets (they have content hash in filename)
  const isHashedAsset = STATIC_EXTENSIONS.some((ext) => url.pathname.includes(`.${ext.slice(1)}`))
    && url.pathname.startsWith('/assets/')

  if (isHashedAsset) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone())
            return response
          })
        }),
      ),
    )
    return
  }

  // Network-first for HTML (always get fresh app shell)
  if (request.headers.get('accept')?.includes('text/html') || url.pathname === '/') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/') || caches.match(request)),
    )
  }
})

// Push notification support (placeholder — requires VAPID setup)
self.addEventListener('push', (event) => {
  if (!event.data) return
  try {
    const data = event.data.json()
    event.waitUntil(
      self.registration.showNotification(data.title || 'AstraChat', {
        body: data.body || 'New message',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.chatId || 'astrachat',
        data: { chatId: data.chatId, url: '/' },
      }),
    )
  } catch {
    // Ignore malformed push data
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const chatId = event.notification.data?.chatId
  const targetUrl = chatId ? `/?chat=${chatId}` : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin))
      if (existing) return existing.focus().then((c) => c.postMessage({ type: 'open-chat', chatId }))
      return self.clients.openWindow(targetUrl)
    }),
  )
})
