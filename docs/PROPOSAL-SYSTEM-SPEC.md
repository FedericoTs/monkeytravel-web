# Activity Proposal System - Technical Specification

## Overview

This document provides a detailed technical specification for implementing the activity proposal system, based on deep analysis of the existing codebase.

---

## Part 1: Dependency Analysis

### Existing Assets to Reuse

| Asset | Location | How to Reuse |
|-------|----------|--------------|
| `ROLE_PERMISSIONS.canSuggest` | `types/index.ts:379-391` | Already exists! Voters have `canSuggest: true` |
| `calculateConsensus()` | `lib/voting/consensus.ts` | Reuse for proposal consensus (same algorithm) |
| `Activity` interface | `types/index.ts:55-85` | Proposals store full Activity object |
| `useActivityVotes` pattern | `lib/hooks/useActivityVotes.ts` | Clone pattern for `useProposals` |
| Real-time subscription | `useActivityVotes.ts:201-262` | Same channel pattern for proposals |
| Activity Bank | `lib/activity-bank/index.ts` | Search bank before creating proposal |
| `activity_status` table | Database | Extended status for proposals |
| Vote UI components | `components/collaboration/Vote*.tsx` | Reuse/extend for proposal voting |

### Existing Types to Extend

```typescript
// ALREADY EXISTS in types/index.ts:437-444
export type ActivityVotingStatus =
  | 'proposed'   // ← USE THIS for new proposals
  | 'voting'     // ← USE THIS when voting starts
  | 'confirmed'  // ← USE THIS when approved
  | 'rejected'   // ← USE THIS when rejected
  | 'deadlock'   // ← USE THIS when no consensus
  | 'completed'
  | 'skipped';
```

---

## Part 2: Design Decisions

### Decision 1: Proposals vs Activity Status

**Question**: Should proposals be a separate table or extend `activity_status`?

**Decision**: **Separate `activity_proposals` table**

**Reasoning**:
- `activity_status` tracks status of activities that ARE in the itinerary
- Proposals are activities that are NOT YET in the itinerary
- Proposals need additional data (proposed_activity JSONB, type, target_slot)
- Separation allows cleaner queries and simpler RLS

### Decision 2: Proposal Voting vs Activity Voting

**Question**: Should proposal votes use `activity_votes` or a new table?

**Decision**: **New `proposal_votes` table**

**Reasoning**:
- Activity votes are tied to `activity_id` (in itinerary)
- Proposal votes are tied to `proposal_id` (not in itinerary)
- Different lifecycle: proposal votes are deleted when resolved
- Different semantics: proposal votes are approve/reject, not love/flexible/concerns/no

### Decision 3: Time Slot Conflicts

**Question**: How to handle multiple proposals for the same time slot?

**Decision**: **Implicit grouping via query, not explicit `slot_group_id`**

**Reasoning**:
- Group proposals by `(trip_id, target_day, target_time_slot)`
- When >1 active proposal exists for same slot → show tournament UI
- Simpler schema, no extra table needed
- Tournament resolution done at query time

### Decision 4: Proposal Types

**Question**: What types of proposals to support?

**Decision**: Start with **2 types**, expand later:

| Type | Description | MVP? |
|------|-------------|------|
| `new` | Add new activity to empty slot | YES |
| `replacement` | Replace existing activity | YES |
| `modification` | Change time/duration | NO (Phase 2) |
| `removal` | Remove activity | NO (Phase 2) |

### Decision 5: Consensus for Proposals

**Question**: Reuse existing consensus algorithm?

**Decision**: **YES, reuse `calculateConsensus()`**

**Reasoning**:
- Same voting mechanics work for proposals
- Proposal vote = "approve" → treat as `love` (+2)
- Proposal vote = "reject" → treat as `no` (-2)
- Same thresholds, timeouts, deadlock handling

---

## Part 3: Database Schema

### Table: `activity_proposals`

```sql
CREATE TABLE activity_proposals (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  proposed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Proposal type
  type TEXT NOT NULL DEFAULT 'new'
    CHECK (type IN ('new', 'replacement', 'modification', 'removal')),

  -- The proposed activity (full Activity object)
  activity_data JSONB NOT NULL,

  -- For replacement: which activity to replace
  target_activity_id TEXT,

  -- Slot targeting (where to place the activity)
  target_day INTEGER NOT NULL,
  target_time_slot TEXT CHECK (target_time_slot IN ('morning', 'afternoon', 'evening')),

  -- Optional note from proposer
  note TEXT,

  -- Lifecycle status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'voting', 'approved', 'rejected', 'withdrawn', 'expired')),

  -- Resolution details
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  resolution_method TEXT
    CHECK (resolution_method IN ('consensus', 'owner_override', 'auto_approve', 'timeout', 'withdrawn')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),

  -- Unique constraint: one active proposal per user per slot
  CONSTRAINT unique_active_proposal_per_user_slot
    UNIQUE (trip_id, target_day, target_time_slot, proposed_by, status)
    DEFERRABLE INITIALLY DEFERRED
);

-- Indexes
CREATE INDEX idx_proposals_trip_status ON activity_proposals(trip_id, status)
  WHERE status IN ('pending', 'voting');
CREATE INDEX idx_proposals_trip_day ON activity_proposals(trip_id, target_day);
CREATE INDEX idx_proposals_proposed_by ON activity_proposals(proposed_by);
CREATE INDEX idx_proposals_expires ON activity_proposals(expires_at)
  WHERE status IN ('pending', 'voting');
```

### Table: `proposal_votes`

```sql
CREATE TABLE proposal_votes (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  proposal_id UUID NOT NULL REFERENCES activity_proposals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Vote type (simpler than activity votes)
  vote_type TEXT NOT NULL DEFAULT 'approve'
    CHECK (vote_type IN ('approve', 'reject')),

  -- Optional comment (required for reject?)
  comment TEXT,

  -- For tournament ranking (future use)
  rank INTEGER,

  -- Timestamps
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One vote per user per proposal
  UNIQUE (proposal_id, user_id)
);

-- Indexes
CREATE INDEX idx_proposal_votes_proposal ON proposal_votes(proposal_id);
CREATE INDEX idx_proposal_votes_user ON proposal_votes(user_id);
```

### RLS Policies

```sql
-- Enable RLS
ALTER TABLE activity_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_votes ENABLE ROW LEVEL SECURITY;

-- Proposals: Trip members can view
CREATE POLICY "Trip members can view proposals" ON activity_proposals
  FOR SELECT
  USING (public.user_can_access_trip(trip_id, auth.uid()));

-- Proposals: Users with canSuggest can create
CREATE POLICY "Suggesters can create proposals" ON activity_proposals
  FOR INSERT
  WITH CHECK (
    proposed_by = auth.uid()
    AND public.user_can_suggest(trip_id, auth.uid())
  );

-- Proposals: Proposers can update own (withdraw only)
CREATE POLICY "Proposers can withdraw own" ON activity_proposals
  FOR UPDATE
  USING (proposed_by = auth.uid() AND status IN ('pending', 'voting'))
  WITH CHECK (status = 'withdrawn');

-- Proposals: Owner can update any (approve/reject)
CREATE POLICY "Owner can resolve proposals" ON activity_proposals
  FOR UPDATE
  USING (public.user_is_trip_owner(trip_id, auth.uid()));

-- Votes: Trip members can view
CREATE POLICY "Trip members can view proposal votes" ON proposal_votes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM activity_proposals p
      WHERE p.id = proposal_id
      AND public.user_can_access_trip(p.trip_id, auth.uid())
    )
  );

-- Votes: Voters can cast
CREATE POLICY "Voters can vote on proposals" ON proposal_votes
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM activity_proposals p
      WHERE p.id = proposal_id
      AND public.user_can_vote(p.trip_id, auth.uid())
    )
  );

-- Votes: Users can update own
CREATE POLICY "Users can update own votes" ON proposal_votes
  FOR UPDATE
  USING (user_id = auth.uid());

-- Votes: Users can delete own
CREATE POLICY "Users can delete own votes" ON proposal_votes
  FOR DELETE
  USING (user_id = auth.uid());
```

### Helper Functions

```sql
-- Check if user can suggest (reuse existing or create)
CREATE OR REPLACE FUNCTION public.user_can_suggest(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    -- Owner can always suggest
    EXISTS (SELECT 1 FROM trips WHERE id = p_trip_id AND user_id = p_user_id)
    OR
    -- Collaborator with suggest permission (editor or voter)
    EXISTS (
      SELECT 1 FROM trip_collaborators
      WHERE trip_id = p_trip_id
      AND user_id = p_user_id
      AND role IN ('editor', 'voter')
    );
$$;

-- Check if user is trip owner
CREATE OR REPLACE FUNCTION public.user_is_trip_owner(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM trips WHERE id = p_trip_id AND user_id = p_user_id);
$$;
```

---

## Part 4: TypeScript Types

Add to `types/index.ts`:

```typescript
// =====================================================
// Activity Proposal Types
// =====================================================

export type ProposalType = 'new' | 'replacement' | 'modification' | 'removal';

export type ProposalStatus =
  | 'pending'     // Just created, not enough votes yet
  | 'voting'      // Active voting in progress
  | 'approved'    // Approved by consensus
  | 'rejected'    // Rejected by consensus or owner
  | 'withdrawn'   // Withdrawn by proposer
  | 'expired';    // Expired without resolution

export type ProposalVoteType = 'approve' | 'reject';

export interface ActivityProposal {
  id: string;
  trip_id: string;
  proposed_by: string;
  type: ProposalType;
  activity_data: Activity;
  target_activity_id?: string;
  target_day: number;
  target_time_slot?: 'morning' | 'afternoon' | 'evening';
  note?: string;
  status: ProposalStatus;
  resolved_at?: string;
  resolved_by?: string;
  resolution_method?: 'consensus' | 'owner_override' | 'auto_approve' | 'timeout' | 'withdrawn';
  created_at: string;
  updated_at: string;
  expires_at: string;
  // Joined data
  proposer?: {
    display_name: string;
    avatar_url?: string;
  };
}

export interface ProposalVote {
  id: string;
  proposal_id: string;
  user_id: string;
  vote_type: ProposalVoteType;
  comment?: string;
  rank?: number;
  voted_at: string;
  updated_at: string;
  // Joined data
  user?: {
    display_name: string;
    avatar_url?: string;
  };
}

export interface ProposalWithVotes extends ActivityProposal {
  votes: ProposalVote[];
  vote_summary: {
    approve: number;
    reject: number;
    total: number;
  };
  consensus?: ConsensusResult;
}

// Proposal vote weights (for consensus calculation)
export const PROPOSAL_VOTE_WEIGHTS: Record<ProposalVoteType, number> = {
  approve: 2,   // Same as "love"
  reject: -2,   // Same as "no"
};

// Slot grouping for tournaments
export interface ProposalSlotGroup {
  trip_id: string;
  target_day: number;
  target_time_slot: string | null;
  proposals: ProposalWithVotes[];
  is_tournament: boolean;  // true if >1 proposal
}
```

---

## Part 5: API Endpoints

### GET /api/trips/[id]/proposals

Batch fetch all proposals for a trip.

```typescript
// Response
interface ProposalsResponse {
  success: boolean;
  proposals: Record<string, ProposalWithVotes[]>;  // Grouped by slot key
  currentUserProposals: string[];  // Proposal IDs created by current user
  currentUserVotes: Record<string, ProposalVoteType>;  // proposalId → vote
  voterCount: number;
  pendingCount: number;
  tournamentSlots: string[];  // Slots with >1 proposal
}
```

### POST /api/trips/[id]/proposals

Create a new proposal.

```typescript
// Request
interface CreateProposalRequest {
  type: 'new' | 'replacement';
  activity: Activity;
  target_day: number;
  target_time_slot?: 'morning' | 'afternoon' | 'evening';
  target_activity_id?: string;  // For replacement
  note?: string;
}

// Response
interface CreateProposalResponse {
  success: boolean;
  proposal: ActivityProposal;
}
```

### GET /api/trips/[id]/proposals/[proposalId]

Get single proposal with votes.

### POST /api/trips/[id]/proposals/[proposalId]/vote

Vote on a proposal.

```typescript
// Request
interface ProposalVoteRequest {
  vote_type: 'approve' | 'reject';
  comment?: string;
}
```

### DELETE /api/trips/[id]/proposals/[proposalId]/vote

Remove vote from proposal.

### PATCH /api/trips/[id]/proposals/[proposalId]

Update proposal (withdraw by proposer, resolve by owner).

```typescript
// Request (withdraw)
interface WithdrawProposalRequest {
  action: 'withdraw';
}

// Request (resolve by owner)
interface ResolveProposalRequest {
  action: 'approve' | 'reject';
}
```

### POST /api/trips/[id]/proposals/[proposalId]/apply

Apply an approved proposal to the itinerary.

```typescript
// This actually modifies trips.itinerary
// Only callable by owner/editor
// Returns updated itinerary
```

---

## Part 6: Hooks & State Management

### useProposals Hook

```typescript
// lib/hooks/useProposals.ts

interface UseProposalsOptions {
  tripId: string;
  enabled?: boolean;
  onProposalChange?: (proposal: ActivityProposal) => void;
}

interface UseProposalsReturn {
  // Data
  proposals: Record<string, ProposalWithVotes[]>;  // Grouped by slot key
  proposalList: ProposalWithVotes[];  // Flat list
  currentUserVotes: Record<string, ProposalVoteType>;
  voterCount: number;

  // Computed
  pendingCount: number;
  tournamentSlots: string[];

  // State
  isLoading: boolean;
  error: string | null;

  // Actions
  createProposal: (data: CreateProposalRequest) => Promise<ActivityProposal>;
  voteOnProposal: (proposalId: string, voteType: ProposalVoteType, comment?: string) => Promise<void>;
  removeVote: (proposalId: string) => Promise<void>;
  withdrawProposal: (proposalId: string) => Promise<void>;
  refreshProposals: () => Promise<void>;

  // Helpers
  getProposalsForSlot: (day: number, timeSlot?: string) => ProposalWithVotes[];
  getProposalById: (proposalId: string) => ProposalWithVotes | null;
  getCurrentUserVote: (proposalId: string) => ProposalVoteType | null;
  isUserProposal: (proposalId: string) => boolean;
  hasConflict: (day: number, timeSlot?: string) => boolean;
}
```

### Real-time Subscription

```typescript
// In useProposals hook
const channel = supabase
  .channel(`trip-proposals:${tripId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'activity_proposals',
    filter: `trip_id=eq.${tripId}`,
  }, handleProposalChange)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'proposal_votes',
    // Can't filter by trip_id directly, need to handle in callback
  }, handleVoteChange)
  .subscribe();
```

---

## Part 7: Component Integration

### EditableActivityCard Integration

Add new props:

```typescript
interface EditableActivityCardProps {
  // Existing props...

  // NEW: Proposal-related props
  proposals?: ProposalWithVotes[];  // Proposals targeting this slot
  hasReplacement?: boolean;         // Has replacement proposal for this activity
  canPropose?: boolean;             // User can create proposals
  onProposeReplacement?: () => void;
  onViewProposals?: () => void;
}
```

Integration points:
1. Show "2 alternatives proposed" badge when `proposals.length > 0`
2. Add "Propose Alternative" menu item when `canPropose && !isEditing`
3. Show proposal indicator when activity has replacement proposals

### New Components

```
components/
└── collaboration/
    └── proposals/
        ├── ProposeButton.tsx           # "+" button for empty slots
        ├── ProposalBadge.tsx           # Status badge (Proposed/Voting/etc)
        ├── ProposalCard.tsx            # Single proposal display
        ├── ProposalVoteButtons.tsx     # Approve/Reject buttons
        ├── ProposeActivitySheet.tsx    # Bottom sheet for creating
        ├── TournamentSheet.tsx         # Compare multiple proposals
        ├── ProposalQueue.tsx           # Owner's pending list
        └── EmptySlotCard.tsx           # Placeholder for empty time slots
```

### TripDetailClient Integration

```typescript
// In TripDetailClient.tsx

// Add useProposals hook alongside useActivityVotes
const {
  proposals,
  pendingCount,
  tournamentSlots,
  createProposal,
  voteOnProposal,
  getProposalsForSlot,
  hasConflict,
} = useProposals({
  tripId,
  enabled: isCollaborativeTrip,
});

// Pass to day sections
<DaySection
  // Existing props...
  proposals={getProposalsForSlot(dayIndex)}
  hasConflict={hasConflict(dayIndex)}
  onProposeActivity={(timeSlot) => openProposeSheet(dayIndex, timeSlot)}
/>
```

---

## Part 8: Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER ACTIONS                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Tap "+" on empty slot                                                   │
│  2. Select activity from bank/search                                        │
│  3. Confirm proposal                                                        │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ProposeActivitySheet                                     │
│  - Search Activity Bank first (cost savings)                                │
│  - Fallback to Places API search                                            │
│  - User adds note                                                           │
│  - Calls createProposal()                                                   │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     useProposals Hook                                        │
│  - Optimistic update                                                        │
│  - POST /api/trips/[id]/proposals                                           │
│  - Refresh on success/revert on failure                                     │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     API Route                                                │
│  - Verify user can suggest                                                  │
│  - Insert into activity_proposals                                           │
│  - Return proposal with ID                                                  │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Supabase Realtime                                        │
│  - Broadcast INSERT to all subscribers                                      │
│  - Other users' hooks receive event                                         │
│  - All clients refresh proposals                                            │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     UI Update                                                │
│  - EditableActivityCard shows badge                                         │
│  - EmptySlotCard becomes ProposalCard                                       │
│  - TournamentSheet if multiple proposals                                    │
│  - Other users can vote                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 9: Implementation Order

### Phase 1: Foundation (Day 1-2)

1. **Database Migration**
   - Create `activity_proposals` table
   - Create `proposal_votes` table
   - Add helper functions
   - Add RLS policies

2. **TypeScript Types**
   - Add proposal types to `types/index.ts`

3. **API Endpoints**
   - `GET /api/trips/[id]/proposals`
   - `POST /api/trips/[id]/proposals`

### Phase 2: Core Logic (Day 3-4)

4. **Proposal Consensus**
   - Create `lib/proposals/consensus.ts`
   - Adapt existing consensus algorithm

5. **useProposals Hook**
   - Clone structure from useActivityVotes
   - Add real-time subscription
   - Implement all actions

6. **Remaining API Endpoints**
   - Vote endpoint
   - Withdraw/resolve endpoint

### Phase 3: UI Components (Day 5-7)

7. **Basic Components**
   - `EmptySlotCard.tsx`
   - `ProposeButton.tsx`
   - `ProposalBadge.tsx`
   - `ProposalCard.tsx`
   - `ProposalVoteButtons.tsx`

8. **Propose Sheet**
   - `ProposeActivitySheet.tsx`
   - Activity Bank integration
   - Places API fallback

9. **Tournament View**
   - `TournamentSheet.tsx`

### Phase 4: Integration (Day 8-9)

10. **EditableActivityCard Integration**
    - Add proposal-related props
    - Show badges and indicators
    - Add menu items

11. **TripDetailClient Integration**
    - Initialize useProposals
    - Pass data to components

12. **DaySection Updates**
    - Render EmptySlotCard
    - Show conflict indicators

### Phase 5: Owner Tools (Day 10)

13. **Proposal Queue**
    - `ProposalQueue.tsx`
    - Batch actions

14. **Force Resolution**
    - Owner approve/reject UI
    - Apply to itinerary

---

## Part 10: Testing Checklist

### Unit Tests

- [ ] Consensus calculation with proposal votes
- [ ] Slot grouping logic
- [ ] Permission checks (canSuggest)

### Integration Tests

- [ ] Create proposal as voter
- [ ] Create proposal as editor
- [ ] Fail to create as viewer
- [ ] Vote on proposal
- [ ] Withdraw own proposal
- [ ] Owner resolve proposal
- [ ] Real-time updates across clients

### E2E Tests

- [ ] Complete flow: propose → vote → approve → apply
- [ ] Tournament: 3 proposals → voting → winner
- [ ] Replacement: propose alternative → vote → replace

---

## Part 11: Risk Mitigation

### Risk 1: Performance

**Concern**: Too many proposals could slow down page load.

**Mitigation**:
- Batch fetch with limits (max 50 active proposals)
- Index on `(trip_id, status)`
- Only fetch active proposals by default

### Risk 2: Conflicts with Existing Voting

**Concern**: Proposal voting might interfere with activity voting.

**Mitigation**:
- Completely separate tables
- Separate hooks
- Clear UI distinction (proposal = blue, activity = green)

### Risk 3: Orphaned Proposals

**Concern**: Proposals for activities that get deleted.

**Mitigation**:
- Check `target_activity_id` validity before applying
- Auto-reject proposals for deleted activities
- Show "Activity no longer exists" message

### Risk 4: Tournament Edge Cases

**Concern**: Ties, all-reject, proposer withdraws.

**Mitigation**:
- Tie-breaker: first proposed wins
- All-reject: mark slot as "no activity confirmed"
- Withdrawal: remove from tournament, recalculate

---

## Appendix: File Changes Summary

### New Files

| File | Type | Description |
|------|------|-------------|
| `supabase/migrations/20251221_create_proposals.sql` | Migration | Database schema |
| `lib/proposals/consensus.ts` | Logic | Proposal consensus calculation |
| `lib/hooks/useProposals.ts` | Hook | Proposal state management |
| `app/api/trips/[id]/proposals/route.ts` | API | List/create proposals |
| `app/api/trips/[id]/proposals/[proposalId]/route.ts` | API | Single proposal operations |
| `app/api/trips/[id]/proposals/[proposalId]/vote/route.ts` | API | Vote operations |
| `components/collaboration/proposals/*.tsx` | UI | 8 new components |

### Modified Files

| File | Changes |
|------|---------|
| `types/index.ts` | Add proposal types (~80 lines) |
| `components/trip/EditableActivityCard.tsx` | Add proposal props (~30 lines) |
| `app/trips/[id]/TripDetailClient.tsx` | Initialize hook, pass props (~50 lines) |
| `components/trip/DaySection.tsx` | Render empty slots (~20 lines) |

### Total Estimated Changes

- **New code**: ~1,500 lines
- **Modified code**: ~100 lines
- **New files**: 12
- **Modified files**: 4
