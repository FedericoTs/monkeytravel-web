/**
 * Proposal Consensus Calculation Algorithm
 *
 * Implements a binary voting system for group decision-making on activity proposals.
 * Simpler than activity voting (4-point scale) since proposals are approve/reject decisions.
 *
 * Vote Weights:
 * - approve: +2 (support the proposal)
 * - reject: -2 (oppose the proposal)
 *
 * Decision Rules:
 * 1. Minimum 50% participation required for resolution
 * 2. Score >= 1.5 → Instant approval (strong consensus)
 * 3. Score >= 0.5 && 48h passed → Auto-approve (time-based majority)
 * 4. Score <= -1 → Reject
 * 5. Mixed votes && 72h passed → Deadlock (escalate to owner)
 * 6. 7 days passed → Expire (no action taken)
 * 7. Otherwise → Continue voting
 */

import {
  ProposalVote,
  ProposalVoteType,
  ProposalConsensusResult,
  PROPOSAL_VOTE_WEIGHTS,
  PROPOSAL_TIMING,
} from '@/types';

export interface ProposalConsensusInput {
  votes: ProposalVote[];
  totalVoters: number;
  createdAt: Date | string;
  expiresAt: Date | string;
  allVoterIds?: string[];
}

export interface ProposalVoteCounts {
  approve: number;
  reject: number;
}

// Re-export the type from @/types
export type { ProposalConsensusResult } from '@/types';

/**
 * Calculate consensus status for a proposal based on votes
 */
export function calculateProposalConsensus({
  votes,
  totalVoters,
  createdAt,
  expiresAt,
  allVoterIds = [],
}: ProposalConsensusInput): ProposalConsensusResult {
  const {
    AUTO_APPROVE_HOURS,
    DEADLOCK_HOURS,
    MIN_PARTICIPATION,
    STRONG_CONSENSUS_SCORE,
    REJECTION_THRESHOLD,
  } = PROPOSAL_TIMING;

  // Initialize vote counts
  const voteCounts: ProposalVoteCounts = {
    approve: 0,
    reject: 0,
  };

  // Parse dates
  const createdDate = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const expiresDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const now = Date.now();

  // Calculate hours since created and until expiry
  const hoursSinceCreated = (now - createdDate.getTime()) / (1000 * 60 * 60);
  const hoursRemaining = Math.max(0, (expiresDate.getTime() - now) / (1000 * 60 * 60));

  // Check if expired
  if (now >= expiresDate.getTime()) {
    return {
      status: 'expired',
      score: 0,
      participation: votes.length / Math.max(1, totalVoters),
      hasStrongObjection: votes.some(v => v.vote_type === 'reject'),
      canAutoApprove: false,
      voteCounts,
      pendingVoters: allVoterIds,
      hoursRemaining: 0,
    };
  }

  // Default result for no votes
  if (votes.length === 0) {
    return {
      status: 'waiting',
      score: 0,
      participation: 0,
      hasStrongObjection: false,
      canAutoApprove: false,
      voteCounts,
      pendingVoters: allVoterIds,
      hoursRemaining,
    };
  }

  // Calculate weighted score and count votes
  let totalWeight = 0;
  let hasStrongObjection = false;
  const votedUserIds = new Set<string>();

  for (const vote of votes) {
    const weight = PROPOSAL_VOTE_WEIGHTS[vote.vote_type];
    totalWeight += weight;
    voteCounts[vote.vote_type]++;
    votedUserIds.add(vote.user_id);

    if (vote.vote_type === 'reject') {
      hasStrongObjection = true;
    }
  }

  // Calculate metrics
  const participation = totalVoters > 0 ? votes.length / totalVoters : 0;
  const avgScore = votes.length > 0 ? totalWeight / votes.length : 0;

  // Find pending voters
  const pendingVoters = allVoterIds.filter(id => !votedUserIds.has(id));

  // Decision logic

  // Rule 1: Not enough participation yet
  if (participation < MIN_PARTICIPATION) {
    return {
      status: 'waiting',
      score: avgScore,
      participation,
      hasStrongObjection,
      canAutoApprove: false,
      voteCounts,
      pendingVoters,
      hoursRemaining,
    };
  }

  // Rule 2: Strong consensus (instant approval)
  if (avgScore >= STRONG_CONSENSUS_SCORE) {
    return {
      status: 'approved',
      score: avgScore,
      participation,
      hasStrongObjection,
      canAutoApprove: true,
      voteCounts,
      pendingVoters,
      hoursRemaining,
    };
  }

  // Rule 3: Majority approval with time elapsed (auto-approve)
  if (avgScore >= 0.5 && hoursSinceCreated >= AUTO_APPROVE_HOURS) {
    return {
      status: 'approved',
      score: avgScore,
      participation,
      hasStrongObjection,
      canAutoApprove: true,
      voteCounts,
      pendingVoters,
      hoursRemaining,
    };
  }

  // Rule 4: Clear rejection
  if (avgScore <= REJECTION_THRESHOLD) {
    return {
      status: 'rejected',
      score: avgScore,
      participation,
      hasStrongObjection,
      canAutoApprove: false,
      voteCounts,
      pendingVoters,
      hoursRemaining,
    };
  }

  // Rule 5: Deadlock (rejection votes + time elapsed without resolution)
  if (hasStrongObjection && hoursSinceCreated >= DEADLOCK_HOURS) {
    return {
      status: 'deadlock',
      score: avgScore,
      participation,
      hasStrongObjection,
      canAutoApprove: false,
      voteCounts,
      pendingVoters,
      hoursRemaining,
    };
  }

  // Rule 6: Continue voting
  // Determine if trending towards approval or still uncertain
  const status = avgScore >= 0.5 ? 'likely_approve' : 'voting';

  return {
    status,
    score: avgScore,
    participation,
    hasStrongObjection,
    canAutoApprove: avgScore >= 0.5 && hoursSinceCreated >= AUTO_APPROVE_HOURS,
    voteCounts,
    pendingVoters,
    hoursRemaining,
  };
}

/**
 * Get display information for a proposal consensus status
 */
export function getProposalConsensusDisplayInfo(result: ProposalConsensusResult): {
  label: string;
  color: string;
  bgColor: string;
  icon: string;
  description: string;
} {
  switch (result.status) {
    case 'waiting':
      return {
        label: 'Awaiting Votes',
        color: 'text-slate-600',
        bgColor: 'bg-slate-100',
        icon: 'clock',
        description: `${Math.round(result.participation * 100)}% voted`,
      };
    case 'voting':
      return {
        label: 'Voting',
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
        icon: 'vote',
        description: result.hasStrongObjection
          ? 'Has objections'
          : 'Voting in progress',
      };
    case 'likely_approve':
      return {
        label: 'Likely Approved',
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-100',
        icon: 'trending-up',
        description: 'Trending positive',
      };
    case 'approved':
      return {
        label: 'Approved',
        color: 'text-green-600',
        bgColor: 'bg-green-100',
        icon: 'check',
        description: 'Group approved',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        color: 'text-red-600',
        bgColor: 'bg-red-100',
        icon: 'x',
        description: 'Group rejected',
      };
    case 'deadlock':
      return {
        label: 'Needs Decision',
        color: 'text-amber-600',
        bgColor: 'bg-amber-100',
        icon: 'alert',
        description: 'Owner needs to decide',
      };
    case 'expired':
      return {
        label: 'Expired',
        color: 'text-gray-500',
        bgColor: 'bg-gray-100',
        icon: 'clock',
        description: 'Voting period ended',
      };
  }
}

/**
 * Check if a user has already voted on a proposal
 */
export function getUserProposalVote(
  votes: ProposalVote[],
  userId: string
): ProposalVote | undefined {
  return votes.find(v => v.user_id === userId);
}

/**
 * Get vote type for a user on a proposal
 */
export function getUserProposalVoteType(
  votes: ProposalVote[],
  userId: string
): ProposalVoteType | null {
  const vote = getUserProposalVote(votes, userId);
  return vote?.vote_type ?? null;
}

/**
 * Calculate time remaining until auto-action
 */
export function getProposalTimeRemaining(
  createdAt: Date | string,
  targetHours: number
): {
  hours: number;
  minutes: number;
  isPast: boolean;
  formatted: string;
} {
  const createdDate = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const targetTime = createdDate.getTime() + targetHours * 60 * 60 * 1000;
  const remaining = targetTime - Date.now();

  const isPast = remaining <= 0;
  const absRemaining = Math.abs(remaining);
  const hours = Math.floor(absRemaining / (1000 * 60 * 60));
  const minutes = Math.floor((absRemaining % (1000 * 60 * 60)) / (1000 * 60));

  let formatted: string;
  if (isPast) {
    formatted = 'Time elapsed';
  } else if (hours >= 24) {
    const days = Math.floor(hours / 24);
    formatted = `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    formatted = `${hours}h ${minutes}m`;
  } else {
    formatted = `${minutes}m`;
  }

  return { hours, minutes, isPast, formatted };
}

/**
 * Aggregate votes by proposal for a batch of proposals
 */
export function aggregateVotesByProposal(
  votes: ProposalVote[]
): Map<string, ProposalVote[]> {
  const map = new Map<string, ProposalVote[]>();

  for (const vote of votes) {
    const existing = map.get(vote.proposal_id) || [];
    existing.push(vote);
    map.set(vote.proposal_id, existing);
  }

  return map;
}

/**
 * Group proposals by target slot (for tournament scenarios)
 * Proposals targeting the same day + time slot are grouped together
 */
export function groupProposalsBySlot<T extends { target_day: number; target_time_slot?: string | null }>(
  proposals: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();

  for (const proposal of proposals) {
    const slotKey = `${proposal.target_day}-${proposal.target_time_slot || 'any'}`;
    const existing = map.get(slotKey) || [];
    existing.push(proposal);
    map.set(slotKey, existing);
  }

  return map;
}

/**
 * Determine tournament winner among competing proposals
 * Returns the proposal with highest approval score, or null if no clear winner
 */
export function determineTournamentWinner<T extends { id: string }>(
  proposals: T[],
  consensusResults: Map<string, ProposalConsensusResult>
): {
  winner: T | null;
  status: 'voting' | 'winner' | 'tie' | 'no_quorum';
  scores: Array<{ proposal: T; score: number; status: ProposalConsensusResult['status'] }>;
} {
  if (proposals.length === 0) {
    return { winner: null, status: 'no_quorum', scores: [] };
  }

  if (proposals.length === 1) {
    const result = consensusResults.get(proposals[0].id);
    if (result?.status === 'approved') {
      return {
        winner: proposals[0],
        status: 'winner',
        scores: [{ proposal: proposals[0], score: result.score, status: result.status }],
      };
    }
    return {
      winner: null,
      status: 'voting',
      scores: [{ proposal: proposals[0], score: result?.score ?? 0, status: result?.status ?? 'waiting' }],
    };
  }

  // Multiple proposals - tournament mode
  const scores = proposals.map(p => {
    const result = consensusResults.get(p.id);
    return {
      proposal: p,
      score: result?.score ?? 0,
      status: result?.status ?? 'waiting' as const,
    };
  }).sort((a, b) => b.score - a.score);

  // Check if any proposal is clearly approved
  const approvedProposals = scores.filter(s => s.status === 'approved');
  if (approvedProposals.length === 1) {
    return { winner: approvedProposals[0].proposal, status: 'winner', scores };
  }

  // Check for tie at the top
  if (scores.length >= 2 && scores[0].score === scores[1].score && scores[0].score > 0) {
    return { winner: null, status: 'tie', scores };
  }

  // Check if voting is still in progress
  const stillVoting = scores.some(s =>
    s.status === 'waiting' || s.status === 'voting' || s.status === 'likely_approve'
  );
  if (stillVoting) {
    return { winner: null, status: 'voting', scores };
  }

  // All rejected or expired
  return { winner: null, status: 'no_quorum', scores };
}

/**
 * Calculate vote summary for display
 */
export function calculateVoteSummary(votes: ProposalVote[]): {
  approve: number;
  reject: number;
  total: number;
} {
  let approve = 0;
  let reject = 0;

  for (const vote of votes) {
    if (vote.vote_type === 'approve') {
      approve++;
    } else {
      reject++;
    }
  }

  return { approve, reject, total: votes.length };
}
