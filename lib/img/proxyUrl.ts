/**
 * Wrap third-party image URLs in our same-origin proxy
 * (`/api/img/proxy?url=...`) when the host is known to occasionally
 * 504 to direct browser loads (Pexels via Cloudflare, the worst
 * offender). Passes through untouched for hosts not on the list
 * — including own-domain URLs, data: URIs, and anything that's
 * already proxied.
 *
 * Why server-fetch helps when the browser fetch 504s: Pexels'
 * Cloudflare layer appears to apply different rate / bot signatures
 * to browser User-Agent + hot-link Referer combos vs. anonymous
 * Vercel egress. Live-confirmed 2026-05-31: same JPEG curl-able at
 * 200 OK, but `<img src="https://images.pexels.com/...">` 504s twice
 * in a row including a cache-bust retry.
 *
 * Add hosts here as you discover them. Sync with the allowlist in
 * `app/api/img/proxy/route.ts` — that route rejects anything not
 * explicitly allowed.
 */

const PROXIED_HOSTS = new Set<string>([
  "images.pexels.com",
  "images.unsplash.com",
]);

export function proxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Already proxied or relative — passthrough.
  if (url.startsWith("/")) return url;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("blob:")) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:") return url;
  if (!PROXIED_HOSTS.has(parsed.hostname)) return url;
  return `/api/img/proxy?url=${encodeURIComponent(url)}`;
}
