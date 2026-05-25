import "server-only";
import { headers } from "next/headers";
import type { ExploreFeedResponse, ExploreFilters } from "./types";

/**
 * Server-side fetcher for /api/explore/trips.
 *
 * Built absolute URLs so it works from both server components (where
 * relative fetches need the host) and from edge contexts. Uses the
 * forwarded host header so the call hits the same deployment that
 * served the page (preview deploys + branch deploys included).
 *
 * Caching: explicitly opts into Next's default 60-second revalidate
 * so a brief burst of /explore visits doesn't fan out to the API
 * route. Page-level fetchers can override by passing
 * `revalidate: 0` to force fresh data after a publish/like.
 */
export async function fetchExploreFeed(
  filters: ExploreFilters = {},
  options: { revalidate?: number } = {}
): Promise<ExploreFeedResponse | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "monkeytravel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";

  const params = new URLSearchParams();
  if (filters.destination) params.set("destination", filters.destination);
  if (filters.budget) params.set("budget", filters.budget);
  if (filters.tag) params.set("tags", filters.tag);
  if (filters.durationMin) params.set("duration_min", String(filters.durationMin));
  if (filters.durationMax) params.set("duration_max", String(filters.durationMax));
  if (filters.page) params.set("page", String(filters.page));
  // per_page stays at API default (12) — change at one place only.

  const url = `${proto}://${host}/api/explore/trips?${params.toString()}`;

  try {
    const res = await fetch(url, {
      next: { revalidate: options.revalidate ?? 60 },
    });
    if (!res.ok) {
      // 404 is the expected return when EXPLORE_UGC_ENABLED is unset
      // (Week 1-2 dark launch). Treat as "no feed" so the page can
      // render a coming-soon block instead of throwing.
      if (res.status === 404) return null;
      console.error(`[explore-fetcher] ${res.status} from ${url}`);
      return null;
    }
    // apiSuccess() returns the payload at the root (no { success: true }
    // envelope unless wrap:true is passed). Validate shape via the
    // trips array presence.
    const json = await res.json();
    if (!Array.isArray(json?.trips)) return null;
    return json as ExploreFeedResponse;
  } catch (err) {
    console.error("[explore-fetcher] fetch failed:", err);
    return null;
  }
}
