/**
 * Is this request a page view? Pure decision, shared by the middleware
 * recorder (lib/supabase/middleware.ts) and its tests.
 *
 * WHY (2026-09-17)
 * The recorder skipped App-Router prefetches by checking the
 * `next-router-prefetch: 1` header (the 2026-06-07 fix). It never worked:
 * Next's middleware adapter (next/dist/server/web/adapter.js) deletes every
 * Flight header — rsc, next-router-state-tree, next-router-prefetch,
 * next-router-segment-prefetch — before user middleware runs, and strips the
 * `_rsc` query too. Probed on production and on a preview with a throwaway
 * session cookie: requests carrying those headers were recorded, and inside
 * the middleware `rsc` read as absent. So from here an RSC prefetch, an RSC
 * navigation and a document load are the same request, apart from what the
 * BROWSER adds. Result on 2026-09-16: 4,377 of 5,359 consecutive same-session
 * views were under 500 ms apart, all nav-menu targets. Views were ~3x
 * inflated; sessions were not affected.
 *
 * What the browser adds and Next does not strip is fetch metadata:
 *   navigation (address bar, link, reload)  sec-fetch-dest: document
 *                                            sec-fetch-mode: navigate
 *   fetch() from the router (RSC navigation
 *   AND every Link prefetch)                sec-fetch-dest: empty
 *                                            sec-fetch-mode: cors
 * So the middleware counts navigations only. In-app (client-side)
 * navigations are then counted by components/analytics/PageViewBeacon.tsx
 * through /api/page-view, which a prefetch can never trigger because a
 * prefetched page runs no client effects. A client that sends no fetch
 * metadata at all (curl, older engines) is counted as before.
 *
 * Also new: only GET counts. HEAD sweeps (internal sitemap checks) and
 * server-action POSTs to a page path were being recorded as views.
 */

export type PageViewVerdict =
  | "counted"
  | "skip:method"
  | "skip:path"
  | "skip:prefetch"
  | "skip:fetch";

export interface PageViewRequestLike {
  method: string;
  pathname: string;
  headers: { get(name: string): string | null };
}

/** Paths the recorder never counts, shared with /api/page-view. */
export function isPageViewPath(pathname: string): boolean {
  return !(
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/admin") ||
    pathname.includes(".")
  );
}

export function classifyPageViewRequest(req: PageViewRequestLike): PageViewVerdict {
  if (req.method !== "GET") return "skip:method";
  if (!isPageViewPath(req.pathname)) return "skip:path";

  const h = req.headers;
  // Speculation-rules prefetch / prerender (Chrome) and the older Pages-Router
  // marker. These survive the adapter because they are not Flight headers.
  if (h.get("purpose") === "prefetch" || (h.get("sec-purpose") ?? "").includes("prefetch")) {
    return "skip:prefetch";
  }

  const dest = h.get("sec-fetch-dest");
  const mode = h.get("sec-fetch-mode");
  if ((dest !== null && dest !== "document") || (mode !== null && mode !== "navigate")) {
    return "skip:fetch";
  }

  return "counted";
}
