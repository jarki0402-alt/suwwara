/// <reference lib="webworker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA shell: since navigation is all in-memory client state (no router), every
// navigation request is served the precached index.html — works offline and
// avoids a separate static "you're offline" dead-end page.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Our own backend's search/trending/details JSON — prefer fresh data; a short
// cache cushions flaky mobile networks. Explicitly excludes /api/audio/*, which is
// deliberately left completely unmatched by any route in this file (see the removed
// audio-cache rule further down for why) so those requests bypass the Service Worker
// entirely and go straight to the network via the browser's own fetch — a
// NetworkFirst's networkTimeoutSeconds cache-fallback logic is not an appropriate
// strategy for a multi-minute streamed audio response either way.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/audio/'),
  new NetworkFirst({
    cacheName: 'music-api',
    networkTimeoutSeconds: 4,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 30 }),
    ],
  }),
);

// LRCLIB lyrics — rarely change once matched, so a longer cache is safe.
registerRoute(
  ({ url }) => url.hostname === 'lrclib.net',
  new NetworkFirst({
    cacheName: 'lrclib-api',
    networkTimeoutSeconds: 4,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

// Audio is deliberately NOT cached/routed through the Service Worker at all (removed
// 2026-09-05, previously a CacheFirst + RangeRequestsPlugin rule here). Two independent,
// hard-to-fully-close failure modes kept surfacing as the exact same user-facing bug
// (seek bar running minutes past a track's real length, no auto-advance — only ever on
// iOS, since Safari and Chrome-iOS share the same WebKit engine and Range-request pattern,
// unaffected on Android/desktop): (1) once a bad response got cached under the old
// 'audio-cache' name — from a since-fixed backend bug where a Range request could get a
// mismatched full-200 response instead of the correct slice — CacheFirst had no reason to
// ever revalidate it, so every client that had ever hit that bug kept serving the same
// broken cached entry indefinitely, regardless of the backend fix; and (2) caching a
// *streamed* multi-minute response at all risks an incomplete/truncated entry if the
// stream is interrupted mid-download (a real risk on constrained connections — see the
// upload-bandwidth discussion for this app's Cloudflare Tunnel deployment), which
// RangeRequestsPlugin can't safely slice from afterwards. The offline-replay convenience
// this gave up was marginal for how this app is actually used (the radio queue's own
// 3-hour repeat cooldown means the same song replaying at all, the only case this cache
// ever helped, is intentionally rare) — not worth this class of bug recurring indefinitely
// in exchange. Every /api/audio/* request now goes straight to the network unconditionally
// (see the exclusion in the /api/ rule above) — the backend's own Range-mismatch fix
// (server/src/routes/audio.ts) is the only thing keeping playback correct now, with
// nothing in front of it that could reintroduce a stale/broken response.

// Album/artist artwork.
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'image-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// Prompt-based update flow: the new SW waits until the client explicitly asks
// it to take over (via the "Muat ulang" toast action in registerSW.ts), rather
// than force-activating and reloading the page without warning.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
