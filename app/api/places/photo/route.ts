import { NextRequest } from "next/server";

/**
 * GET /api/places/photo?name=places/<placeId>/photos/<photoToken>&w=600&h=400
 *
 * Server-side image proxy for Google Places "New API" photos.
 *
 * **Why this exists** — 2026-05-24 live-test:
 * Google's Places photo endpoints (`places.googleapis.com/v1/.../media`
 * and even the resolved `lh3.googleusercontent.com/place-photos/...`)
 * return HTTP 504 to direct browser loads. Verified via the
 * browser network panel: every photo request from anonymous result
 * pages 504'd, so every activity card and the destination hero showed
 * a broken image silently.
 *
 * This route resolves the photo server-side (where Google's endpoint
 * works fine), streams the resulting JPEG bytes back to the browser
 * with aggressive Cache-Control, and never exposes the API key.
 *
 * **Why a proxy and not a redirect** — we tried `skipHttpRedirect=true`
 * to get an `lh3.googleusercontent.com` URL and embed that directly.
 * Even those returned 504 to the browser. Proxying is the only path
 * that reliably renders.
 *
 * **Why per-photo and not per-trip** — Vercel function memory caps make
 * bundling many images per request risky. The 1-year `Cache-Control`
 * header makes each photo a one-time fetch per CDN region.
 */

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// Validate the photo name shape so we can't be used as an open proxy.
// Google emits names like: `places/ChIJ.../photos/Ab43m-...` with
// alphanumerics + a small set of separators.
const NAME_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

/**
 * Retry transient 5xx + network errors from Google's media endpoint.
 *
 * Live observation 2026-05-30 (hero-image intermittent-load bug):
 * Google's `places.googleapis.com/.../media` returns occasional 503/504
 * even on repeat fetches that succeed seconds later. Without a retry,
 * the failure surfaces in the browser as a broken <img> → DestinationHero
 * flips to its gradient fallback → user has to hard-refresh to recover.
 *
 * Strategy: one retry, 250ms backoff, only for 5xx and network errors
 * (NEVER for 4xx — those are legit failures we shouldn't paper over).
 * Total worst-case latency added on the success path: 0ms. On retry:
 * ~250ms + one extra Google round-trip. Acceptable for the cure.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 1,
  delayMs = 250
): Promise<Response> {
  let attempt = 0;
  // We re-enter the loop only on retryable failure; success or 4xx returns immediately.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, init);
      const retryable = res.status >= 500 && res.status < 600;
      if (retryable && attempt < maxRetries) {
        // Drain the body so the connection can be reused; ignore drain errors.
        try {
          await res.arrayBuffer();
        } catch {
          /* ignore */
        }
        attempt += 1;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < maxRetries) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const wRaw = parseInt(searchParams.get("w") || "600", 10);
  const hRaw = parseInt(searchParams.get("h") || "400", 10);

  if (!name || !NAME_RE.test(name)) {
    return new Response("Invalid name", { status: 400 });
  }
  if (!GOOGLE_PLACES_API_KEY) {
    return new Response("Photo service not configured", { status: 503 });
  }

  // Clamp dimensions to reasonable bounds.
  const w = Math.min(Math.max(Number.isFinite(wRaw) ? wRaw : 600, 16), 4096);
  const h = Math.min(Math.max(Number.isFinite(hRaw) ? hRaw : 400, 16), 4096);

  const upstream = `https://places.googleapis.com/v1/${name}/media?maxHeightPx=${h}&maxWidthPx=${w}`;
  let res: Response;
  try {
    res = await fetchWithRetry(upstream, {
      headers: { "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY },
      // Server-side fetches follow the 302 redirect to the actual image.
      redirect: "follow",
    });
  } catch {
    return new Response("Upstream fetch failed", { status: 502 });
  }

  // **2026-06-04 fix:** on a 4xx from Google's /media endpoint (most
  // often happens when the photo resource name points at a deleted /
  // private / never-existed photo — Google's Place Details Pro returned
  // the token but the photo itself can't be served), redirect to a
  // curated Pexels fallback so the <img> tag still renders something.
  // Without this, the browser shows the broken-image icon — the exact
  // symptom this whole stack of fixes is trying to eliminate.
  //
  // 5xx still propagates (handled upstream by fetchWithRetry); 4xx is
  // a deterministic "this photo doesn't work" signal, so a one-time
  // redirect is correct and the CDN will cache it for the photo's
  // lifetime. Status 307 (temporary redirect) preserves the request
  // method and disables long-term caching of the redirect itself, so
  // if we later wire in a retry / re-fetch the next request picks up
  // the new behaviour.
  if (!res.ok || !res.body) {
    if (res.status >= 400 && res.status < 500) {
      // Drain the body to free the connection — we ignore the error
      // payload (it's a JSON error from Google, useless to the browser).
      try { await res.arrayBuffer(); } catch { /* ignore */ }
      // 429 (rate-limit) and 403 (quota) are TRANSIENT, not a permanently-bad
      // photo_reference: serve the curated fallback now so the <img> isn't
      // broken, but do NOT cache it — pinning a transient failure would replace
      // valid photos with stale fallbacks for a full hour after the spike
      // clears. Every OTHER 4xx (400/404/410) means the reference is
      // permanently gone, so cache the fallback at the edge for an hour to stop
      // re-hitting Google on every render (wasted invocation + paid API call).
      const transient = res.status === 429 || res.status === 403;
      return new Response(null, {
        status: 307,
        headers: {
          Location: curatedFallbackForName(name),
          "Cache-Control": transient ? "no-store" : "public, max-age=3600",
        },
      });
    }
    return new Response(`Upstream ${res.status}`, { status: res.status });
  }

  // Stream the bytes through. Photos don't change once issued, so cache
  // hard at the edge (Vercel) and in the browser. `s-maxage` covers the
  // Vercel CDN; `max-age` covers the browser; `immutable` is a hint to
  // clients that the resource will never change at this URL.
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=2592000, s-maxage=31536000, immutable",
    },
  });
}

/**
 * Pexels curated photos keyed by a deterministic hash of the photo
 * resource name. Same broken URL → same fallback every time (so the
 * CDN caches a single redirect target per upstream-broken photo).
 *
 * Photos hand-picked for activity-page atmospherics: open scenery,
 * urban moments, food close-ups. The grid is deliberately broad so
 * no single fallback dominates and pages with multiple broken URLs
 * still get visual variety.
 */
const CURATED_FALLBACKS = [
  "https://images.pexels.com/photos/2087391/pexels-photo-2087391.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/2034335/pexels-photo-2034335.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/958545/pexels-photo-958545.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/1796715/pexels-photo-1796715.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "https://images.pexels.com/photos/2082103/pexels-photo-2082103.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
];

function curatedFallbackForName(name: string): string {
  // Cheap deterministic hash over the resource name — sum of char
  // codes modulo the list length. Same name → same fallback always.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % CURATED_FALLBACKS.length;
  return CURATED_FALLBACKS[idx];
}
