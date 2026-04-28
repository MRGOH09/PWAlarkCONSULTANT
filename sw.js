// Service Worker for PWA
const CACHE_NAME = 'me-education-v2';
const urlsToCache = [
    '/js/gantt.js',
    '/manifest.json'
];

// 安装事件：预缓存静态资源，立即跳过等待
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

// 激活事件：清理旧版本缓存，立即接管所有页面
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

// 获取事件：HTML/导航请求走 network-first，其他走 cache-first
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const isHTML = req.mode === 'navigate' ||
                   (req.headers.get('accept') || '').includes('text/html');

    if (isHTML) {
        event.respondWith(
            fetch(req).then(res => {
                const copy = res.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                return res;
            }).catch(() => caches.match(req))
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(cached => cached || fetch(req))
    );
});
