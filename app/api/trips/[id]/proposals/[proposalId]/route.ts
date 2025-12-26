import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripProposalRouteContext } from "@/lib/api/route-context";
import type {
  Activity,
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

/**
 * GET /api/trips/[id]/proposals/[proposalId]
 * Get a specific proposal with votes and consensus status
 */
export async function GET(request: NextRequest, context: TripProposalRouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

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
      return errors.notFound("Proposal not found");
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

    return apiSuccess({
      success: true,
      proposal: transformedProposal,
      totalVoters,
    });
  } catch (error) {
    console.error("[Proposals] Error fetching proposal:", error);
    return errors.internal("Failed to fetch proposal", "Proposals");
  }
}

/**
 * PATCH /api/trips/[id]/proposals/[proposalId]
 * Update proposal status (withdraw by proposer, force-resolve by owner)
 */
export async function PATCH(request: NextRequest, context: TripProposalRouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Parse request body
    const body = await request.json();
    const { action, resolutionMethod } = body as {
      action: 'withdraw' | 'approve' | 'reject';
      resolutionMethod?: ProposalResolutionMethod;
    };

    if (!action || !['withdraw', 'approve', 'reject'].includes(action)) {
      return errors.badRequest("Invalid action. Must be 'withdraw', 'approve', or 'reject'");
    }

    // Get proposal and trip info
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, trip_id, proposed_by, status")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return errors.notFound("Proposal not found");
    }

    // Check if proposal can be modified
    if (!['pending', 'voting'].includes(proposal.status)) {
      return errors.badRequest("This proposal has already been resolved");
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
        return errors.forbidden("Only the proposer can withdraw a proposal");
      }
    } else {
      // approve or reject requires owner
      if (!isOwner) {
        return errors.forbidden("Only the trip owner can force-approve or reject proposals");
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
        return errors.badRequest("Invalid action");
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
      console.error("[Proposals] Error updating proposal:", updateError);
      return errors.internal("Failed to update proposal", "Proposals");
    }

    return apiSuccess({
      success: true,
      proposal: updatedProposal,
      action,
    });
  } catch (error) {
    console.error("[Proposals] Error updating proposal:", error);
    return errors.internal("Failed to update proposal", "Proposals");
  }
}

/**
 * DELETE /api/trips/[id]/proposals/[proposalId]
 * Delete a pending proposal (proposer only)
 */
export async function DELETE(request: NextRequest, context: TripProposalRouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Get proposal
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, proposed_by, status")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return errors.notFound("Proposal not found");
    }

    // Check permissions (only proposer can delete)
    if (proposal.proposed_by !== user.id) {
      return errors.forbidden("Only the proposer can delete a proposal");
    }

    // Can only delete pending proposals
    if (proposal.status !== 'pending') {
      return errors.badRequest("Only pending proposals can be deleted. Use withdraw for voting proposals.");
    }

    // Delete proposal
    const { error: deleteError } = await supabase
      .from("activity_proposals")
      .delete()
      .eq("id", proposalId);

    if (deleteError) {
      console.error("[Proposals] Error deleting proposal:", deleteError);
      return errors.internal("Failed to delete proposal", "Proposals");
    }

    return apiSuccess({
      success: true,
      message: "Proposal deleted",
    });
  } catch (error) {
    console.error("[Proposals] Error deleting proposal:", error);
    return errors.internal("Failed to delete proposal", "Proposals");
  }
}
