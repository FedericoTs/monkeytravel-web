/**
 * Proposal Consensus Algorithm Tests
 *
 * Stress tests for all consensus scenarios to ensure correct behavior.
 *
 * 4-Level Voting System:
 * - love: +2 (strong positive)
 * - flexible: +1 (weak positive)
 * - concerns: -1 (weak negative)
 * - no: -2 (strong negative)
 */

import { describe, expect, it } from "vitest";
import {
  calculateProposalConsensus,
  groupProposalsBySlot,
  determineTournamentWinner,
  calculateVoteSummary,
  ProposalConsensusInput,
} from './consensus';
import type { ProposalConsensusResult, VoteType } from '@/types';

// Test helper types
interface TestVote {
  id: string;
  proposal_id: string;
  user_id: string;
  vote_type: VoteType;
  comment?: string;
  voted_at: string;
  updated_at: string;
}

interface TestCase {
  name: string;
  input: ProposalConsensusInput;
  expected: Partial<ProposalConsensusResult>;
}

// Test data generators
function createVote(
  userId: string,
  voteType: VoteType,
  proposalId = 'test-proposal',
  comment?: string
): TestVote {
  return {
    id: `vote-${userId}`,
    proposal_id: proposalId,
    user_id: userId,
    vote_type: voteType,
    comment: comment || undefined,
    voted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// Test cases
const testCases: TestCase[] = [
  // === WAITING STATUS TESTS ===
  {
    name: '1. No votes - should be waiting',
    input: {
      votes: [],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
      allVoterIds: ['user1', 'user2', 'user3', 'user4'],
    },
    expected: {
      status: 'waiting',
      score: 0,
      participation: 0,
      hasStrongObjection: false,
      canAutoApprove: false,
    },
  },
  {
    name: '2. Less than 50% participation - should be waiting',
    input: {
      votes: [createVote('user1', 'love')],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
      allVoterIds: ['user1', 'user2', 'user3', 'user4'],
    },
    expected: {
      status: 'waiting',
      participation: 0.25,
      pendingVoters: ['user2', 'user3', 'user4'],
    },
  },

  // === STRONG CONSENSUS (INSTANT APPROVAL) ===
  {
    name: '3. Strong consensus (all love) - instant approval',
    input: {
      votes: [
        createVote('user1', 'love'),
        createVote('user2', 'love'),
        createVote('user3', 'love'),
      ],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
      allVoterIds: ['user1', 'user2', 'user3', 'user4'],
    },
    expected: {
      status: 'approved',
      score: 2, // All +2 votes = avg 2
      participation: 0.75,
      canAutoApprove: true,
    },
  },
  {
    name: '4. Mixed positive (2 love, 1 flexible, 1 no) - likely_approve since avg 0.75 >= 0.5',
    input: {
      votes: [
        createVote('user1', 'love'),     // +2
        createVote('user2', 'love'),     // +2
        createVote('user3', 'flexible'), // +1
        createVote('user4', 'no', 'test-proposal', 'Not interested'),        // -2
      ],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      // Score: (2 + 2 + 1 - 2) / 4 = 0.75 (>= 0.5 so likely_approve, but not >= 1.5 for instant)
      status: 'likely_approve',
      score: 0.75,
      hasStrongObjection: true,
    },
  },
  {
    name: '5. Strong positive (2 love, 2 flexible) - instant approval',
    input: {
      votes: [
        createVote('user1', 'love'),     // +2
        createVote('user2', 'love'),     // +2
        createVote('user3', 'flexible'), // +1
        createVote('user4', 'flexible'), // +1
      ],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      // Score: (2 + 2 + 1 + 1) / 4 = 1.5 (>= 1.5 so instant approval)
      status: 'approved',
      score: 1.5,
      hasStrongObjection: false,
      canAutoApprove: true,
    },
  },

  // === TIME-BASED AUTO-APPROVAL ===
  {
    name: '6. Majority positive after 48h - auto-approve',
    input: {
      votes: [
        createVote('user1', 'love'),     // +2
        createVote('user2', 'flexible'), // +1
        createVote('user3', 'concerns', 'test-proposal', 'Some concerns'), // -1
      ],
      totalVoters: 4,
      createdAt: hoursAgo(50), // 50 hours ago
      expiresAt: daysFromNow(5),
    },
    expected: {
      // Score: (2 + 1 - 1) / 3 = 0.67 >= 0.5, and 50h >= 48h
      status: 'approved',
      canAutoApprove: true,
    },
  },
  {
    name: '7. Majority positive but < 48h - keep voting',
    input: {
      votes: [
        createVote('user1', 'love'),     // +2
        createVote('user2', 'flexible'), // +1
        createVote('user3', 'concerns', 'test-proposal', 'Some concerns'), // -1
      ],
      totalVoters: 4,
      createdAt: hoursAgo(24), // Only 24 hours ago
      expiresAt: daysFromNow(6),
    },
    expected: {
      status: 'likely_approve', // Trending positive but not auto-approved yet
      canAutoApprove: false,
    },
  },

  // === REJECTION TESTS ===
  {
    name: '8. Clear rejection (all no)',
    input: {
      votes: [
        createVote('user1', 'no', 'test-proposal', 'Not for me'),
        createVote('user2', 'no', 'test-proposal', 'Skip this'),
      ],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      status: 'rejected',
      score: -2, // All -2 votes
      hasStrongObjection: true,
    },
  },
  {
    name: '9. Majority negative (score <= -1)',
    input: {
      votes: [
        createVote('user1', 'love'),      // +2
        createVote('user2', 'no', 'test-proposal', 'No 1'),         // -2
        createVote('user3', 'no', 'test-proposal', 'No 2'),         // -2
        createVote('user4', 'concerns', 'test-proposal', 'Concerns'), // -1
      ],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      // Score: (2 - 2 - 2 - 1) / 4 = -0.75 (not <= -1, so not rejected yet)
      status: 'voting',
      score: -0.75,
    },
  },
  {
    name: '10. Strong rejection (score <= -1)',
    input: {
      votes: [
        createVote('user1', 'flexible'),  // +1
        createVote('user2', 'no', 'test-proposal', 'No 1'),         // -2
        createVote('user3', 'no', 'test-proposal', 'No 2'),         // -2
        createVote('user4', 'no', 'test-proposal', 'No 3'),         // -2
      ],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      // Score: (1 - 2 - 2 - 2) / 4 = -1.25 (<= -1 so rejected)
      status: 'rejected',
      score: -1.25,
    },
  },

  // === DEADLOCK TESTS ===
  {
    name: '11. Mixed votes after 72h - deadlock',
    input: {
      votes: [
        createVote('user1', 'love'),    // +2
        createVote('user2', 'no', 'test-proposal', 'Skip'),       // -2
      ],
      totalVoters: 4,
      createdAt: hoursAgo(80), // 80 hours ago
      expiresAt: daysFromNow(4),
    },
    expected: {
      // Score: (2 - 2) / 2 = 0 (not enough for approval or rejection)
      status: 'deadlock',
      hasStrongObjection: true,
    },
  },
  {
    name: '12. Mixed votes but < 72h - keep voting',
    input: {
      votes: [
        createVote('user1', 'love'),    // +2
        createVote('user2', 'no', 'test-proposal', 'Skip'),       // -2
      ],
      totalVoters: 4,
      createdAt: hoursAgo(48), // 48 hours ago
      expiresAt: daysFromNow(5),
    },
    expected: {
      status: 'voting',
      score: 0,
    },
  },

  // === EXPIRY TESTS ===
  {
    name: '13. Proposal expired - should be expired status',
    input: {
      votes: [createVote('user1', 'love')],
      totalVoters: 4,
      createdAt: hoursAgo(200),
      expiresAt: hoursAgo(1), // Expired 1 hour ago
    },
    expected: {
      status: 'expired',
      hoursRemaining: 0,
    },
  },

  // === EDGE CASES ===
  {
    name: '14. Single voter (owner only trip) - 100% participation',
    input: {
      votes: [createVote('owner', 'love')],
      totalVoters: 1,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      status: 'approved', // Score 2 >= 1.5
      participation: 1.0,
    },
  },
  {
    name: '15. Large group (8 voters) - consensus threshold',
    input: {
      votes: [
        createVote('user1', 'love'),     // +2
        createVote('user2', 'love'),     // +2
        createVote('user3', 'flexible'), // +1
        createVote('user4', 'flexible'), // +1
        createVote('user5', 'flexible'), // +1
        createVote('user6', 'concerns', 'test-proposal', 'Some concerns'), // -1
      ],
      totalVoters: 8,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      // Score: (2 + 2 + 1 + 1 + 1 - 1) / 6 = 1.0 (not >= 1.5, so not instant)
      status: 'likely_approve',
      participation: 0.75,
    },
  },
  {
    name: '16. All flexible votes - approved (avg = 1.0 < 1.5, so likely_approve)',
    input: {
      votes: [
        createVote('user1', 'flexible'), // +1
        createVote('user2', 'flexible'), // +1
        createVote('user3', 'flexible'), // +1
      ],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      // Score: (1 + 1 + 1) / 3 = 1.0 (< 1.5, so likely_approve)
      status: 'likely_approve',
      score: 1.0,
      hasStrongObjection: false,
    },
  },
  {
    name: '17. Mix of concerns (no "no" votes) - no deadlock',
    input: {
      votes: [
        createVote('user1', 'love'),     // +2
        createVote('user2', 'concerns', 'test-proposal', 'Concern 1'), // -1
        createVote('user3', 'concerns', 'test-proposal', 'Concern 2'), // -1
      ],
      totalVoters: 4,
      createdAt: hoursAgo(80), // Even after 72h
      expiresAt: daysFromNow(4),
    },
    expected: {
      // Score: (2 - 1 - 1) / 3 = 0 - but no "no" votes, so no deadlock
      status: 'voting',
      score: 0,
      hasStrongObjection: false, // concerns don't trigger strong objection
    },
  },
];

// Run tests

describe("calculateProposalConsensus", () => {
  it.each(testCases)("$name", ({ input, expected }) => {
    const result = calculateProposalConsensus(input);
    for (const [key, value] of Object.entries(expected)) {
      const actual = result[key as keyof ProposalConsensusResult];
      if (typeof value === "number") {
        expect(Math.abs((actual as number) - value), key).toBeLessThanOrEqual(0.01);
      } else {
        expect(actual, key).toEqual(value);
      }
    }
  });
});

describe("determineTournamentWinner", () => {
  const slot = (id: string) => ({ id, target_day: 0, target_time_slot: "morning" });
  const results = (entries: Array<[string, Partial<ProposalConsensusResult>]>) =>
    new Map(entries.map(([id, r]) => [id, r as ProposalConsensusResult]));

  it("a single approved proposal wins", () => {
    const outcome = determineTournamentWinner([slot("p1")], results([["p1", { status: "approved", score: 2 }]]));
    expect(outcome.status).toBe("winner");
    expect(outcome.winner?.id).toBe("p1");
  });

  it("the higher-scored approved proposal wins", () => {
    const outcome = determineTournamentWinner(
      [slot("p1"), slot("p2")],
      results([["p1", { status: "approved", score: 2 }], ["p2", { status: "voting", score: 0.5 }]])
    );
    expect(outcome.status).toBe("winner");
    expect(outcome.winner?.id).toBe("p1");
  });

  it("equal scores are a tie", () => {
    const outcome = determineTournamentWinner(
      [slot("p1"), slot("p2")],
      results([["p1", { status: "likely_approve", score: 1.5 }], ["p2", { status: "likely_approve", score: 1.5 }]])
    );
    expect(outcome.status).toBe("tie");
  });

  it("pending votes mean it is still voting", () => {
    const outcome = determineTournamentWinner(
      [slot("p1"), slot("p2")],
      results([["p1", { status: "waiting", score: 0 }], ["p2", { status: "voting", score: 0.5 }]])
    );
    expect(outcome.status).toBe("voting");
  });
});

describe("groupProposalsBySlot", () => {
  it("groups proposals by day and time slot", () => {
    const grouped = groupProposalsBySlot([
      { id: "p1", target_day: 0, target_time_slot: "morning" },
      { id: "p2", target_day: 0, target_time_slot: "morning" },
      { id: "p3", target_day: 0, target_time_slot: "afternoon" },
      { id: "p4", target_day: 1, target_time_slot: "morning" },
    ]);
    expect(grouped.get("0-morning")?.length).toBe(2);
    expect(grouped.get("0-afternoon")?.length).toBe(1);
    expect(grouped.get("1-morning")?.length).toBe(1);
    expect(grouped.size).toBe(3);
  });
});

describe("calculateVoteSummary", () => {
  it("counts each of the four votes", () => {
    const summary = calculateVoteSummary([
      createVote("user1", "love"),
      createVote("user2", "flexible"),
      createVote("user3", "concerns", "test-proposal", "Some concern"),
      createVote("user4", "no", "test-proposal", "Skip this"),
    ]);
    expect(summary).toMatchObject({ love: 1, flexible: 1, concerns: 1, no: 1, total: 4 });
  });

  it("counts positive-only votes", () => {
    const summary = calculateVoteSummary([
      createVote("user1", "love"),
      createVote("user2", "love"),
      createVote("user3", "flexible"),
    ]);
    expect(summary).toMatchObject({ love: 2, flexible: 1, concerns: 0, no: 0 });
  });
});
