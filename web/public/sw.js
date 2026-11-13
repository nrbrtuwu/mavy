// Mávy service worker.
//   Static files: cache first (precached on install).
//   API (GET /api/*): network first; when the network fails, the last saved
//   response is returned with headers x-mavy-offline: 1 and x-mavy-saved-at.
//
// The server replaces the BUILD line with the real file list and a content hash,
// so every change in public/ installs a fresh static cache automatically.

const BUILD = { version: 'dev', files: ['./', 'index.html', 'app.js', 'format.js', 'style.css', 'manifest.webmanifest'] }; // @build

const STATIC_CACHE = `mavy-static-${BUILD.version}`;
const API_CACHE = 'mavy-api-v1';
const API_MAX_ENTRIES = 60;
const NETWORK_TIMEOUT_MS = 8000;

const scopePath = new URL(self.registration.scope).pathname;
const apiPrefix = `${scopePath}api/`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(BUILD.files.map((f) => new Request(f, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('mavy-static-') && key !== STATIC_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(apiPrefix)) {
    if (url.pathname === `${apiPrefix}health`) return; // always live
    event.respondWith(networkFirst(req));
  } else if (req.mode === 'navigate') {
    // Single page app with hash routes: the start page is the cached app shell.
    // Other pages (e.g. /login of the optional password gate) go to the network.
    if (url.pathname === scopePath || url.pathname === `${scopePath}index.html`) {
      event.respondWith(cacheFirst(new Request(scopePath)));
    }
  } else {
    event.respondWith(cacheFirst(req));
  }
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  return hit ?? fetch(req);
}

function fetchWithTimeout(req) {
  const timeout = AbortSignal.timeout(NETWORK_TIMEOUT_MS);
  const signal = AbortSignal.any ? AbortSignal.any([req.signal, timeout]) : timeout;
  return fetch(req, { signal });
}

async function networkFirst(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetchWithTimeout(req);
    if (res.ok) await save(cache, req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('x-mavy-offline', '1');
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-mavy-offline': '1' },
    });
  }
}

/** Store a response with its save time; keep only the newest API_MAX_ENTRIES. */
async function save(cache, req, res) {
  const headers = new Headers(res.headers);
  headers.set('x-mavy-saved-at', new Date().toISOString());
  const stamped = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
  await cache.delete(req); // re-insert so key order = age
  await cache.put(req, stamped);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - API_MAX_ENTRIES))) await cache.delete(old);
}
