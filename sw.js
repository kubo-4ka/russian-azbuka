// オフライン用キャッシュ。ファイルを変更したら VERSION を上げてください。
const VERSION = 'az-v1';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'data.js', 'guide.js',
  'favicon.svg', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts はネット優先・取れたらキャッシュ
  if (url.origin !== location.origin) {
    if (!/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
    e.respondWith(caches.open(VERSION).then((c) => fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => c.match(req))));
    return;
  }
  // 自分のファイルはキャッシュ優先（裏で更新）
  e.respondWith(caches.open(VERSION).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});
