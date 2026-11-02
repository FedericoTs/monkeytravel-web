import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/api/batch-users";
import type {
  Activity,
  ProposalResolutionMethod,
  ProposalStatus,
  ProposalType,
  ProposalVote,
  ProposalVoteType,
  ProposalWithVotes,
} from "@/types";
import { calculateProposalConsensus, calculateVoteSummary } from "./consensus";
import { publicProposer } from "./proposer";

/** The activity_proposals columns a proposal is returned with. */
export const PROPOSAL_COLUMNS =
  "id, trip_id, proposed_by, type, activity_data, target_activity_id, target_day, target_time_slot, note, status, resolved_at, resolved_by, resolution_method, created_at, updated_at, expires_at";

/** The proposal_votes columns a vote is returned with. */
export const VOTE_COLUMNS = "id, proposal_id, user_id, vote_type, comment, rank, voted_at, updated_at";

/** A proposal_votes row as VOTE_COLUMNS reads it. */
export interface VoteRow {
  id: string;
  proposal_id: string;
  user_id: string;
  vote_type: string;
  comment?: string;
  rank?: number;
  voted_at: string;
  updated_at: string;
}

/** An activity_proposals row as PROPOSAL_COLUMNS reads it. */
export interface ProposalRow {
  id: string;
  trip_id: string;
  proposed_by: string;
  type: string;
  activity_data: unknown;
  target_activity_id: string | null;
  target_day: number;
  target_time_slot: string | null;
  note: string | null;
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_method: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

/**
 * A vote with its voter's public name. The names come from public_profiles:
 * public.users shows a caller only their own row, so everyone else read
 * "Unknown".
 */
export function toProposalVote(v: VoteRow, profiles?: Map<string, UserProfile>): ProposalVote {
  const profile = profiles?.get(v.user_id) ?? null;
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
}

/**
 * Who votes on a trip's proposals: its owner, and the collaborators who are
 * owners, editors or voters (viewers do not). Throws when the collaborators
 * cannot be read.
 */
export async function tripVoterIds(
  supabase: SupabaseClient,
  tripId: string,
  ownerId: string | null | undefined
): Promise<string[]> {
  const { data: collaborators, error } = await supabase
    .from("trip_collaborators")
    .select("user_id, role")
    .eq("trip_id", tripId)
    .in("role", ["owner", "editor", "voter"]);
  if (error) throw error;

  const voterIds = new Set<string>();
  if (ownerId) voterIds.add(ownerId);
  collaborators?.forEach((c) => voterIds.add(c.user_id));
  return Array.from(voterIds);
}

/**
 * A proposal as the routes return it: its votes, their summary, where the
 * consensus stands among the trip's voters, and the caller's own vote.
 */
export function toProposalWithVotes(
  p: ProposalRow,
  votes: ProposalVote[],
  { voterIds, profiles, callerId }: { voterIds: string[]; profiles: Map<string, UserProfile>; callerId: string }
): ProposalWithVotes {
  return {
    id: p.id,
    trip_id: p.trip_id,
    proposed_by: p.proposed_by,
    type: p.type as ProposalType,
    activity_data: p.activity_data as Activity,
    target_activity_id: p.target_activity_id || undefined,
    target_day: p.target_day,
    target_time_slot: p.target_time_slot as "morning" | "afternoon" | "evening" | undefined,
    note: p.note || undefined,
    status: p.status as ProposalStatus,
    resolved_at: p.resolved_at || undefined,
    resolved_by: p.resolved_by || undefined,
    resolution_method: (p.resolution_method || undefined) as ProposalResolutionMethod | undefined,
    created_at: p.created_at,
    updated_at: p.updated_at,
    expires_at: p.expires_at,
    proposer: publicProposer(profiles.get(p.proposed_by)),
    votes,
    vote_summary: calculateVoteSummary(votes),
    consensus: calculateProposalConsensus({
      votes,
      totalVoters: voterIds.length,
      createdAt: p.created_at,
      expiresAt: p.expires_at,
      allVoterIds: voterIds,
    }),
    current_user_vote: votes.find((v) => v.user_id === callerId)?.vote_type,
  };
}
