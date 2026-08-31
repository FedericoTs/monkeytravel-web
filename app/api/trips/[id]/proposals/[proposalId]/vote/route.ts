import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { batchFetchUserProfiles } from "@/lib/api/batch-users";
import type { TripProposalRouteContext } from "@/lib/api/route-context";
import type { ProposalVote, ProposalVoteType, Activity, ItineraryDay } from "@/types";
import { calculateProposalConsensus, calculateVoteSummary } from "@/lib/proposals/consensus";
import { PROPOSAL_TIMING } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateActivityId } from "@/lib/utils/activity-id";

/**
 * GET /api/trips/[id]/proposals/[proposalId]/vote
 * Get all votes for a specific proposal
 */
export async function GET(request: NextRequest, context: TripProposalRouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // SECURITY (bug-bounty 2026-05-24 P0): trip-access check first.
    // Previously any authenticated user could read votes on any proposal
    // just by knowing the IDs.
    const { errorResponse: accessError } = await verifyTripAccess(
      supabase,
      tripId,
      user.id
    );
    if (accessError) return accessError;

    // Verify proposal exists and belongs to trip
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, trip_id")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return errors.notFound("Proposal not found");
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
        updated_at
      `)
      .eq("proposal_id", proposalId)
      .order("voted_at", { ascending: true });

    if (error) {
      console.error("[Proposal Vote] Error fetching votes:", error);
      return errors.internal("Failed to fetch votes", "Proposal Vote");
    }

    // Transform to include user info at top level
    // Voter names come from public_profiles rather than an embed on users.
    // The people who voted on a proposal are by definition not the caller, and
    // public.users only exposes the caller's own row — an embed there would not
    // error, it would return null for everyone and silently label the whole
    // crew "Unknown".
    const profileMap = await batchFetchUserProfiles(
      supabase,
      (votes || []).map((v) => v.user_id as string)
    );

    const transformedVotes: ProposalVote[] = (votes || []).map((v) => {
      const profile = profileMap.get(v.user_id as string) ?? null;

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

    return apiSuccess({
      success: true,
      votes: transformedVotes,
      currentUserVote: currentUserVote || null,
    });
  } catch (error) {
    console.error("[Proposal Vote] Unexpected error in GET:", error);
    return errors.internal("Internal server error", "Proposal Vote");
  }
}

/**
 * POST /api/trips/[id]/proposals/[proposalId]/vote
 * Cast or update a vote on a proposal
 */
export async function POST(request: NextRequest, context: TripProposalRouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Parse request body
    const body = await request.json();
    const { voteType, comment } = body as {
      voteType: ProposalVoteType;
      comment?: string;
    };

    // Validate vote type - 4-level voting unified with activity voting
    const validVoteTypes: ProposalVoteType[] = ["love", "flexible", "concerns", "no"];
    if (!voteType || !validVoteTypes.includes(voteType)) {
      return errors.badRequest("Invalid vote type. Must be 'love', 'flexible', 'concerns', or 'no'");
    }

    // Require comment for negative votes (concerns and no)
    if ((voteType === 'concerns' || voteType === 'no') && !comment?.trim()) {
      return errors.badRequest(`A comment is required when voting '${voteType}' to help the group understand your perspective`);
    }

    // Verify proposal exists and is votable
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, trip_id, status, proposed_by")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return errors.notFound("Proposal not found");
    }

    // Check if proposal is still open for voting
    if (!['pending', 'voting'].includes(proposal.status)) {
      return errors.badRequest("This proposal is no longer open for voting");
    }

    // Check if user has permission to vote
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
      .from("proposal_votes")
      .select("id")
      .eq("proposal_id", proposalId)
      .eq("user_id", user.id)
      .single();

    // Whether the consensus follow-up work actually landed. Both start true
    // and only the failure paths below can clear them, so a route that never
    // reaches consensus reports the honest "nothing to apply" default.
    let consensusApplied = true;
    let activityAdded = true;

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
        console.error("[Proposal Vote] Error updating vote:", updateError);
        return errors.internal("Failed to update vote", "Proposal Vote");
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
        console.error("[Proposal Vote] Error inserting vote:", insertError);
        return errors.internal("Failed to cast vote", "Proposal Vote");
      }
      vote = newVote;
    }

    // After vote is recorded, check for consensus and auto-update proposal status
    try {
      // Get all votes for this proposal
      const { data: allVotes } = await supabase
        .from("proposal_votes")
        .select("id, proposal_id, user_id, vote_type, comment, voted_at")
        .eq("proposal_id", proposalId);

      // Get total voter count (owner + all editors/voters)
      const { count: collaboratorCount } = await supabase
        .from("trip_collaborators")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", tripId)
        .in("role", ["editor", "voter"]);

      const totalVoters = 1 + (collaboratorCount || 0); // +1 for owner

      // Get proposal created_at and expires_at
      const { data: proposalDetails } = await supabase
        .from("activity_proposals")
        .select("created_at, expires_at")
        .eq("id", proposalId)
        .single();

      if (proposalDetails && allVotes) {
        const expiresAt = proposalDetails.expires_at ||
          new Date(new Date(proposalDetails.created_at).getTime() + PROPOSAL_TIMING.EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const consensus = calculateProposalConsensus({
          votes: allVotes.map(v => ({
            id: v.id,
            proposal_id: v.proposal_id,
            user_id: v.user_id,
            vote_type: v.vote_type as ProposalVoteType,
            comment: v.comment,
            voted_at: v.voted_at,
            updated_at: v.voted_at, // Use voted_at as updated_at for simplicity
          })),
          totalVoters,
          createdAt: proposalDetails.created_at,
          expiresAt,
        });

        // Auto-update proposal status if consensus is reached.
        //
        // WHY THIS RUNS ELEVATED, AND WHY IT CHECKS THE ROW COUNT
        // -------------------------------------------------------
        // Applying a reached consensus is the SYSTEM acting on a decision the
        // crew already made — it is not the individual voter editing the trip.
        // Written through the voter's own RLS-scoped client it simply did not
        // happen, silently:
        //
        //   activity_proposals_update_consolidated allows the owner, or the
        //   proposer while status is still pending/voting. Its WITH CHECK
        //   re-tests the NEW row, so status='approved' is rejected even FOR
        //   the proposer.
        //   trips_update allows the owner or an 'editor' collaborator — but
        //   this route lets 'voter' vote, and `voter` is the DEFAULT and
        //   recommended role in the invite UI.
        //
        // So whenever the deciding vote came from anyone but the owner, both
        // writes matched zero rows. PostgREST answers a zero-row UPDATE with
        // 204 and error:null, the result here was not even destructured, and
        // the next line logged success. The crew saw the proposal approved and
        // the activity was never in the itinerary — permanently, because this
        // is the only path that inserts it.
        //
        // Elevated does not mean unchecked: consensus was computed server-side
        // from stored votes, and every write below asserts it changed a row.
        if (consensus.status === 'approved' || consensus.status === 'rejected') {
          const admin = createAdminClient();

          const { data: resolvedRows, error: resolveError } = await admin
            .from("activity_proposals")
            .update({
              status: consensus.status,
              resolved_at: new Date().toISOString(),
            })
            .eq("id", proposalId)
            .select("id");

          if (resolveError || !resolvedRows?.length) {
            // Do not fall through to the itinerary write: that would add the
            // activity while the proposal still reads as open, and every
            // later vote would add it again.
            console.error("[proposal vote] could not resolve proposal", {
              proposalId,
              error: resolveError?.message ?? "matched no rows",
            });
            throw new Error("Could not record the proposal outcome");
          }

          // If APPROVED: Add the activity to the trip's itinerary
          if (consensus.status === 'approved') {
            try {
              // Get the full proposal with activity_data
              const { data: fullProposal } = await supabase
                .from("activity_proposals")
                .select("activity_data, target_day, target_time_slot, type")
                .eq("id", proposalId)
                .single();

              if (fullProposal?.activity_data && fullProposal.target_day) {
                const activityData = fullProposal.activity_data as Activity;
                const targetDayNumber = fullProposal.target_day;

                // Get the current trip itinerary
                const { data: tripData } = await supabase
                  .from("trips")
                  .select("itinerary")
                  .eq("id", tripId)
                  .single();

                if (tripData?.itinerary) {
                  const itinerary = tripData.itinerary as ItineraryDay[];
                  const targetDayIndex = targetDayNumber - 1;

                  if (targetDayIndex >= 0 && targetDayIndex < itinerary.length) {
                    // Create the new activity with a unique ID
                    const newActivity: Activity = {
                      ...activityData,
                      id: activityData.id || generateActivityId(),
                    };

                    // Add to the target day's activities
                    const updatedItinerary = itinerary.map((day, index) => {
                      if (index === targetDayIndex) {
                        // Insert activity and sort by start_time
                        const activities = [...day.activities, newActivity].sort((a, b) => {
                          const timeA = a.start_time || "00:00";
                          const timeB = b.start_time || "00:00";
                          return timeA.localeCompare(timeB);
                        });
                        return { ...day, activities };
                      }
                      return day;
                    });

                    // Update the trip with the new itinerary.
                    // `.select()` is load-bearing — see the note above.
                    const { data: writtenRows, error: itineraryError } = await admin
                      .from("trips")
                      .update({
                        itinerary: updatedItinerary,
                        updated_at: new Date().toISOString(),
                      })
                      .eq("id", tripId)
                      .select("id");

                    if (itineraryError || !writtenRows?.length) {
                      console.error("[proposal vote] approved activity was NOT added", {
                        tripId,
                        proposalId,
                        activity: newActivity.name,
                        error: itineraryError?.message ?? "matched no rows",
                      });
                      throw new Error("Could not add the approved activity to the itinerary");
                    }

                    console.log(`Activity "${newActivity.name}" added to Day ${targetDayNumber} after proposal approval`);
                  }
                }
              }
            } catch (insertError) {
              // The vote IS recorded, so the request is not a failure — but the
              // caller must not be told the activity landed when it did not.
              // The response now carries `activityAdded`, and this is the one
              // place that can set it false.
              console.error("Error adding approved activity to itinerary:", insertError);
              activityAdded = false;
            }
          }
        }
      }
    } catch (consensusError) {
      // Log but don't fail the request - vote was still recorded
      console.error("Error checking consensus:", consensusError);
      consensusApplied = false;
    }

    return apiSuccess({
      success: true,
      vote,
      isUpdate: !!existingVote,
      // Honest about the second half of the work. The vote is saved either
      // way; these say whether the consensus that vote triggered was actually
      // written. Previously the response said `success: true` while both
      // writes had silently matched zero rows.
      consensusApplied,
      activityAdded,
    });
  } catch (error) {
    console.error("[Proposal Vote] Unexpected error in POST:", error);
    return errors.internal("Internal server error", "Proposal Vote");
  }
}

/**
 * DELETE /api/trips/[id]/proposals/[proposalId]/vote
 * Remove user's vote from a proposal
 */
export async function DELETE(request: NextRequest, context: TripProposalRouteContext) {
  try {
    const { id: tripId, proposalId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify proposal exists
    const { data: proposal, error: proposalError } = await supabase
      .from("activity_proposals")
      .select("id, trip_id, status")
      .eq("id", proposalId)
      .eq("trip_id", tripId)
      .single();

    if (proposalError || !proposal) {
      return errors.notFound("Proposal not found");
    }

    // Check if proposal is still open
    if (!['pending', 'voting'].includes(proposal.status)) {
      return errors.badRequest("Cannot remove vote from a resolved proposal");
    }

    // Delete the user's vote
    const { error } = await supabase
      .from("proposal_votes")
      .delete()
      .eq("proposal_id", proposalId)
      .eq("user_id", user.id);

    if (error) {
      console.error("[Proposal Vote] Error deleting vote:", error);
      return errors.internal("Failed to remove vote", "Proposal Vote");
    }

    return apiSuccess({
      success: true,
      message: "Vote removed",
    });
  } catch (error) {
    console.error("[Proposal Vote] Unexpected error in DELETE:", error);
    return errors.internal("Internal server error", "Proposal Vote");
  }
}
