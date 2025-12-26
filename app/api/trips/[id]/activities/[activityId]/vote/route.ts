import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripActivityRouteContext } from "@/lib/api/route-context";
import type { VoteType, ActivityVote } from "@/types";

/**
 * GET /api/trips/[id]/activities/[activityId]/vote
 * Get all votes for a specific activity
 */
export async function GET(request: NextRequest, context: TripActivityRouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Fetch votes with user info
    const { data: votes, error } = await supabase
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
      .eq("activity_id", activityId)
      .order("voted_at", { ascending: true });

    if (error) {
      console.error("[Activity Vote] Error fetching votes:", error);
      return errors.internal("Failed to fetch votes", "Activity Vote");
    }

    // Transform to include user info at top level
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

    // Get current user's vote
    const currentUserVote = transformedVotes.find(
      (v) => v.user_id === user.id
    );

    return apiSuccess({
      success: true,
      votes: transformedVotes,
      currentUserVote: currentUserVote || null,
    });
  } catch (error) {
    console.error("[Activity Vote] Unexpected error in GET:", error);
    return errors.internal("Internal server error", "Activity Vote");
  }
}

/**
 * POST /api/trips/[id]/activities/[activityId]/vote
 * Cast or update a vote on an activity
 */
export async function POST(request: NextRequest, context: TripActivityRouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Parse request body
    const body = await request.json();
    const { voteType, comment } = body as {
      voteType: VoteType;
      comment?: string;
    };

    // Validate vote type
    const validVoteTypes: VoteType[] = ["love", "flexible", "concerns", "no"];
    if (!voteType || !validVoteTypes.includes(voteType)) {
      return errors.badRequest("Invalid vote type. Must be: love, flexible, concerns, or no");
    }

    // Require comment for concerns or no votes
    if ((voteType === "concerns" || voteType === "no") && !comment?.trim()) {
      return errors.badRequest(`A comment is required when voting "${voteType}"`);
    }

    // Check if user has permission to vote (owner or collaborator with vote rights)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return errors.notFound("Trip not found");
    }

    const isOwner = trip.user_id === user.id;

    // Check collaborator role if not owner
    let canVote = isOwner;
    if (!isOwner) {
      const { data: collab } = await supabase
        .from("trip_collaborators")
        .select("role")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .single();

      canVote = collab?.role === "editor" || collab?.role === "voter";
    }

    if (!canVote) {
      return errors.forbidden("You don't have permission to vote on this trip");
    }

    // Check if user already voted (upsert)
    const { data: existingVote } = await supabase
      .from("activity_votes")
      .select("id")
      .eq("trip_id", tripId)
      .eq("activity_id", activityId)
      .eq("user_id", user.id)
      .single();

    let vote;
    if (existingVote) {
      // Update existing vote
      const { data: updatedVote, error: updateError } = await supabase
        .from("activity_votes")
        .update({
          vote_type: voteType,
          comment: comment?.trim() || null,
        })
        .eq("id", existingVote.id)
        .select()
        .single();

      if (updateError) {
        console.error("[Activity Vote] Error updating vote:", updateError);
        return errors.internal("Failed to update vote", "Activity Vote");
      }
      vote = updatedVote;
    } else {
      // Create new vote
      const { data: newVote, error: insertError } = await supabase
        .from("activity_votes")
        .insert({
          trip_id: tripId,
          activity_id: activityId,
          user_id: user.id,
          vote_type: voteType,
          comment: comment?.trim() || null,
          vote_weight: 1.0,
        })
        .select()
        .single();

      if (insertError) {
        console.error("[Activity Vote] Error inserting vote:", insertError);
        return errors.internal("Failed to cast vote", "Activity Vote");
      }
      vote = newVote;
    }

    return apiSuccess({
      success: true,
      vote,
      isUpdate: !!existingVote,
    });
  } catch (error) {
    console.error("[Activity Vote] Unexpected error in POST:", error);
    return errors.internal("Internal server error", "Activity Vote");
  }
}

/**
 * DELETE /api/trips/[id]/activities/[activityId]/vote
 * Remove user's vote from an activity
 */
export async function DELETE(request: NextRequest, context: TripActivityRouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Delete the user's vote
    const { error } = await supabase
      .from("activity_votes")
      .delete()
      .eq("trip_id", tripId)
      .eq("activity_id", activityId)
      .eq("user_id", user.id);

    if (error) {
      console.error("[Activity Vote] Error deleting vote:", error);
      return errors.internal("Failed to remove vote", "Activity Vote");
    }

    return apiSuccess({
      success: true,
      message: "Vote removed",
    });
  } catch (error) {
    console.error("[Activity Vote] Unexpected error in DELETE:", error);
    return errors.internal("Internal server error", "Activity Vote");
  }
}
