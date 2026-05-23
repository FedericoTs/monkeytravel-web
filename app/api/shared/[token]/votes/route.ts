/**
 * GET /api/shared/[token]/votes
 *
 * Hydration endpoint for the shared trip page. Returns up/down tallies for
 * every activity that has at least one vote, plus a `myVotes` map of the
 * current viewer's own votes (resolved via the mt_anon_voter cookie).
 *
 * Returns:
 *   {
 *     tallies: Record<activityId, { up: number, down: number }>,
 *     myVotes: Record<activityId, 'up' | 'down'>
 *   }
 *
 * Activities with zero votes are simply absent from `tallies` — the UI
 * defaults to { up: 0, down: 0 } for any missing key.
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";

const COOKIE_NAME = "mt_anon_voter";

function isUuid(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
}

export async function GET(_request: NextRequest, context: InviteTokenRouteContext) {
  try {
    const { token } = await context.params;

    if (!token || !isUuid(token)) {
      return errors.badRequest("Invalid share token");
    }

    const supabase = createAdminClient();

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("share_token", token)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Shared trip not found");
    }

    // Pull every vote for the trip in one query. For a typical 7-day trip
    // with ~30 activities and maybe 5-10 voters, this is <300 rows — cheaper
    // than a GROUP BY round-trip and lets us compute `myVotes` in the same pass.
    const { data: rows, error: rowsError } = await supabase
      .from("anonymous_activity_votes")
      .select("activity_id, vote_type, voter_cookie_id")
      .eq("trip_id", trip.id);

    if (rowsError) {
      console.error("[Shared Votes] Fetch failed:", rowsError);
      return errors.internal("Failed to load votes", "SharedVotes");
    }

    // Read (don't issue) the voter cookie. GET should never mint identity —
    // that's the POST route's job. Pre-vote viewers just see tallies.
    const cookieStore = await cookies();
    const voterCookieId = cookieStore.get(COOKIE_NAME)?.value;

    const tallies: Record<string, { up: number; down: number }> = {};
    const myVotes: Record<string, "up" | "down"> = {};

    for (const row of rows ?? []) {
      const bucket = tallies[row.activity_id] ?? { up: 0, down: 0 };
      if (row.vote_type === "up") bucket.up++;
      else if (row.vote_type === "down") bucket.down++;
      tallies[row.activity_id] = bucket;

      if (voterCookieId && row.voter_cookie_id === voterCookieId) {
        myVotes[row.activity_id] = row.vote_type as "up" | "down";
      }
    }

    return apiSuccess({ tallies, myVotes });
  } catch (error) {
    console.error("[Shared Votes] Unexpected error:", error);
    return errors.internal("Unexpected error", "SharedVotes");
  }
}
