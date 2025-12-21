import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ProposalVote, ProposalVoteType, Activity, ItineraryDay } from "@/types";
import { calculateProposalConsensus, calculateVoteSummary } from "@/lib/proposals/consensus";
import { PROPOSAL_TIMING } from "@/types";
import { generateActivityId } from "@/lib/utils/activity-id";

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

    // Validate vote type - 4-level voting unified with activity voting
    const validVoteTypes: ProposalVoteType[] = ["love", "flexible", "concerns", "no"];
    if (!voteType || !validVoteTypes.includes(voteType)) {
      return NextResponse.json(
        { error: "Invalid vote type. Must be 'love', 'flexible', 'concerns', or 'no'" },
        { status: 400 }
      );
    }

    // Require comment for negative votes (concerns and no)
    if ((voteType === 'concerns' || voteType === 'no') && !comment?.trim()) {
      return NextResponse.json(
        { error: `A comment is required when voting '${voteType}' to help the group understand your perspective` },
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

        // Auto-update proposal status if consensus is reached
        if (consensus.status === 'approved' || consensus.status === 'rejected') {
          await supabase
            .from("activity_proposals")
            .update({
              status: consensus.status,
              resolved_at: new Date().toISOString(),
            })
            .eq("id", proposalId);

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

                    // Update the trip with the new itinerary
                    await supabase
                      .from("trips")
                      .update({
                        itinerary: updatedItinerary,
                        updated_at: new Date().toISOString(),
                      })
                      .eq("id", tripId);

                    console.log(`Activity "${newActivity.name}" added to Day ${targetDayNumber} after proposal approval`);
                  }
                }
              }
            } catch (insertError) {
              // Log but don't fail - the proposal was still approved
              console.error("Error adding approved activity to itinerary:", insertError);
            }
          }
        }
      }
    } catch (consensusError) {
      // Log but don't fail the request - vote was still recorded
      console.error("Error checking consensus:", consensusError);
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
