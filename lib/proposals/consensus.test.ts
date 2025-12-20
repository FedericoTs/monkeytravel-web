/**
 * Proposal Consensus Algorithm Tests
 *
 * Stress tests for all consensus scenarios to ensure correct behavior.
 * Run with: npx tsx lib/proposals/consensus.test.ts
 */

import {
  calculateProposalConsensus,
  groupProposalsBySlot,
  determineTournamentWinner,
  calculateVoteSummary,
  ProposalConsensusInput,
} from './consensus';
import type { ProposalConsensusResult } from '@/types';

// Test helper types
interface TestVote {
  id: string;
  proposal_id: string;
  user_id: string;
  vote_type: 'approve' | 'reject';
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
  voteType: 'approve' | 'reject',
  proposalId = 'test-proposal'
): TestVote {
  return {
    id: `vote-${userId}`,
    proposal_id: proposalId,
    user_id: userId,
    vote_type: voteType,
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
      votes: [createVote('user1', 'approve')],
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
    name: '3. Strong consensus (all approve) - instant approval',
    input: {
      votes: [
        createVote('user1', 'approve'),
        createVote('user2', 'approve'),
        createVote('user3', 'approve'),
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
    name: '4. Mixed but positive (3 approve, 1 reject) - likely_approve since score 1.0 >= 0.5',
    input: {
      votes: [
        createVote('user1', 'approve'),
        createVote('user2', 'approve'),
        createVote('user3', 'approve'),
        createVote('user4', 'reject'),
      ],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      // Score: (2 + 2 + 2 - 2) / 4 = 1.0 (>= 0.5 so likely_approve, but not >= 1.5 for instant)
      status: 'likely_approve',
      score: 1.0,
      hasStrongObjection: true,
    },
  },

  // === TIME-BASED AUTO-APPROVAL ===
  {
    name: '5. Majority positive after 48h - auto-approve',
    input: {
      votes: [
        createVote('user1', 'approve'),
        createVote('user2', 'approve'),
        createVote('user3', 'reject'),
      ],
      totalVoters: 4,
      createdAt: hoursAgo(50), // 50 hours ago
      expiresAt: daysFromNow(5),
    },
    expected: {
      // Score: (2 + 2 - 2) / 3 = 0.67 >= 0.5, and 50h >= 48h
      status: 'approved',
      canAutoApprove: true,
    },
  },
  {
    name: '6. Majority positive but < 48h - keep voting',
    input: {
      votes: [
        createVote('user1', 'approve'),
        createVote('user2', 'approve'),
        createVote('user3', 'reject'),
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
    name: '7. Clear rejection (all reject)',
    input: {
      votes: [
        createVote('user1', 'reject'),
        createVote('user2', 'reject'),
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
    name: '8. Majority reject (score <= -1)',
    input: {
      votes: [
        createVote('user1', 'approve'),
        createVote('user2', 'reject'),
        createVote('user3', 'reject'),
        createVote('user4', 'reject'),
      ],
      totalVoters: 4,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      // Score: (2 - 2 - 2 - 2) / 4 = -1.0
      status: 'rejected',
      score: -1.0,
    },
  },

  // === DEADLOCK TESTS ===
  {
    name: '9. Mixed votes after 72h - deadlock',
    input: {
      votes: [
        createVote('user1', 'approve'),
        createVote('user2', 'reject'),
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
    name: '10. Mixed votes but < 72h - keep voting',
    input: {
      votes: [
        createVote('user1', 'approve'),
        createVote('user2', 'reject'),
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
    name: '11. Proposal expired - should be expired status',
    input: {
      votes: [createVote('user1', 'approve')],
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
    name: '12. Single voter (owner only trip) - 100% participation',
    input: {
      votes: [createVote('owner', 'approve')],
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
    name: '13. Large group (8 voters) - consensus threshold',
    input: {
      votes: [
        createVote('user1', 'approve'),
        createVote('user2', 'approve'),
        createVote('user3', 'approve'),
        createVote('user4', 'approve'),
        createVote('user5', 'approve'),
        createVote('user6', 'reject'),
      ],
      totalVoters: 8,
      createdAt: hoursAgo(1),
      expiresAt: daysFromNow(7),
    },
    expected: {
      // Score: (2*5 - 2) / 6 = 1.33 (not >= 1.5, so not instant)
      status: 'likely_approve',
      participation: 0.75,
    },
  },
];

// Run tests
function runTests(): void {
  console.log('\n=== PROPOSAL CONSENSUS ALGORITHM TESTS ===\n');

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
  console.log('\n=== VOTE SUMMARY TESTS ===\n');

  const votes: TestVote[] = [
    createVote('user1', 'approve'),
    createVote('user2', 'approve'),
    createVote('user3', 'reject'),
  ];

  const summary = calculateVoteSummary(votes);

  console.log(
    summary.approve === 2 && summary.reject === 1 && summary.total === 3
      ? '✅ Vote summary correctly calculated'
      : '❌ Vote summary incorrect'
  );
}

// Run all tests
runTests();
