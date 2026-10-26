/* Only the explicit public static files in this build may be cached. */
'use strict';
importScripts('./assets/js/offline-manifest.js');

const BUILD = self.TIMER_OFFLINE_BUILD;
const SCOPE = self.registration.scope;
const PREFIX = 'timer-offline:' + encodeURIComponent(SCOPE) + ':';
const CACHE = PREFIX + BUILD.version;
const URLS = BUILD.files.map(file => new URL(file, SCOPE).href);
const ALLOWED = new Set(URLS);
const INDEX = new URL('index.html', SCOPE).href;
let preparing;

function prepareCache() {
    if (preparing) return preparing;
    preparing = (async () => {
        // Fetch all assets before writing any. A failed upgrade leaves the active cache intact.
        const entries = await Promise.all(URLS.map(async url => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            let response, bytes;
            try {
                response = await fetch(url, { cache: 'reload', credentials: 'omit', redirect: 'error', signal: controller.signal });
                if (!response.ok || response.type === 'opaque') throw new Error('Offline resource unavailable');
                bytes = /\.(html|css|js|json)$/.test(url)
                    ? new TextEncoder().encode((await response.clone().text()).replace(/\r\n?/g, '\n'))
                    : await response.clone().arrayBuffer();
            } finally { clearTimeout(timeout); }
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            const relative = BUILD.files[URLS.indexOf(url)];
            if (actual !== BUILD.hashes[relative]) throw new Error('Offline build is not yet complete');
            return [url, response];
        }));
        const cache = await caches.open(CACHE);
        await Promise.all(entries.map(([url, response]) => cache.put(url, response)));
    })().finally(() => { preparing = null; });
    return preparing;
}

self.addEventListener('install', event => {
    // Do not skipWaiting: an update must not replace scripts under an open form.
    event.waitUntil(prepareCache());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET' || request.headers.has('Authorization') || request.headers.has('Range') || request.cache === 'no-store') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.search) return;
    const key = url.href === SCOPE ? INDEX : url.href;
    if (!ALLOWED.has(key)) return; // Includes all API calls, see/, downloads and unknown paths.
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(key)) || fetch(request);
    })());
});

self.addEventListener('message', event => {
    if (!['TIMER_OFFLINE_STATUS', 'TIMER_OFFLINE_REPAIR'].includes(event.data?.type) || !event.ports[0]) return;
    event.waitUntil((async () => {
        if (event.data.type === 'TIMER_OFFLINE_REPAIR') {
            // Explicit retry only. Verify the same public build again; never cache runtime requests.
            try { await prepareCache(); } catch (_) { /* Report the cache's actual state below. */ }
        }
        const cache = await caches.open(CACHE);
        const present = await Promise.all(URLS.map(url => cache.match(url)));
        event.ports[0].postMessage({ type: 'TIMER_OFFLINE_STATUS', ready: present.every(Boolean) });
    })());
});
