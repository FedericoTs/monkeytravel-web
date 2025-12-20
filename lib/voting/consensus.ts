/**
 * Consensus Calculation Algorithm
 *
 * Implements a weighted voting system for group decision-making on trip activities.
 *
 * Vote Weights:
 * - love: +2 (strong positive)
 * - flexible: +1 (weak positive)
 * - concerns: -1 (weak negative)
 * - no: -2 (strong negative, veto power)
 *
 * Decision Rules:
 * 1. Minimum 50% participation required
 * 2. Score >= 1.5 → Instant confirm (strong consensus)
 * 3. Score >= 0.5 && 48h passed → Auto-confirm (time-based majority)
 * 4. Score <= -1 → Reject
 * 5. Has "no" vote && 72h passed → Deadlock (escalate to owner)
 * 6. Otherwise → Continue voting
 */

import {
  ActivityVote,
  ConsensusResult,
  VoteType,
  VOTE_WEIGHTS,
  VOTING_TIMING,
} from '@/types';

export interface ConsensusInput {
  votes: ActivityVote[];
  totalVoters: number;
  proposedAt: Date | string;
  allVoterIds?: string[];
}

/**
 * Calculate consensus status for an activity based on votes
 */
export function calculateConsensus({
  votes,
  totalVoters,
  proposedAt,
  allVoterIds = [],
}: ConsensusInput): ConsensusResult {
  const {
    AUTO_CONFIRM_HOURS,
    DEADLOCK_HOURS,
    MIN_PARTICIPATION,
    STRONG_CONSENSUS_SCORE,
    REJECTION_THRESHOLD,
  } = VOTING_TIMING;

  // Initialize vote counts
  const voteCounts: ConsensusResult['voteCounts'] = {
    love: 0,
    flexible: 0,
    concerns: 0,
    no: 0,
  };

  // Default result for no votes
  if (votes.length === 0) {
    return {
      status: 'waiting',
      score: 0,
      participation: 0,
      hasStrongObjection: false,
      canAutoConfirm: false,
      voteCounts,
      pendingVoters: allVoterIds,
    };
  }

  // Calculate weighted score and count votes
  let totalWeight = 0;
  let hasStrongObjection = false;
  const votedUserIds = new Set<string>();

  for (const vote of votes) {
    const weight = VOTE_WEIGHTS[vote.vote_type] * (vote.vote_weight || 1);
    totalWeight += weight;
    voteCounts[vote.vote_type]++;
    votedUserIds.add(vote.user_id);

    if (vote.vote_type === 'no') {
      hasStrongObjection = true;
    }
  }

  // Calculate metrics
  const participation = totalVoters > 0 ? votes.length / totalVoters : 0;
  const avgScore = votes.length > 0 ? totalWeight / votes.length : 0;

  // Calculate time since proposed
  const proposedDate = typeof proposedAt === 'string' ? new Date(proposedAt) : proposedAt;
  const hoursSinceProposed = (Date.now() - proposedDate.getTime()) / (1000 * 60 * 60);

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
      canAutoConfirm: false,
      voteCounts,
      pendingVoters,
    };
  }

  // Rule 2: Strong consensus (instant confirm)
  if (avgScore >= STRONG_CONSENSUS_SCORE) {
    return {
      status: 'confirmed',
      score: avgScore,
      participation,
      hasStrongObjection,
      canAutoConfirm: true,
      voteCounts,
      pendingVoters,
    };
  }

  // Rule 3: Majority approval with time elapsed (auto-confirm)
  if (avgScore >= 0.5 && hoursSinceProposed >= AUTO_CONFIRM_HOURS) {
    return {
      status: 'confirmed',
      score: avgScore,
      participation,
      hasStrongObjection,
      canAutoConfirm: true,
      voteCounts,
      pendingVoters,
    };
  }

  // Rule 4: Clear rejection
  if (avgScore <= REJECTION_THRESHOLD) {
    return {
      status: 'rejected',
      score: avgScore,
      participation,
      hasStrongObjection,
      canAutoConfirm: false,
      voteCounts,
      pendingVoters,
    };
  }

  // Rule 5: Deadlock (strong objection + time elapsed)
  if (hasStrongObjection && hoursSinceProposed >= DEADLOCK_HOURS) {
    return {
      status: 'deadlock',
      score: avgScore,
      participation,
      hasStrongObjection,
      canAutoConfirm: false,
      voteCounts,
      pendingVoters,
    };
  }

  // Rule 6: Continue voting
  // Determine if trending towards yes or still uncertain
  const status = avgScore >= 0.5 ? 'likely_yes' : 'voting';

  return {
    status,
    score: avgScore,
    participation,
    hasStrongObjection,
    canAutoConfirm: avgScore >= 0.5 && hoursSinceProposed >= AUTO_CONFIRM_HOURS,
    voteCounts,
    pendingVoters,
  };
}

/**
 * Get display information for a consensus status
 */
export function getConsensusDisplayInfo(result: ConsensusResult): {
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
          ? 'Has concerns to address'
          : 'Voting in progress',
      };
    case 'likely_yes':
      return {
        label: 'Likely Approved',
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-100',
        icon: 'trending-up',
        description: 'Trending positive',
      };
    case 'confirmed':
      return {
        label: 'Confirmed',
        color: 'text-green-600',
        bgColor: 'bg-green-100',
        icon: 'check',
        description: 'Group approved',
      };
    case 'rejected':
      return {
        label: 'Not This Time',
        color: 'text-red-600',
        bgColor: 'bg-red-100',
        icon: 'x',
        description: 'Group decided against',
      };
    case 'deadlock':
      return {
        label: 'Needs Decision',
        color: 'text-amber-600',
        bgColor: 'bg-amber-100',
        icon: 'alert',
        description: 'Owner needs to decide',
      };
  }
}

/**
 * Check if a user has already voted on an activity
 */
export function getUserVote(
  votes: ActivityVote[],
  userId: string
): ActivityVote | undefined {
  return votes.find(v => v.user_id === userId);
}

/**
 * Get vote type for a user
 */
export function getUserVoteType(
  votes: ActivityVote[],
  userId: string
): VoteType | null {
  const vote = getUserVote(votes, userId);
  return vote?.vote_type ?? null;
}

/**
 * Calculate time remaining until auto-action
 */
export function getTimeRemaining(
  proposedAt: Date | string,
  targetHours: number
): {
  hours: number;
  minutes: number;
  isPast: boolean;
  formatted: string;
} {
  const proposedDate = typeof proposedAt === 'string' ? new Date(proposedAt) : proposedAt;
  const targetTime = proposedDate.getTime() + targetHours * 60 * 60 * 1000;
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
 * Aggregate votes by activity for a batch of activities
 */
export function aggregateVotesByActivity(
  votes: ActivityVote[]
): Map<string, ActivityVote[]> {
  const map = new Map<string, ActivityVote[]>();

  for (const vote of votes) {
    const existing = map.get(vote.activity_id) || [];
    existing.push(vote);
    map.set(vote.activity_id, existing);
  }

  return map;
}
