import type { NextRequest } from "next/server";

/**
 * Whether a request was issued from a page on this site.
 *
 * Prefer Sec-Fetch-Site: the browser sets it and page script cannot spoof it,
 * so extensions and cross-origin scripts arrive as "cross-site" or "none".
 * Older browsers and non-browser clients may omit it; then the Origin header
 * has to match the request's host.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) {
    return fetchSite === "same-origin";
  }

  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
