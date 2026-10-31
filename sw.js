// sw.js - 홈 화면에 설치한 앱이 인터넷이 불안정해도 열리게 하는 최소한의 서비스 워커
//
// - 항상 네트워크를 먼저 시도하고(그래서 업데이트가 바로 반영됨), 실패했을 때만 저장해 둔 사본을 보여줌
// - /api/ (AI·동기화·받아쓰기)는 건드리지 않음. 오디오·외부 사이트 요청도 저장하지 않음
// - 코드를 바꿀 때 CACHE 이름을 올릴 필요 없음 (네트워크 우선이라 항상 최신본으로 덮어씀)

const CACHE = 'ai-tutor-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.headers.has('range')) return; // 오디오·영상 일부 요청
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : undefined)))
  );
});
