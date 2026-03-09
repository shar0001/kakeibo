// =====================================================
// sw.js — Service Worker (PWA オフラインキャッシュ)
// =====================================================
const CACHE_NAME = 'kakeibo-v1';
const STATIC_ASSETS = [
    '/kakeibo/',
    '/kakeibo/index.html',
    '/kakeibo/style.css',
    '/kakeibo/app.js',
    '/kakeibo/supabase-config.js',
    '/kakeibo/supabase-client.js',
    '/kakeibo/manifest.json',
    'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
];

// インストール時にキャッシュ
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] キャッシュを保存中...');
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[SW] 一部キャッシュ失敗:', err);
            });
        })
    );
    self.skipWaiting();
});

// 古いキャッシュを削除
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// フェッチ時: キャッシュ優先、失敗時はネットワーク
self.addEventListener('fetch', (event) => {
    // Supabase APIはキャッシュしない
    if (event.request.url.includes('supabase.co')) return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request)
                .then((response) => {
                    // 成功したレスポンスをキャッシュに追加
                    if (response && response.status === 200 && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // オフライン時: index.htmlにフォールバック
                    if (event.request.destination === 'document') {
                        return caches.match('/kakeibo/index.html');
                    }
                });
        })
    );
});
