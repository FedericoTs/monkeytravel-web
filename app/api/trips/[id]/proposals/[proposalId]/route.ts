import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  Activity,
  ActivityProposal,
  ProposalVote,
  ProposalType,
  ProposalStatus,
  ProposalVoteType,
  ProposalResolutionMethod,
  ProposalWithVotes,
} from "@/types";
import {
  calculateProposalConsensus,
  calculateVoteSummary,
} from "@/lib/proposals/consensus";

interface RouteContext {
  params: Promise<{ id: string; proposalId: string }>;
}

/**
 * GET /api/trips/[id]/proposals/[proposalId]
 * Get a specific proposal with votes and consensus status
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

    // Fetch proposal
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select(`
        id,
        trip_id,
        proposed_by,
        type,
        activity_data,
        target_activity_id,
        target_day,
        target_time_slot,
        note,
        status,
        resolved_at,
        resolved_by,
        resolution_method,
        created_at,
        updated_at,
        expires_at,
        proposer:proposed_by (
          display_name,
          avatar_url
        )
      `)
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 }
      );
    }

    // Fetch votes for this proposal
    const { data: votes } = await supabase
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

    // Get total voter count
    const { data: trip } = await supabase
      .from("trips")
      .select("user_id")
      .eq("id", tripId)
      .single();

    const { data: collaborators } = await supabase
      .from("trip_collaborators")
      .select("user_id, role")
      .eq("trip_id", tripId)
      .in("role", ["owner", "editor", "voter"]);

    const voterIds = new Set<string>();
    if (trip?.user_id) voterIds.add(trip.user_id);
    collaborators?.forEach((c) => voterIds.add(c.user_id));
    const totalVoters = voterIds.size;

    // Transform votes
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

    // Calculate consensus
    const voteSummary = calculateVoteSummary(transformedVotes);
    const consensus = calculateProposalConsensus({
      votes: transformedVotes,
      totalVoters,
      createdAt: proposal.created_at,
      expiresAt: proposal.expires_at,
      allVoterIds: Array.from(voterIds),
    });

    // Transform proposal
    const profile = proposal.proposer as unknown as {
      display_name: string;
      avatar_url: string | null;
    } | null;

    const currentUserVote = transformedVotes.find((v) => v.user_id === user.id);

    const transformedProposal: ProposalWithVotes = {
      id: proposal.id,
      trip_id: proposal.trip_id,
      proposed_by: proposal.proposed_by,
      type: proposal.type as ProposalType,
      activity_data: proposal.activity_data as Activity,
      target_activity_id: proposal.target_activity_id || undefined,
      target_day: proposal.target_day,
      target_time_slot: proposal.target_time_slot as 'morning' | 'afternoon' | 'evening' | undefined,
      note: proposal.note || undefined,
      status: proposal.status as ProposalStatus,
      resolved_at: proposal.resolved_at || undefined,
      resolved_by: proposal.resolved_by || undefined,
      resolution_method: proposal.resolution_method as ProposalResolutionMethod | undefined,
      created_at: proposal.created_at,
      updated_at: proposal.updated_at,
      expires_at: proposal.expires_at,
      proposer: profile
        ? {
            display_name: profile.display_name || "Unknown",
            avatar_url: profile.avatar_url || undefined,
          }
        : undefined,
      votes: transformedVotes,
      vote_summary: voteSummary,
      consensus,
      current_user_vote: currentUserVote?.vote_type,
    };

    return NextResponse.json({
      success: true,
      proposal: transformedProposal,
      totalVoters,
    });
  } catch (error) {
    console.error("Error in GET /api/trips/[id]/proposals/[proposalId]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/trips/[id]/proposals/[proposalId]
 * Update proposal status (withdraw by proposer, force-resolve by owner)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const { action, resolutionMethod } = body as {
      action: 'withdraw' | 'approve' | 'reject';
      resolutionMethod?: ProposalResolutionMethod;
    };

    if (!action || !['withdraw', 'approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'withdraw', 'approve', or 'reject'" },
        { status: 400 }
      );
    }

    // Get proposal and trip info
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, trip_id, proposed_by, status")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 }
      );
    }

    // Check if proposal can be modified
    if (!['pending', 'voting'].includes(proposal.status)) {
      return NextResponse.json(
        { error: "This proposal has already been resolved" },
        { status: 400 }
      );
    }

    // Get trip owner
    const { data: trip } = await supabase
      .from("trips")
      .select("user_id")
      .eq("id", tripId)
      .single();

    const isOwner = trip?.user_id === user.id;
    const isProposer = proposal.proposed_by === user.id;

    // Permission checks
    if (action === 'withdraw') {
      if (!isProposer) {
        return NextResponse.json(
          { error: "Only the proposer can withdraw a proposal" },
          { status: 403 }
        );
      }
    } else {
      // approve or reject requires owner
      if (!isOwner) {
        return NextResponse.json(
          { error: "Only the trip owner can force-approve or reject proposals" },
          { status: 403 }
        );
      }
    }

    // Determine new status and resolution method
    let newStatus: ProposalStatus;
    let method: ProposalResolutionMethod;

    switch (action) {
      case 'withdraw':
        newStatus = 'withdrawn';
        method = 'withdrawn';
        break;
      case 'approve':
        newStatus = 'approved';
        method = resolutionMethod || 'owner_override';
        break;
      case 'reject':
        newStatus = 'rejected';
        method = resolutionMethod || 'owner_override';
        break;
      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }

    // Update proposal
    const { data: updatedProposal, error: updateError } = await supabase
      .from("activity_proposals")
      .update({
        status: newStatus,
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        resolution_method: method,
      })
      .eq("id", proposalId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating proposal:", updateError);
      return NextResponse.json(
        { error: "Failed to update proposal" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      proposal: updatedProposal,
      action,
    });
  } catch (error) {
    console.error("Error in PATCH /api/trips/[id]/proposals/[proposalId]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trips/[id]/proposals/[proposalId]
 * Delete a pending proposal (proposer only)
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

    // Get proposal
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, proposed_by, status")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return NextResponse.json(
        { error: "Proposal not found" },
        { status: 404 }
      );
    }

    // Check permissions (only proposer can delete)
    if (proposal.proposed_by !== user.id) {
      return NextResponse.json(
        { error: "Only the proposer can delete a proposal" },
        { status: 403 }
      );
    }

    // Can only delete pending proposals
    if (proposal.status !== 'pending') {
      return NextResponse.json(
        { error: "Only pending proposals can be deleted. Use withdraw for voting proposals." },
        { status: 400 }
      );
    }

    // Delete proposal
    const { error: deleteError } = await supabase
      .from("activity_proposals")
      .delete()
      .eq("id", proposalId);

    if (deleteError) {
      console.error("Error deleting proposal:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete proposal" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Proposal deleted",
    });
  } catch (error) {
    console.error("Error in DELETE /api/trips/[id]/proposals/[proposalId]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
