import { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/api/rate-limit";

// Abuse ceiling for the generic media proxy — generous for real pages,
// hostile to scripted egress/bandwidth abuse.
const imgProxyLimiter = createRateLimiter("img-proxy", 600, 60 * 60 * 1000);

/**
 * GET /api/img/proxy?url=<allowlisted-image-url>
 *
 * Generic server-side proxy for hotlinked images that intermittently
 * return 5xx to direct browser requests but succeed from Vercel egress.
 *
 * **Why this exists** — 2026-05-31 live audit:
 * Pexels CDN (`images.pexels.com`) intermittently 504s direct browser
 * loads even when curl from the same machine succeeds. Verified via
 * Chrome network panel on /it/shared/<token>: cover image got
 * `504 Gateway Timeout` twice in a row, including with cache-bust
 * `?_r=1` retry. Suspected cause: Cloudflare anti-scraping signature
 * on browser User-Agent + Referer combo. Affects every shared trip
 * cover, every /explore card, every /destinations card, every saved
 * trip hero whose `cover_image_url` points at Pexels.
 *
 * Server-side fetches don't trip whatever bot heuristic browser
 * requests do, so the same URL resolves cleanly from a Vercel function.
 * Proxying through this route is the user-visible fix.
 *
 * **Allowlist** — strict. Open proxy = SSRF + bandwidth-abuse vector.
 * Only third-party CDNs we actually hotlink land here.
 *
 * Cousins: `/api/places/photo` (Google Places-specific, needs API key).
 * This one is generic and key-free.
 */

const ALLOWED_HOSTS = new Set<string>([
  "images.pexels.com",
  "images.unsplash.com",
  "lh3.googleusercontent.com",
  "maps.gstatic.com",
  "maps.googleapis.com",
]);

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB upper bound — cover photos are well under 1 MB

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 1,
  delayMs = 300
): Promise<Response> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, init);
      const retryable = res.status >= 500 && res.status < 600;
      if (retryable && attempt < maxRetries) {
        try {
          await res.arrayBuffer();
        } catch {
          /* ignore drain */
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
  const { allowed } = await imgProxyLimiter.check(request);
  if (!allowed) return new Response("Too many requests", { status: 429 });

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    return new Response("Only https allowed", { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return new Response("Host not allowed", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetchWithRetry(parsed.toString(), {
      headers: {
        // Identify as a generic fetcher. Some CDNs (Pexels via Cloudflare)
        // serve 504 to browser User-Agents but 200 to non-browser fetches.
        "User-Agent": "MonkeyTravelImageProxy/1.0 (+https://monkeytravel.app)",
        Accept: "image/*",
      },
      redirect: "follow",
    });
  } catch {
    return new Response("Upstream fetch failed", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream ${upstream.status}`, { status: upstream.status });
  }

  const contentLengthHeader = upstream.headers.get("content-length");
  if (contentLengthHeader) {
    const cl = parseInt(contentLengthHeader, 10);
    if (Number.isFinite(cl) && cl > MAX_BYTES) {
      return new Response("Payload too large", { status: 413 });
    }
  }

  const ct = upstream.headers.get("content-type") || "image/jpeg";
  if (!ct.startsWith("image/")) {
    return new Response("Non-image content-type", { status: 415 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": ct,
      // 30 days browser cache, 1 year edge cache, immutable hint.
      "Cache-Control": "public, max-age=2592000, s-maxage=31536000, immutable",
      "X-Image-Proxy": "1",
    },
  });
}
