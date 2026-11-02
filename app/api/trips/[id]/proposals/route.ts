import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { batchFetchUserProfiles } from "@/lib/api/batch-users";
import type { TripRouteContext } from "@/lib/api/route-context";
import type {
  Activity,
  ActivityProposal,
  ProposalVote,
  ProposalType,
  ProposalStatus,
  ProposalWithVotes,
} from "@/types";
import { publicProposer } from "@/lib/proposals/proposer";
import {
  PROPOSAL_COLUMNS,
  VOTE_COLUMNS,
  toProposalVote,
  toProposalWithVotes,
  tripVoterIds,
} from "@/lib/proposals/read";
import { readJsonBody } from "@/lib/api/json-body";

/**
 * GET /api/trips/[id]/proposals
 * Get all proposals for a trip with votes and consensus status
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // SECURITY: trip access first, or any signed-in caller could list
    // proposals + voter PII for ANY trip just by knowing its UUID. Owner or
    // any collaborator
    // (editor / voter / viewer) can read proposals — same scope as
    // who can see the trip itself.
    const { trip, errorResponse: accessError } = await verifyTripAccess(
      supabase,
      tripId,
      user.id
    );
    if (accessError) return accessError;

    // Parse query params for filtering
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status"); // pending, voting, approved, rejected, all
    const rawDay = searchParams.get("day"); // day number — VALIDATED below
    const dayFilter = rawDay !== null && /^\d+$/.test(rawDay) ? rawDay : null;
    const timeSlotFilter = searchParams.get("timeSlot"); // morning, afternoon, evening

    // Build query
    let query = supabase
      .from("activity_proposals")
      .select(PROPOSAL_COLUMNS)
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });

    // Apply filters
    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "active") {
        // Active = pending or voting
        query = query.in("status", ["pending", "voting"]);
      } else {
        query = query.eq("status", statusFilter);
      }
    }

    if (dayFilter) {
      query = query.eq("target_day", parseInt(dayFilter, 10));
    }

    if (timeSlotFilter) {
      query = query.eq("target_time_slot", timeSlotFilter);
    }

    const { data: proposals, error: proposalsError } = await query;

    if (proposalsError) {
      console.error("[Proposals] Error fetching proposals:", proposalsError);
      return errors.internal("Failed to fetch proposals", "Proposals");
    }

    if (!proposals || proposals.length === 0) {
      return apiSuccess({
        success: true,
        proposals: [],
        totalVoters: 0,
      });
    }

    // Fetch all votes for these proposals
    const proposalIds = proposals.map((p) => p.id);
    const { data: votes, error: votesError } = await supabase
      .from("proposal_votes")
      .select(VOTE_COLUMNS)
      .in("proposal_id", proposalIds);

    if (votesError) {
      console.error("Error fetching proposal votes:", votesError);
      // Continue without votes rather than failing
    }

    const voterIds = await tripVoterIds(supabase, tripId, trip?.user_id);
    const profiles = await batchFetchUserProfiles(supabase, [
      ...(votes || []).map((v) => v.user_id as string),
      ...proposals.map((p) => p.proposed_by as string),
    ]);

    // Group votes by proposal
    const votesByProposal = new Map<string, ProposalVote[]>();
    (votes || []).forEach((v) => {
      const existing = votesByProposal.get(v.proposal_id) || [];
      existing.push(toProposalVote(v, profiles));
      votesByProposal.set(v.proposal_id, existing);
    });

    const transformedProposals: ProposalWithVotes[] = proposals.map((p) =>
      toProposalWithVotes(p, votesByProposal.get(p.id) || [], { voterIds, profiles, callerId: user.id })
    );

    return apiSuccess({
      success: true,
      proposals: transformedProposals,
      totalVoters: voterIds.length,
    });
  } catch (error) {
    console.error("[Proposals] Error fetching proposals:", error);
    return errors.internal("Failed to fetch proposals", "Proposals");
  }
}

/**
 * POST /api/trips/[id]/proposals
 * Create a new activity proposal
 */
export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Parse request body
    const { body, invalidBody } = await readJsonBody(request);
    if (invalidBody) return invalidBody;
    const {
      type,
      activityData,
      targetActivityId,
      targetDay,
      targetTimeSlot,
      note,
    } = body as {
      type: ProposalType;
      activityData: Activity;
      targetActivityId?: string;
      targetDay: number;
      targetTimeSlot?: 'morning' | 'afternoon' | 'evening';
      note?: string;
    };

    // Validate required fields
    if (!type || !['new', 'replacement'].includes(type)) {
      return errors.badRequest("Invalid proposal type. Must be 'new' or 'replacement'");
    }

    if (!activityData || !activityData.name) {
      return errors.badRequest("Activity data with name is required");
    }

    // The day's day_number: Day 1 is 1.
    if (!Number.isInteger(targetDay) || targetDay < 1) {
      return errors.badRequest("Valid target day (1 or greater) is required");
    }

    if (type === 'replacement' && !targetActivityId) {
      return errors.badRequest("Target activity ID is required for replacement proposals");
    }

    // The owner, editors and voters may propose (voters can suggest). The
    // propose sheet shows this route's own 403 text, so the role is checked here.
    const { isOwner, collaboratorRole, errorResponse: accessError } = await verifyTripAccess(supabase, tripId, user.id);
    if (accessError) return accessError;

    if (!isOwner && collaboratorRole !== "editor" && collaboratorRole !== "voter") {
      return errors.forbidden("You don't have permission to propose activities on this trip");
    }

    // Ensure activity has an ID
    const activityWithId = {
      ...activityData,
      id: activityData.id || `proposed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    // Create the proposal
    const { data: proposal, error: insertError } = await supabase
      .from("activity_proposals")
      .insert({
        trip_id: tripId,
        proposed_by: user.id,
        type,
        activity_data: activityWithId,
        target_activity_id: targetActivityId || null,
        target_day: targetDay,
        target_time_slot: targetTimeSlot || null,
        note: note?.trim() || null,
        status: 'pending',
      })
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
        created_at,
        updated_at,
        expires_at
      `)
      .single();

    if (insertError) {
      console.error("[Proposals] Error creating proposal:", insertError);
      return errors.internal("Failed to create proposal", "Proposals");
    }

    // Transform response
    const profiles = await batchFetchUserProfiles(supabase, [user.id]);
    const proposer = publicProposer(profiles.get(user.id), user.email);

    const transformedProposal: ActivityProposal = {
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
      created_at: proposal.created_at,
      updated_at: proposal.updated_at,
      expires_at: proposal.expires_at,
      proposer,
    };

    return apiSuccess({
      success: true,
      proposal: transformedProposal,
    });
  } catch (error) {
    console.error("[Proposals] Error creating proposal:", error);
    return errors.internal("Failed to create proposal", "Proposals");
  }
}
