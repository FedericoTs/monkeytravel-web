import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { VoteType, ActivityVote, ActivityConfirmationRecord } from "@/types";
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

    // Fetch all votes for the trip (without user join - FK points to auth.users, not public.users)
    const { data: votes, error: votesError } = await supabase
      .from("activity_votes")
      .select(`
        id,
        trip_id,
        activity_id,
        user_id,
        vote_type,
        comment,
        vote_weight,
        voted_at,
        updated_at
      `)
      .eq("trip_id", tripId)
      .order("voted_at", { ascending: true });

    if (votesError) {
      console.error("[Votes] Error fetching votes:", votesError);
      return errors.internal("Failed to fetch votes", "Votes");
    }

    // Collect all user IDs from votes to batch fetch profiles
    const voteUserIds = new Set<string>();
    for (const v of votes || []) {
      voteUserIds.add(v.user_id);
    }

    // Batch fetch user profiles from public.users table
    let userProfileMap = new Map<string, { display_name: string; avatar_url: string | null }>();
    if (voteUserIds.size > 0) {
      const { data: userProfiles } = await supabase
        .from("users")
        .select("id, display_name, avatar_url")
        .in("id", Array.from(voteUserIds));

      for (const profile of userProfiles || []) {
        userProfileMap.set(profile.id, {
          display_name: profile.display_name || "Unknown",
          avatar_url: profile.avatar_url,
        });
      }
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
    const { data: collaborators } = await supabase
      .from("trip_collaborators")
      .select("user_id, role")
      .eq("trip_id", tripId);

    // Build list of all voter IDs
    const voterIds: string[] = [trip.user_id]; // Owner can always vote
    for (const c of collaborators || []) {
      if (c.role === "editor" || c.role === "voter") {
        voterIds.push(c.user_id);
      }
    }

    // Transform votes using the profile map
    const transformedVotes: ActivityVote[] = (votes || []).map((v) => {
      const profile = userProfileMap.get(v.user_id);
      return {
        id: v.id,
        trip_id: v.trip_id,
        activity_id: v.activity_id,
        user_id: v.user_id,
        vote_type: v.vote_type as VoteType,
        comment: v.comment,
        vote_weight: v.vote_weight,
        voted_at: v.voted_at,
        updated_at: v.updated_at,
        user: profile
          ? {
              display_name: profile.display_name,
              avatar_url: profile.avatar_url || undefined,
            }
          : undefined,
      };
    });

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
