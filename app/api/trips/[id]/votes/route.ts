import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { VoteType, ActivityVote, ActivityStatus, CollaboratorRole } from "@/types";
import { calculateConsensus, aggregateVotesByActivity } from "@/lib/voting/consensus";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/trips/[id]/votes
 * Get all votes for a trip (batch fetch for efficiency)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user has access to this trip
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    const isOwner = trip.user_id === user.id;

    // Check collaborator access if not owner
    if (!isOwner) {
      const { data: collab } = await supabase
        .from("trip_collaborators")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .single();

      if (!collab) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    // Fetch all votes for the trip with user info
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
        updated_at,
        users:user_id (
          display_name,
          avatar_url
        )
      `)
      .eq("trip_id", tripId)
      .order("voted_at", { ascending: true });

    if (votesError) {
      console.error("Error fetching votes:", votesError);
      return NextResponse.json(
        { error: "Failed to fetch votes" },
        { status: 500 }
      );
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

    // Transform votes
    const transformedVotes: ActivityVote[] = (votes || []).map((v) => {
      const profile = v.users as unknown as {
        display_name: string;
        avatar_url: string | null;
      } | null;
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
              display_name: profile.display_name || "Unknown",
              avatar_url: profile.avatar_url || undefined,
            }
          : undefined,
      };
    });

    // Group votes by activity
    const votesByActivity = aggregateVotesByActivity(transformedVotes);

    // Create activity status map
    const statusMap: Record<string, ActivityStatus> = {};
    for (const s of statuses || []) {
      statusMap[s.activity_id] = s as ActivityStatus;
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

    return NextResponse.json({
      success: true,
      votes: Object.fromEntries(votesByActivity),
      statuses: statusMap,
      consensus: consensusMap,
      currentUserVotes,
      voterCount: voterIds.length,
    });
  } catch (error) {
    console.error("Error in GET /api/trips/[id]/votes:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
