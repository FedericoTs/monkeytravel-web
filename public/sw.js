/**
 * MonkeyTravel service worker.
 *
 * The point of this file is one thing: a traveller in a hotel with no
 * wifi can still open their saved trip. Without this, the /trips/[id]
 * page makes ~5 server calls on each load and hits a blank loading
 * state if any of them fail.
 *
 * STRATEGY (conservative on purpose — auth-sensitive paths bypass us
 * entirely so we never serve stale logged-in state):
 *
 *   - GET /trips/[id]                → stale-while-revalidate (HTML)
 *   - GET /api/trips/[id]            → stale-while-revalidate (JSON)
 *   - GET /api/trips/[id]/activities → stale-while-revalidate (JSON)
 *   - GET images.pexels.com          → cache-first, 30-day TTL
 *   - GET lh3.googleusercontent.com  → cache-first, 30-day TTL
 *   - GET /_next/static/*            → cache-first (immutable)
 *   - Everything else                → network-only (NEVER cache)
 *
 * Specifically NOT cached:
 *   - Anything POST/PUT/DELETE/PATCH
 *   - /api/auth/*, /auth/*
 *   - /api/profile, /api/notifications/* (user-scoped, can leak)
 *   - /api/ai/generate, /api/ai/generate/stream (always fresh)
 *
 * The SW is registered from lib/sw/register.ts only in the browser
 * (typeof window !== 'undefined') and only when the user is on a
 * /trips/* path (we don't need offline on /blog or marketing pages).
 *
 * CACHE VERSIONING: bump CACHE_VERSION when changing this file. Old
 * caches are deleted on `activate`. The browser auto-refetches the
 * SW file when the user reloads, so a bump propagates within one
 * full app launch.
 */

const CACHE_VERSION = "mt-v1";
const CACHE_TRIPS = `${CACHE_VERSION}-trips`;
const CACHE_IMAGES = `${CACHE_VERSION}-images`;
const CACHE_STATIC = `${CACHE_VERSION}-static`;

// 30 days for images. Activity photos rarely change once attached.
const IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

self.addEventListener("install", (event) => {
  // Take over immediately on the next reload — no SW limbo.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Reap any cache that isn't on the current version. Keeps storage
      // bounded across deploys.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      // Take control of pages opened before the SW registered.
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Bypass anything that isn't a GET.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin: only handle our image CDNs. Everything else hits the
  // network directly (otherwise we'd be a man-in-the-middle for any
  // third-party fetch).
  if (url.origin !== self.location.origin) {
    if (
      url.hostname === "images.pexels.com" ||
      url.hostname === "lh3.googleusercontent.com" ||
      url.hostname === "places.googleapis.com"
    ) {
      event.respondWith(cacheFirst(req, CACHE_IMAGES, IMAGE_TTL_MS));
    }
    return;
  }

  // Auth-sensitive paths — never cache.
  if (
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/api/auth/") ||
    url.pathname.startsWith("/api/profile") ||
    url.pathname.startsWith("/api/notifications") ||
    url.pathname.startsWith("/api/ai/") ||
    url.pathname.startsWith("/api/unsubscribe") ||
    url.pathname.startsWith("/api/devices") ||
    url.pathname.startsWith("/admin")
  ) {
    return;
  }

  // Trip detail pages (HTML).
  // Matches /trips/[uuid] and /[locale]/trips/[uuid] (with optional /edit).
  if (/^\/(?:[a-z]{2}\/)?trips\/[^/]+(?:\/edit)?\/?$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, CACHE_TRIPS));
    return;
  }

  // Trip JSON APIs that are safe to serve stale.
  if (
    /^\/api\/trips\/[^/]+(?:\/activities|\/checklist|\/votes|\/view)?$/.test(
      url.pathname
    )
  ) {
    event.respondWith(staleWhileRevalidate(req, CACHE_TRIPS));
    return;
  }

  // Next.js immutable static chunks.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, CACHE_STATIC));
    return;
  }

  // Public images — splash, icons, marketing photos. Cache-first.
  if (
    url.pathname.startsWith("/images/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/apple-icon" ||
    url.pathname === "/favicon.ico"
  ) {
    event.respondWith(cacheFirst(req, CACHE_IMAGES, IMAGE_TTL_MS));
    return;
  }

  // Default: don't touch the request. Let the browser fetch normally.
});

/**
 * Stale-while-revalidate: serve cached response immediately if we have
 * one, kick off a background refetch in either case. Failure to refetch
 * (offline) is silent — the cached response is enough.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchAndUpdate = fetch(request)
    .then((res) => {
      // Only cache successful responses. A 401/403/500 should not poison
      // the cache for future loads.
      if (res && res.ok && res.status === 200) {
        // Clone before storing — body is a stream, can only be read once.
        cache.put(request, res.clone()).catch(() => undefined);
      }
      return res;
    })
    .catch(() => undefined);

  if (cached) return cached;
  // No cached value yet — wait for the network. If that also fails,
  // surface the failure to the page (it'll handle the error state).
  const fresh = await fetchAndUpdate;
  if (fresh) return fresh;
  return new Response("Offline and not cached", {
    status: 504,
    statusText: "Gateway Timeout (offline)",
  });
}

/**
 * Cache-first: serve cached if present, otherwise network. For
 * images and immutable assets where staleness is fine for the TTL.
 */
async function cacheFirst(request, cacheName, ttlMs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    // Optional TTL check — for images. If the cached response is older
    // than the TTL, refetch in the background but still serve cached
    // now (avoids flashing a broken image).
    if (ttlMs) {
      const dateHeader = cached.headers.get("date");
      if (dateHeader) {
        const age = Date.now() - new Date(dateHeader).getTime();
        if (age > ttlMs) {
          fetch(request)
            .then((res) => {
              if (res && res.ok) cache.put(request, res.clone());
            })
            .catch(() => undefined);
        }
      }
    }
    return cached;
  }

  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone()).catch(() => undefined);
    }
    return fresh;
  } catch {
    return new Response("Offline and not cached", {
      status: 504,
      statusText: "Gateway Timeout (offline)",
    });
  }
}
