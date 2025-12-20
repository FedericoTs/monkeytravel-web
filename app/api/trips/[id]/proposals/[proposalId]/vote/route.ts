import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ProposalVote, ProposalVoteType } from "@/types";

interface RouteContext {
  params: Promise<{ id: string; proposalId: string }>;
}

/**
 * GET /api/trips/[id]/proposals/[proposalId]/vote
 * Get all votes for a specific proposal
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify proposal exists and belongs to trip
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, trip_id")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 }
      );
    }

    // Fetch votes with user info
    const { data: votes, error } = await supabase
      .from("proposal_votes")
      .select(`
        id,
        proposal_id,
        user_id,
        vote_type,
        comment,
        rank,
        voted_at,
        updated_at,
        user:user_id (
          display_name,
          avatar_url
        )
      `)
      .eq("proposal_id", proposalId)
      .order("voted_at", { ascending: true });

    if (error) {
      console.error("Error fetching votes:", error);
      return NextResponse.json(
        { error: "Failed to fetch votes" },
        { status: 500 }
      );
    }

    // Transform to include user info at top level
    const transformedVotes: ProposalVote[] = (votes || []).map((v) => {
      const profile = v.user as unknown as {
        display_name: string;
        avatar_url: string | null;
      } | null;

      return {
        id: v.id,
        proposal_id: v.proposal_id,
        user_id: v.user_id,
        vote_type: v.vote_type as ProposalVoteType,
        comment: v.comment,
        rank: v.rank,
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
    console.error("Error in GET /api/trips/[id]/proposals/[proposalId]/vote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trips/[id]/proposals/[proposalId]/vote
 * Cast or update a vote on a proposal
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
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
      voteType: ProposalVoteType;
      comment?: string;
    };

    // Validate vote type
    const validVoteTypes: ProposalVoteType[] = ["approve", "reject"];
    if (!voteType || !validVoteTypes.includes(voteType)) {
      return NextResponse.json(
        { error: "Invalid vote type. Must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    // Verify proposal exists and is votable
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, trip_id, status, proposed_by")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 }
      );
    }

    // Check if proposal is still open for voting
    if (!['pending', 'voting'].includes(proposal.status)) {
      return NextResponse.json(
        { error: "This proposal is no longer open for voting" },
        { status: 400 }
      );
    }

    // Check if user has permission to vote
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
      .from("proposal_votes")
      .select("id")
      .eq("proposal_id", proposalId)
      .eq("user_id", user.id)
      .single();

    let vote;
    if (existingVote) {
      // Update existing vote
      const { data: updatedVote, error: updateError } = await supabase
        .from("proposal_votes")
        .update({
          vote_type: voteType,
          comment: comment?.trim() || null,
        })
        .eq("id", existingVote.id)
        .select(`
          id,
          proposal_id,
          user_id,
          vote_type,
          comment,
          rank,
          voted_at,
          updated_at
        `)
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
        .from("proposal_votes")
        .insert({
          proposal_id: proposalId,
          user_id: user.id,
          vote_type: voteType,
          comment: comment?.trim() || null,
        })
        .select(`
          id,
          proposal_id,
          user_id,
          vote_type,
          comment,
          rank,
          voted_at,
          updated_at
        `)
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
    console.error("Error in POST /api/trips/[id]/proposals/[proposalId]/vote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trips/[id]/proposals/[proposalId]/vote
 * Remove user's vote from a proposal
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify proposal exists
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, trip_id, status")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 }
      );
    }

    // Check if proposal is still open
    if (!['pending', 'voting'].includes(proposal.status)) {
      return NextResponse.json(
        { error: "Cannot remove vote from a resolved proposal" },
        { status: 400 }
      );
    }

    // Delete the user's vote
    const { error } = await supabase
      .from("proposal_votes")
      .delete()
      .eq("proposal_id", proposalId)
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
    console.error("Error in DELETE /api/trips/[id]/proposals/[proposalId]/vote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
