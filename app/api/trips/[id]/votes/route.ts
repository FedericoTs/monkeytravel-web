import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { readActivityVotes } from "@/lib/voting/read-votes";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { VoteType, ActivityConfirmationRecord } from "@/types";
import { calculateConsensus, aggregateVotesByActivity } from "@/lib/voting/consensus";

/**
 * GET /api/trips/[id]/votes
 * Get all votes for a trip (batch fetch for efficiency)
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify user has access (owner or collaborator)
    const { trip, errorResponse: accessError } = await verifyTripAccess(
      supabase,
      tripId,
      user.id
    );
    if (accessError) return accessError;

    const { votes: transformedVotes, error: votesError } = await readActivityVotes(supabase, tripId);
    if (votesError) {
      console.error("[Votes] Error fetching votes:", votesError);
      return errors.internal("Failed to fetch votes", "Votes");
    }

    // Fetch activity statuses
    const { data: statuses, error: statusError } = await supabase
      .from("activity_status")
      .select("*")
      .eq("trip_id", tripId);

    if (statusError) {
      console.error("Error fetching statuses:", statusError);
      // Non-fatal, continue without statuses
    }

    // Get all voters (owner + collaborators with voting rights)
    const { data: collaborators, error: collaboratorsError } = await supabase
      .from("trip_collaborators")
      .select("user_id, role")
      .eq("trip_id", tripId);
    if (collaboratorsError) throw collaboratorsError;

    // Build list of all voter IDs
    const voterIds: string[] = [trip.user_id]; // Owner can always vote
    for (const c of collaborators || []) {
      if (c.role === "editor" || c.role === "voter") {
        voterIds.push(c.user_id);
      }
    }

    // Group votes by activity
    const votesByActivity = aggregateVotesByActivity(transformedVotes);

    // Create activity status map
    const statusMap: Record<string, ActivityConfirmationRecord> = {};
    for (const s of statuses || []) {
      statusMap[s.activity_id] = s as ActivityConfirmationRecord;
    }

    // Calculate consensus for each activity
    const consensusMap: Record<string, ReturnType<typeof calculateConsensus>> = {};
    for (const [activityId, activityVotes] of votesByActivity) {
      const status = statusMap[activityId];
      consensusMap[activityId] = calculateConsensus({
        votes: activityVotes,
        totalVoters: voterIds.length,
        proposedAt: status?.proposed_at || new Date().toISOString(),
        allVoterIds: voterIds,
      });
    }

    // Get current user's votes
    const currentUserVotes: Record<string, VoteType> = {};
    for (const vote of transformedVotes) {
      if (vote.user_id === user.id) {
        currentUserVotes[vote.activity_id] = vote.vote_type;
      }
    }

    return apiSuccess({
      success: true,
      votes: Object.fromEntries(votesByActivity),
      statuses: statusMap,
      consensus: consensusMap,
      currentUserVotes,
      voterCount: voterIds.length,
    });
  } catch (error) {
    console.error("[Votes] Error fetching votes:", error);
    return errors.internal("Failed to fetch votes", "Votes");
  }
}
