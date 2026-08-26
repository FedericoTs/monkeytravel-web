import "server-only";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

/**
 * Homepage destination leaderboard — what people actually plan here, and the
 * attractions those itineraries actually contain.
 *
 * The numbers are real: they come from public.get_destination_leaderboard(),
 * which aggregates every non-deleted trip. Nothing here is hand-curated, so
 * the board reorders itself as demand moves (Vancouver and Berlin currently
 * sit near the top on 30-day movement, not lifetime volume).
 *
 * WHY A PLAIN ANON CLIENT, NOT lib/supabase/server.ts
 * That helper reads cookies(), which opts the caller into dynamic rendering
 * and makes the result uncacheable. This query needs no session — the RPC is
 * granted to `anon` and returns only aggregates — so a cookie-free client
 * lets unstable_cache actually hold the result. Without that, the heaviest
 * query on the site would run on every homepage render.
 *
 * WHY THERE ARE NO HOTELS HERE
 * Not because the itineraries are wrong — they are not. An earlier reading of
 * this data claimed trips titled "Dubai" carried hotels in Cornwall and
 * Switzerland. That was an artifact of the analysis, not the product: the trip
 * in question is "Dubai, Vienna, Villach, Cornwall & Toronto", a 21-day
 * five-city itinerary that genuinely visits Cornwall, and the hotels were
 * correct for it. The old query collapsed multi-city trips onto their first
 * city and then blamed the itinerary for the mislabelling. Attribution is now
 * per-day (see the 20260826231948 migration).
 *
 * The real reason is volume: across the whole dataset there are 44 lodging
 * entries that actually name a property, spread over 30 cities — roughly 1.5
 * per city. No city has enough to support a credible "top 3 hotels", so
 * accommodation is surfaced as a live search link per destination rather than
 * a ranking thin enough to be misleading. If lodging density grows, this is
 * worth revisiting.
 */

export interface LeaderboardActivity {
  name: string;
  times: number;
}

export interface LeaderboardEntry {
  /** Normalised lowercase city key from the RPC, e.g. "tokyo". */
  city: string;
  tripsAllTime: number;
  trips30d: number;
  topActivities: LeaderboardActivity[];
}

interface RpcRow {
  city: string;
  trips_all: number | string;
  trips_30d: number | string;
  top_activities: LeaderboardActivity[] | null;
}

const REVALIDATE_SECONDS = 3600;

async function fetchLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Missing env is a deploy problem, not a reason to break the homepage —
  // the caller renders nothing when this is empty.
  if (!url || !key) return [];

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("get_destination_leaderboard", {
    p_limit: limit,
    p_min_trips: 4,
  });

  if (error || !Array.isArray(data)) {
    // Never throw from here: this is one homepage section, and the page is
    // worth more than the section. An empty array renders nothing.
    console.error("[leaderboard] rpc failed:", error?.message);
    return [];
  }

  return (data as RpcRow[])
    .map((r) => ({
      city: r.city,
      tripsAllTime: Number(r.trips_all) || 0,
      trips30d: Number(r.trips_30d) || 0,
      topActivities: Array.isArray(r.top_activities) ? r.top_activities.slice(0, 3) : [],
    }))
    // A card with no activities has nothing to show under the name. The RPC
    // already filters these, so this is belt-and-braces against a future
    // change loosening that.
    .filter((r) => r.topActivities.length > 0);
}

/**
 * Cached for an hour. The underlying query walks every trip's itinerary JSON,
 * which is cheap at today's volume but grows with the table — and the
 * homepage is the highest-traffic page on the site, so it must not run
 * per-request. An hour is far shorter than the rate at which this ordering
 * actually changes.
 */
export const getDestinationLeaderboard = unstable_cache(
  fetchLeaderboard,
  ["destination-leaderboard"],
  { revalidate: REVALIDATE_SECONDS, tags: ["destination-leaderboard"] },
);
