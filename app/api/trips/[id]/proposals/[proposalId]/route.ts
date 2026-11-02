import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { errors, apiError, apiSuccess } from "@/lib/api/response-wrapper";
import { batchFetchUserProfiles } from "@/lib/api/batch-users";
import type { TripProposalRouteContext } from "@/lib/api/route-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveProposal, type ApproveOutcome } from "@/lib/proposals/approve";
import {
  PROPOSAL_COLUMNS,
  VOTE_COLUMNS,
  toProposalVote,
  toProposalWithVotes,
  tripVoterIds,
} from "@/lib/proposals/read";
import { logReadError } from "@/lib/supabase/log-read-error";
import type { ProposalStatus, ProposalResolutionMethod } from "@/types";
import { readJsonBody } from "@/lib/api/json-body";
import { requireRow } from "@/lib/api/require-row";

/** Why an owner's approval did not land. */
function approveFailed(reason: Extract<ApproveOutcome, { ok: false }>["reason"], day: number) {
  switch (reason) {
    case "no_day":
      return errors.conflict(`Day ${day} is no longer in this trip`);
    case "busy":
      return apiError("This trip is being edited right now. Please try again.", { status: 409, code: "ITINERARY_BUSY" });
    case "resolved":
      return errors.badRequest("This proposal has already been resolved");
    case "not_found":
      return errors.notFound("Trip not found");
    default:
      return errors.internal("Failed to approve proposal", "Proposals");
  }
}

/**
 * GET /api/trips/[id]/proposals/[proposalId]
 * Get a specific proposal with votes and consensus status
 */
export async function GET(request: NextRequest, context: TripProposalRouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // SECURITY: trip access first, or any signed-in user could fetch any
    // proposal (including voter PII) just by knowing tripId + proposalId.
    const { trip, errorResponse: accessError } = await verifyTripAccess(
      supabase,
      tripId,
      user.id
    );
    if (accessError) return accessError;

    const { row: proposal, errorResponse: proposalError } = await requireRow("proposal", supabase
      .from("activity_proposals")
      .select(PROPOSAL_COLUMNS)
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single(), "Proposal not found");
    if (proposalError) return proposalError;

    const { data: votes, error: votesError } = await supabase
      .from("proposal_votes")
      .select(VOTE_COLUMNS)
      .eq("proposal_id", proposalId)
      .order("voted_at", { ascending: true });
    if (votesError) throw votesError;

    const voterIds = await tripVoterIds(supabase, tripId, trip?.user_id);
    const profiles = await batchFetchUserProfiles(supabase, [
      ...(votes || []).map((v) => v.user_id as string),
      proposal.proposed_by as string,
    ]);

    return apiSuccess({
      success: true,
      proposal: toProposalWithVotes(proposal, (votes || []).map((v) => toProposalVote(v, profiles)), {
        voterIds,
        profiles,
        callerId: user.id,
      }),
      totalVoters: voterIds.length,
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
    const { body, invalidBody } = await readJsonBody(request);
    if (invalidBody) return invalidBody;
    const { action, resolutionMethod } = body as {
      action: 'withdraw' | 'approve' | 'reject';
      resolutionMethod?: ProposalResolutionMethod;
    };

    if (!action || !['withdraw', 'approve', 'reject'].includes(action)) {
      return errors.badRequest("Invalid action. Must be 'withdraw', 'approve', or 'reject'");
    }

    // Get proposal and trip info
    const { row: proposal, errorResponse: proposalError } = await requireRow("proposal", supabase
      .from("activity_proposals")
      .select("id, trip_id, proposed_by, status, target_day, activity_data")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single(), "Proposal not found");
    if (proposalError) return proposalError;

    // Check if proposal can be modified
    if (!['pending', 'voting'].includes(proposal.status)) {
      return errors.badRequest("This proposal has already been resolved");
    }

    // The owner may force-resolve; the proposer may withdraw.
    const { isOwner, errorResponse: accessError } = await verifyTripAccess(supabase, tripId, user.id);
    if (accessError) return accessError;
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

    // The same path as an approval by votes: the activity goes into the trip,
    // then the proposal reads approved.
    if (action === 'approve') {
      const outcome = await approveProposal(createAdminClient(), proposal, { method, resolvedBy: user.id });
      if (!outcome.ok) return approveFailed(outcome.reason, proposal.target_day);
      const { data: approved } = logReadError("proposal approve: re-read", await supabase
        .from("activity_proposals")
        .select()
        .eq("id", proposalId)
        .single());
      return apiSuccess({ success: true, proposal: approved, action, activityAdded: true });
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
    const { row: proposal, errorResponse: proposalError } = await requireRow("proposal", supabase
      .from("activity_proposals")
      .select("id, proposed_by, status")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single(), "Proposal not found");
    if (proposalError) return proposalError;

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
