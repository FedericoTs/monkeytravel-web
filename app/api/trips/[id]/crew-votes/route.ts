/**
 * GET /api/trips/[id]/crew-votes
 *
 * Owner-side visibility for the Crew Loop: aggregates the anonymous
 * share-link votes (`anonymous_activity_votes`, written by
 * POST /api/shared/[token]/vote) so the trip owner/collaborators can see
 * what their crew thinks WITHOUT opening their own share link.
 *
 * Auth required — caller must be the trip owner or a collaborator
 * (verifyTripAccess). The vote rows themselves are then read via the
 * service-role client: the table's RLS is public-SELECT anyway, but the
 * admin client keeps this route independent of that policy.
 *
 * Returns:
 *   {
 *     total: number,                 // every vote row on the trip
 *     voters: string[],              // distinct non-empty display names, max 10
 *     byActivity: Record<activityId, { up: number, down: number }>
 *   }
 *
 * Activities with zero votes are absent from `byActivity` — the client
 * defaults to no pill for missing keys (same convention as the shared
 * page's GET /api/shared/[token]/votes).
 */
import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";

export async function GET(_request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;

    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Owner OR collaborator — collaborators helping plan should see the
    // crew's reactions too.
    const { errorResponse: accessError } = await verifyTripAccess(
      supabase,
      id,
      user.id
    );
    if (accessError) return accessError;

    // Access proven — service-role read of the vote rows.
    const admin = createAdminClient();
    const { data: rows, error: rowsError } = await admin
      .from("anonymous_activity_votes")
      .select("activity_id, vote_type, voter_display_name")
      .eq("trip_id", id);

    if (rowsError) {
      console.error("[Crew Votes] Fetch failed:", rowsError);
      return errors.internal("Failed to load crew votes", "CrewVotes");
    }

    let total = 0;
    const voters: string[] = [];
    const seenVoters = new Set<string>();
    const byActivity: Record<string, { up: number; down: number }> = {};

    for (const row of rows ?? []) {
      total++;

      const bucket = byActivity[row.activity_id] ?? { up: 0, down: 0 };
      if (row.vote_type === "up") bucket.up++;
      else if (row.vote_type === "down") bucket.down++;
      byActivity[row.activity_id] = bucket;

      const name =
        typeof row.voter_display_name === "string"
          ? row.voter_display_name.trim()
          : "";
      if (name && !seenVoters.has(name) && voters.length < 10) {
        seenVoters.add(name);
        voters.push(name);
      }
    }

    return apiSuccess({ total, voters, byActivity });
  } catch (error) {
    console.error("[Crew Votes] Unexpected error:", error);
    return errors.internal("Unexpected error", "CrewVotes");
  }
}
