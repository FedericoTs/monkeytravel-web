import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SavedPlace } from "./saved-places";

/**
 * Live figures for the marketing pages and the "saved in N trips" line on
 * activity cards. Both come from one row pg_cron refreshes every six hours
 * (public.public_stats_cache, see the 20261026130000 migration), read through
 * anon-callable RPCs that return aggregates only.
 *
 * Read when a page is built and shipped in its static HTML until the next
 * deploy, as lib/leaderboard/destinations.ts does, with a plain anon client:
 * lib/supabase/server.ts reads cookies(), which would make the page dynamic.
 */

export interface PublicStats {
  /** Planning sessions that reached a plan, automation excluded, all time. */
  plans: number;
  plans30d: number;
  groupPlans: number;
  soloPlans: number;
  /** Plans of one to three days. */
  shortPlans: number;
  /** Activities on saved itineraries. */
  activities: number;
  /** Median seconds to a full itinerary over 30 days, cache hits excluded. */
  medianPlanSeconds: number | null;
}

interface StatsRow {
  plans?: number;
  plans_30d?: number;
  group_plans?: number;
  solo_plans?: number;
  short_plans?: number;
  activities?: number;
  median_plan_seconds?: number | null;
}

/** One build runs many pages in the same worker: read each RPC once per hour. */
const TTL_MS = 60 * 60 * 1000;
let stats: { at: number; value: Promise<PublicStats | null> } | null = null;
let places: { at: number; value: Promise<SavedPlace[]> } | null = null;

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

async function readStats(): Promise<PublicStats | null> {
  const supabase = anonClient();
  // Missing env is a deploy problem, not a reason to break a page: callers
  // render nothing without figures.
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_public_stats");
  if (error || !data || typeof data !== "object") {
    if (error) console.error("[public-stats] rpc failed:", error.message);
    return null;
  }
  const row = data as StatsRow;
  return {
    plans: count(row.plans),
    plans30d: count(row.plans_30d),
    groupPlans: count(row.group_plans),
    soloPlans: count(row.solo_plans),
    shortPlans: count(row.short_plans),
    activities: count(row.activities),
    medianPlanSeconds: typeof row.median_plan_seconds === "number" ? row.median_plan_seconds : null,
  };
}

async function readPlaces(): Promise<SavedPlace[]> {
  const supabase = anonClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_saved_places");
  if (error || !Array.isArray(data)) {
    if (error) console.error("[public-stats] saved places rpc failed:", error.message);
    return [];
  }
  return (data as unknown[]).filter(
    (p): p is SavedPlace =>
      Array.isArray(p) &&
      p.length === 4 &&
      typeof p[0] === "string" &&
      typeof p[1] === "number" &&
      typeof p[2] === "number" &&
      typeof p[3] === "number",
  );
}

/** Never throws: a page is worth more than its figures. */
export function getPublicStats(): Promise<PublicStats | null> {
  if (!stats || Date.now() - stats.at > TTL_MS) {
    stats = { at: Date.now(), value: readStats().catch(() => null) };
  }
  return stats.value;
}

/** Never throws; an empty list shows no counts. */
export function getSavedPlaces(): Promise<SavedPlace[]> {
  if (!places || Date.now() - places.at > TTL_MS) {
    places = { at: Date.now(), value: readPlaces().catch(() => []) };
  }
  return places.value;
}
