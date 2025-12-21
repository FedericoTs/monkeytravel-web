/**
 * Proposal Consensus Algorithm Tests
 *
 * Stress tests for all consensus scenarios to ensure correct behavior.
 * Run with: npx tsx lib/proposals/consensus.test.ts
 *
 * 4-Level Voting System:
 * - love: +2 (strong positive)
 * - flexible: +1 (weak positive)
 * - concerns: -1 (weak negative)
 * - no: -2 (strong negative)
 */

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
function runTests(): void {
  console.log('\n=== PROPOSAL CONSENSUS ALGORITHM TESTS (4-LEVEL VOTING) ===\n');

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    const result = calculateProposalConsensus(test.input);
    const errors: string[] = [];

    // Check each expected property
    for (const [key, expectedValue] of Object.entries(test.expected)) {
      const actualValue = result[key as keyof ProposalConsensusResult];

      if (Array.isArray(expectedValue)) {
        // Compare arrays
        const actualArray = actualValue as string[];
        if (
          expectedValue.length !== actualArray.length ||
          !expectedValue.every((v, i) => v === actualArray[i])
        ) {
          errors.push(`  ${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualArray)}`);
        }
      } else if (typeof expectedValue === 'number') {
        // Compare numbers with tolerance
        if (Math.abs((actualValue as number) - expectedValue) > 0.01) {
          errors.push(`  ${key}: expected ${expectedValue}, got ${actualValue}`);
        }
      } else {
        // Direct comparison
        if (actualValue !== expectedValue) {
          errors.push(`  ${key}: expected ${expectedValue}, got ${actualValue}`);
        }
      }
    }

    if (errors.length === 0) {
      console.log(`✅ ${test.name}`);
      passed++;
    } else {
      console.log(`❌ ${test.name}`);
      errors.forEach(e => console.log(e));
      failed++;
    }
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);

  // Additional stress tests
  runTournamentTests();
  runSlotGroupingTests();
  runVoteSummaryTests();
}

function runTournamentTests(): void {
  console.log('\n=== TOURNAMENT TESTS ===\n');

  // Test 1: Single proposal approved
  const singleApproved = determineTournamentWinner(
    [{ id: 'p1', target_day: 0, target_time_slot: 'morning' }],
    new Map([['p1', { status: 'approved', score: 2 } as ProposalConsensusResult]])
  );
  console.log(
    singleApproved.status === 'winner' && singleApproved.winner?.id === 'p1'
      ? '✅ Single approved proposal wins'
      : '❌ Single approved proposal should win'
  );

  // Test 2: Multiple proposals, one clearly wins
  const clearWinner = determineTournamentWinner(
    [
      { id: 'p1', target_day: 0, target_time_slot: 'morning' },
      { id: 'p2', target_day: 0, target_time_slot: 'morning' },
    ],
    new Map([
      ['p1', { status: 'approved', score: 2 } as ProposalConsensusResult],
      ['p2', { status: 'voting', score: 0.5 } as ProposalConsensusResult],
    ])
  );
  console.log(
    clearWinner.status === 'winner' && clearWinner.winner?.id === 'p1'
      ? '✅ Higher scored approved proposal wins'
      : '❌ Higher scored approved proposal should win'
  );

  // Test 3: Tie
  const tie = determineTournamentWinner(
    [
      { id: 'p1', target_day: 0, target_time_slot: 'morning' },
      { id: 'p2', target_day: 0, target_time_slot: 'morning' },
    ],
    new Map([
      ['p1', { status: 'likely_approve', score: 1.5 } as ProposalConsensusResult],
      ['p2', { status: 'likely_approve', score: 1.5 } as ProposalConsensusResult],
    ])
  );
  console.log(
    tie.status === 'tie'
      ? '✅ Equal scores result in tie'
      : '❌ Equal scores should result in tie'
  );

  // Test 4: Still voting
  const stillVoting = determineTournamentWinner(
    [
      { id: 'p1', target_day: 0, target_time_slot: 'morning' },
      { id: 'p2', target_day: 0, target_time_slot: 'morning' },
    ],
    new Map([
      ['p1', { status: 'waiting', score: 0 } as ProposalConsensusResult],
      ['p2', { status: 'voting', score: 0.5 } as ProposalConsensusResult],
    ])
  );
  console.log(
    stillVoting.status === 'voting'
      ? '✅ Pending votes means still voting'
      : '❌ Pending votes should mean still voting'
  );
}

function runSlotGroupingTests(): void {
  console.log('\n=== SLOT GROUPING TESTS ===\n');

  const proposals = [
    { id: 'p1', target_day: 0, target_time_slot: 'morning' },
    { id: 'p2', target_day: 0, target_time_slot: 'morning' },
    { id: 'p3', target_day: 0, target_time_slot: 'afternoon' },
    { id: 'p4', target_day: 1, target_time_slot: 'morning' },
  ];

  const grouped = groupProposalsBySlot(proposals);

  console.log(
    grouped.get('0-morning')?.length === 2
      ? '✅ Morning slot groups 2 proposals'
      : '❌ Morning slot should have 2 proposals'
  );

  console.log(
    grouped.get('0-afternoon')?.length === 1
      ? '✅ Afternoon slot groups 1 proposal'
      : '❌ Afternoon slot should have 1 proposal'
  );

  console.log(
    grouped.get('1-morning')?.length === 1
      ? '✅ Day 1 morning groups 1 proposal'
      : '❌ Day 1 morning should have 1 proposal'
  );

  console.log(
    grouped.size === 3
      ? '✅ Total 3 slot groups'
      : '❌ Should have 3 slot groups'
  );
}

function runVoteSummaryTests(): void {
  console.log('\n=== VOTE SUMMARY TESTS (4-LEVEL) ===\n');

  const votes: TestVote[] = [
    createVote('user1', 'love'),
    createVote('user2', 'flexible'),
    createVote('user3', 'concerns', 'test-proposal', 'Some concern'),
    createVote('user4', 'no', 'test-proposal', 'Skip this'),
  ];

  const summary = calculateVoteSummary(votes);

  console.log(
    summary.love === 1 && summary.flexible === 1 && summary.concerns === 1 && summary.no === 1 && summary.total === 4
      ? '✅ Vote summary correctly calculated (4-level)'
      : `❌ Vote summary incorrect: love=${summary.love}, flexible=${summary.flexible}, concerns=${summary.concerns}, no=${summary.no}, total=${summary.total}`
  );

  // Test with only positive votes
  const positiveVotes: TestVote[] = [
    createVote('user1', 'love'),
    createVote('user2', 'love'),
    createVote('user3', 'flexible'),
  ];

  const positiveSummary = calculateVoteSummary(positiveVotes);

  console.log(
    positiveSummary.love === 2 && positiveSummary.flexible === 1 && positiveSummary.concerns === 0 && positiveSummary.no === 0
      ? '✅ Positive-only vote summary correct'
      : '❌ Positive-only vote summary incorrect'
  );
}

// Run all tests
runTests();
