import { fetchWithOneRetry } from "@/lib/api/fetch-with-one-retry";
import { imageContentType, MAX_IMAGE_BYTES, safeImageFetch } from "@/lib/api/safe-image-fetch";

/**
 * The third-party CDNs the image proxy fetches from. Strict: an open proxy is
 * an SSRF and bandwidth-abuse vector, so only hosts we hotlink are here.
 * lib/img/proxyUrl.ts sends a subset of them through the proxy.
 */
export const IMG_PROXY_HOSTS: ReadonlySet<string> = new Set([
  "images.pexels.com",
  "images.unsplash.com",
  "lh3.googleusercontent.com",
  "maps.gstatic.com",
  "maps.googleapis.com",
]);

/**
 * Fetch an allowlisted image server-side and stream it back, for
 * /api/img/proxy?url= and /api/img/proxy/<encoded-url>.
 *
 * The Pexels CDN (`images.pexels.com`) intermittently answers direct browser
 * loads with 504, even with a cache-busting retry, while a server fetch of the
 * same URL succeeds: most likely Cloudflare anti-scraping keyed on the
 * browser's User-Agent and Referer. That would hit every shared trip cover,
 * /explore card, /destinations card and saved trip hero whose
 * `cover_image_url` points at Pexels, so those images come through here.
 *
 * Every redirect hop is checked against the allowlist and the internal-address
 * block (safeImageFetch), and a 5xx gets one retry.
 *
 * Cousins: `/api/places/photo` (Google Places-specific, needs API key).
 * This one is generic and key-free.
 */
export async function proxyImage(raw: string): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    return new Response("Only https allowed", { status: 400 });
  }
  if (!IMG_PROXY_HOSTS.has(parsed.hostname)) {
    return new Response("Host not allowed", { status: 400 });
  }

  const fetched = await safeImageFetch(parsed.toString(), {
    allowedHosts: IMG_PROXY_HOSTS,
    fetchImpl: fetchWithOneRetry,
    headers: {
      // Identify as a generic fetcher. Some CDNs (Pexels via Cloudflare)
      // serve 504 to browser User-Agents but 200 to non-browser fetches.
      "User-Agent": "MonkeyTravelImageProxy/1.0 (+https://monkeytravel.app)",
      Accept: "image/*",
    },
  });

  if (!fetched.ok) {
    return new Response(fetched.reason, { status: fetched.status });
  }
  const upstream = fetched.response;

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream ${upstream.status}`, { status: upstream.status });
  }

  const contentLength = parseInt(upstream.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  const ct = imageContentType(upstream);
  if (!ct) {
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
