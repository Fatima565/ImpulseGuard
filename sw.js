const CACHE_NAME = 'impulseguard-v8-mobile';
const ASSETS = [
  '/',
  '/index.html',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

// Install — cache core files
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — only cache GET requests, skip everything else
self.addEventListener('fetch', e => {
  // Skip non-GET requests (POST, PUT, etc)
  if(e.request.method !== 'GET') return;
  
  // Skip chrome-extension and non-http requests
  if(!e.request.url.startsWith('http')) return;
  
  // Skip API calls — never cache these
  const url = e.request.url;
  if(
    url.includes('googleapis.com') ||
    url.includes('openrouter.ai') ||
    url.includes('firestore') ||
    url.includes('firebase') ||
    url.includes('identitytoolkit')
  ) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Only cache valid responses
        if(res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Push notifications
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  self.registration.showNotification(data.title || 'ImpulseGuard 🛡️', {
    body: data.body || 'Check your spending!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});
