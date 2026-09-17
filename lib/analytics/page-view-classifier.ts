/**
 * Is this request a page view? Pure decision, shared by the middleware
 * recorder (lib/supabase/middleware.ts) and its tests.
 *
 * WHY (2026-09-17)
 * The recorder skipped App-Router prefetches by checking the
 * `next-router-prefetch: 1` header (the 2026-06-07 fix). Probed on
 * production with a throwaway session cookie: requests carrying that
 * header WERE recorded, while `purpose: prefetch` and `sec-purpose` were
 * correctly skipped. The guard code runs; the header never reaches the
 * middleware with that value on Vercel. Result: on 2026-09-16, 4,377 of
 * 5,359 consecutive same-session views were under 500 ms apart, all
 * nav-menu targets. Views were ~3x inflated; sessions were not affected.
 *
 * Next 16 sends two request shapes that are not page views:
 *   - segment-cache prefetch (client/components/segment-cache/cache.js):
 *     rsc:1 + next-router-prefetch:1 + next-router-segment-prefetch:<seg>,
 *     and NO next-router-state-tree.
 *   - a client navigation (router-reducer/fetch-server-response.js):
 *     rsc:1 + next-router-state-tree:<tree>. That one IS a page view.
 * So an RSC request without a state tree is a prefetch whatever headers
 * Vercel keeps or drops. The named prefetch headers are still checked
 * first; if they ever come back, nothing changes.
 *
 * Also new: only GET counts. HEAD sweeps (internal sitemap checks) and
 * server-action POSTs to a page path were being recorded as views.
 */

export type PageViewVerdict =
  | "counted"
  | "skip:method"
  | "skip:path"
  | "skip:prefetch"
  | "skip:rsc-no-tree";

export interface PageViewRequestLike {
  method: string;
  pathname: string;
  headers: { get(name: string): string | null };
}

export function classifyPageViewRequest(req: PageViewRequestLike): PageViewVerdict {
  if (req.method !== "GET") return "skip:method";

  const path = req.pathname;
  if (
    path.startsWith("/api/") ||
    path.startsWith("/_next/") ||
    path.startsWith("/admin") ||
    path.includes(".")
  ) {
    return "skip:path";
  }

  const h = req.headers;
  if (
    h.get("next-router-prefetch") === "1" ||
    h.get("next-router-segment-prefetch") !== null ||
    h.get("purpose") === "prefetch" ||
    (h.get("sec-purpose") ?? "").includes("prefetch")
  ) {
    return "skip:prefetch";
  }

  if (h.get("rsc") === "1" && !h.get("next-router-state-tree")) {
    return "skip:rsc-no-tree";
  }

  return "counted";
}
