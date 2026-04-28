// Service Worker for PWA
const CACHE_NAME = 'me-education-v1';
const urlsToCache = [
    '/',
    '/js/app.js',
    '/manifest.json'
];

// 安装事件
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

// 获取事件
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // 如果缓存中有响应，返回缓存的版本
                if (response) {
                    return response;
                }
                return fetch(event.request);
            }
        )
    );
});