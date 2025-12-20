import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  Activity,
  ActivityProposal,
  ProposalVote,
  ProposalType,
  ProposalStatus,
  ProposalVoteType,
  ProposalWithVotes,
} from "@/types";
import {
  calculateProposalConsensus,
  calculateVoteSummary,
} from "@/lib/proposals/consensus";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/trips/[id]/proposals
 * Get all proposals for a trip with votes and consensus status
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

    // Parse query params for filtering
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status"); // pending, voting, approved, rejected, all
    const dayFilter = searchParams.get("day"); // day number
    const timeSlotFilter = searchParams.get("timeSlot"); // morning, afternoon, evening

    // Build query
    let query = supabase
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
      console.error("Error fetching proposals:", proposalsError);
      return NextResponse.json(
        { error: "Failed to fetch proposals" },
        { status: 500 }
      );
    }

    if (!proposals || proposals.length === 0) {
      return NextResponse.json({
        success: true,
        proposals: [],
        totalVoters: 0,
      });
    }

    // Fetch all votes for these proposals
    const proposalIds = proposals.map((p) => p.id);
    const { data: votes, error: votesError } = await supabase
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
      .in("proposal_id", proposalIds);

    if (votesError) {
      console.error("Error fetching proposal votes:", votesError);
      // Continue without votes rather than failing
    }

    // Get total voter count (owner + collaborators with vote rights)
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

    // Count unique voters (owner + eligible collaborators)
    const voterIds = new Set<string>();
    if (trip?.user_id) {
      voterIds.add(trip.user_id);
    }
    collaborators?.forEach((c) => voterIds.add(c.user_id));
    const totalVoters = voterIds.size;

    // Group votes by proposal
    const votesByProposal = new Map<string, ProposalVote[]>();
    (votes || []).forEach((v) => {
      const profile = v.user as unknown as {
        display_name: string;
        avatar_url: string | null;
      } | null;

      const transformedVote: ProposalVote = {
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

      const existing = votesByProposal.get(v.proposal_id) || [];
      existing.push(transformedVote);
      votesByProposal.set(v.proposal_id, existing);
    });

    // Transform proposals with votes and consensus
    const transformedProposals: ProposalWithVotes[] = proposals.map((p) => {
      const profile = p.proposer as unknown as {
        display_name: string;
        avatar_url: string | null;
      } | null;

      const proposalVotes = votesByProposal.get(p.id) || [];
      const voteSummary = calculateVoteSummary(proposalVotes);
      const consensus = calculateProposalConsensus({
        votes: proposalVotes,
        totalVoters,
        createdAt: p.created_at,
        expiresAt: p.expires_at,
        allVoterIds: Array.from(voterIds),
      });

      // Find current user's vote
      const currentUserVoteObj = proposalVotes.find((v) => v.user_id === user.id);

      return {
        id: p.id,
        trip_id: p.trip_id,
        proposed_by: p.proposed_by,
        type: p.type as ProposalType,
        activity_data: p.activity_data as Activity,
        target_activity_id: p.target_activity_id || undefined,
        target_day: p.target_day,
        target_time_slot: p.target_time_slot as 'morning' | 'afternoon' | 'evening' | undefined,
        note: p.note || undefined,
        status: p.status as ProposalStatus,
        resolved_at: p.resolved_at || undefined,
        resolved_by: p.resolved_by || undefined,
        resolution_method: p.resolution_method || undefined,
        created_at: p.created_at,
        updated_at: p.updated_at,
        expires_at: p.expires_at,
        proposer: profile
          ? {
              display_name: profile.display_name || "Unknown",
              avatar_url: profile.avatar_url || undefined,
            }
          : undefined,
        votes: proposalVotes,
        vote_summary: voteSummary,
        consensus,
        current_user_vote: currentUserVoteObj?.vote_type,
      };
    });

    return NextResponse.json({
      success: true,
      proposals: transformedProposals,
      totalVoters,
    });
  } catch (error) {
    console.error("Error in GET /api/trips/[id]/proposals:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trips/[id]/proposals
 * Create a new activity proposal
 */
export async function POST(request: NextRequest, context: RouteContext) {
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

    // Parse request body
    const body = await request.json();
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
      return NextResponse.json(
        { error: "Invalid proposal type. Must be 'new' or 'replacement'" },
        { status: 400 }
      );
    }

    if (!activityData || !activityData.name) {
      return NextResponse.json(
        { error: "Activity data with name is required" },
        { status: 400 }
      );
    }

    if (typeof targetDay !== 'number' || targetDay < 0) {
      return NextResponse.json(
        { error: "Valid target day (0 or greater) is required" },
        { status: 400 }
      );
    }

    if (type === 'replacement' && !targetActivityId) {
      return NextResponse.json(
        { error: "Target activity ID is required for replacement proposals" },
        { status: 400 }
      );
    }

    // Check trip exists and user has permission
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
    let canPropose = isOwner;
    if (!isOwner) {
      const { data: collab } = await supabase
        .from("trip_collaborators")
        .select("role")
        .eq("trip_id", tripId)
        .eq("user_id", user.id)
        .single();

      // Voters can suggest (canSuggest permission)
      canPropose = collab?.role === "editor" || collab?.role === "voter";
    }

    if (!canPropose) {
      return NextResponse.json(
        { error: "You don't have permission to propose activities on this trip" },
        { status: 403 }
      );
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
        expires_at,
        proposer:proposed_by (
          display_name,
          avatar_url
        )
      `)
      .single();

    if (insertError) {
      console.error("Error creating proposal:", insertError);
      return NextResponse.json(
        { error: "Failed to create proposal" },
        { status: 500 }
      );
    }

    // Transform response
    const profile = proposal.proposer as unknown as {
      display_name: string;
      avatar_url: string | null;
    } | null;

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
      proposer: profile
        ? {
            display_name: profile.display_name || "Unknown",
            avatar_url: profile.avatar_url || undefined,
          }
        : undefined,
    };

    return NextResponse.json({
      success: true,
      proposal: transformedProposal,
    });
  } catch (error) {
    console.error("Error in POST /api/trips/[id]/proposals:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
