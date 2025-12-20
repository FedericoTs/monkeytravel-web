import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { VoteType, ActivityVote } from "@/types";

interface RouteContext {
  params: Promise<{ id: string; activityId: string }>;
}

/**
 * GET /api/trips/[id]/activities/[activityId]/vote
 * Get all votes for a specific activity
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      console.error("Error fetching votes:", error);
      return NextResponse.json(
        { error: "Failed to fetch votes" },
        { status: 500 }
      );
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

    return NextResponse.json({
      success: true,
      votes: transformedVotes,
      currentUserVote: currentUserVote || null,
    });
  } catch (error) {
    console.error("Error in GET /api/trips/[id]/activities/[activityId]/vote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trips/[id]/activities/[activityId]/vote
 * Cast or update a vote on an activity
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { voteType, comment } = body as {
      voteType: VoteType;
      comment?: string;
    };

    // Validate vote type
    const validVoteTypes: VoteType[] = ["love", "flexible", "concerns", "no"];
    if (!voteType || !validVoteTypes.includes(voteType)) {
      return NextResponse.json(
        { error: "Invalid vote type. Must be: love, flexible, concerns, or no" },
        { status: 400 }
      );
    }

    // Require comment for concerns or no votes
    if ((voteType === "concerns" || voteType === "no") && !comment?.trim()) {
      return NextResponse.json(
        { error: `A comment is required when voting "${voteType}"` },
        { status: 400 }
      );
    }

    // Check if user has permission to vote (owner or collaborator with vote rights)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
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
      return NextResponse.json(
        { error: "You don't have permission to vote on this trip" },
        { status: 403 }
      );
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
        console.error("Error updating vote:", updateError);
        return NextResponse.json(
          { error: "Failed to update vote" },
          { status: 500 }
        );
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
        console.error("Error inserting vote:", insertError);
        return NextResponse.json(
          { error: "Failed to cast vote" },
          { status: 500 }
        );
      }
      vote = newVote;
    }

    return NextResponse.json({
      success: true,
      vote,
      isUpdate: !!existingVote,
    });
  } catch (error) {
    console.error("Error in POST /api/trips/[id]/activities/[activityId]/vote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trips/[id]/activities/[activityId]/vote
 * Remove user's vote from an activity
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, activityId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete the user's vote
    const { error } = await supabase
      .from("activity_votes")
      .delete()
      .eq("trip_id", tripId)
      .eq("activity_id", activityId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error deleting vote:", error);
      return NextResponse.json(
        { error: "Failed to remove vote" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Vote removed",
    });
  } catch (error) {
    console.error("Error in DELETE /api/trips/[id]/activities/[activityId]/vote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
