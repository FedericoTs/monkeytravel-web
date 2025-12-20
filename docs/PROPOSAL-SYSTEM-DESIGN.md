# Collaborative Proposal System Design

## Executive Summary

Transform the voting system into a full **proposal + voting** system where collaborators can:
1. **Propose new activities** for empty or filled time slots
2. **Propose replacements** for existing activities
3. **Propose modifications** (time, duration, details) to activities
4. **Vote on competing proposals** when multiple exist

**Design Philosophy**: Make proposing feel lightweight (one tap to start), voting feel satisfying (instant feedback), and resolution feel fair (tournament system for conflicts).

---

## Part 1: User Scenarios & State Machines

### Scenario 1: Proposing a New Activity (Empty Slot)

**User Story**: "As a voter, I want to suggest a restaurant for our free evening so my travel companions can consider it."

**Flow**:
```
[View Day] → [Tap "+" on empty slot] → [Search/Select Activity] → [Confirm Proposal]
     ↓
[Activity appears as "Proposed" with yellow badge]
     ↓
[Other collaborators vote] → [Consensus reached] → [Status: Confirmed/Rejected]
```

**State Machine**:
```
                    ┌─────────────┐
                    │   EMPTY     │
                    └──────┬──────┘
                           │ propose
                           ▼
                    ┌─────────────┐
         vote ┌────►│  PROPOSED   │◄────┐ vote
              │     └──────┬──────┘     │
              │            │            │
              │    consensus reached    │
              │            │            │
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │CONFIRMED│  │REJECTED │  │DEADLOCK │
        └─────────┘  └─────────┘  └─────────┘
                                       │
                                       │ owner force-decide
                                       ▼
                                 ┌─────────────┐
                                 │CONFIRMED/   │
                                 │REJECTED     │
                                 └─────────────┘
```

### Scenario 2: Proposing a Replacement

**User Story**: "As a voter, I don't like the museum choice. I want to propose an alternative."

**Flow**:
```
[View Activity Card] → [Tap "Propose Alternative"] → [Search/Select Replacement]
     ↓
[Comparison View: Current vs Proposed]
     ↓
[Collaborators vote: Keep Current | Switch to New]
     ↓
[Winner becomes Confirmed, loser is archived]
```

**State Machine**:
```
                    ┌─────────────┐
                    │  CONFIRMED  │ (existing activity)
                    └──────┬──────┘
                           │ replacement proposed
                           ▼
                    ┌─────────────┐
                    │  CONTESTED  │ ← Shows both options
                    └──────┬──────┘
                           │ voting complete
                    ┌──────┴──────┐
                    ▼             ▼
             ┌─────────┐   ┌─────────┐
             │ORIGINAL │   │REPLACED │
             │ KEPT    │   │ BY NEW  │
             └─────────┘   └─────────┘
```

### Scenario 3: Multiple Proposals (Tournament)

**User Story**: "Three people proposed different restaurants for dinner. How do we decide?"

**Flow**:
```
[Day View] → [Time Slot shows "3 proposals"]
     ↓
[Tap to expand] → [See all 3 options side-by-side]
     ↓
[Each person ranks: 1st, 2nd, 3rd choice] OR [Simple vote for favorite]
     ↓
[System calculates winner using ranked-choice or plurality]
     ↓
[Winner confirmed, others archived with "Thanks for suggesting!"]
```

**Resolution Algorithm** (Ranked Choice Voting):
```typescript
function resolveMultipleProposals(proposals: Proposal[], votes: RankedVote[]): Proposal {
  // Round 1: Count first-choice votes
  // If any has >50%, they win
  // Otherwise, eliminate lowest and redistribute
  // Repeat until winner
}
```

**Simpler Alternative** (Plurality with Tiebreaker):
```typescript
function resolveSimple(proposals: Proposal[], votes: Vote[]): Proposal {
  // Count votes for each
  // If tie: First proposed wins (rewards initiative)
  // If still tie: Owner breaks tie
}
```

### Scenario 4: Modification Proposals

**User Story**: "The museum opens at 10am, not 9am. I want to fix the time."

**Flow**:
```
[View Activity] → [Tap "Suggest Change"] → [Edit time/duration/notes]
     ↓
[Shows diff: "Changed: 9am → 10am"]
     ↓
[Quick approval: Any 2 people agree = accepted]
     ↓
[Activity updated, change logged in history]
```

**Lower Friction for Modifications**:
- Time/duration changes: 2 approvals (or owner alone)
- Notes/details: Immediate (logged for transparency)
- Location change: Treated as replacement (full vote)

### Scenario 5: Proposal Queue for Owners

**User Story**: "As trip owner, I want to see all pending proposals and manage them efficiently."

**Flow**:
```
[Trip Detail] → [Badge: "5 pending proposals"]
     ↓
[Tap] → [Proposal Queue View]
     ↓
[List grouped by day]
  • Day 1: 2 proposals
  • Day 3: 1 proposal (conflict!)
  • Day 4: 2 proposals
     ↓
[Owner actions: Approve All | Review Each | Force-Decide Conflicts]
```

---

## Part 2: State Definitions

### Activity Status Extended

```typescript
type ActivityVotingStatus =
  | 'confirmed'      // Accepted, on the itinerary
  | 'proposed'       // Waiting for votes (single proposal)
  | 'voting'         // Active voting in progress
  | 'contested'      // Has competing proposals (replacement scenario)
  | 'tournament'     // Multiple proposals for same slot
  | 'rejected'       // Voted down
  | 'deadlock'       // No consensus after 72h
  | 'archived'       // Lost in tournament, kept for history
  | 'completed'      // Trip day passed
  | 'skipped';       // Marked as skipped during trip
```

### Proposal Types

```typescript
type ProposalType =
  | 'new'           // New activity for a slot
  | 'replacement'   // Replace existing activity
  | 'modification'  // Change time/duration/details
  | 'removal';      // Propose removing an activity

interface Proposal {
  id: string;
  trip_id: string;
  type: ProposalType;

  // What's being proposed
  activity: Activity;           // For new/replacement
  target_activity_id?: string;  // For replacement/modification/removal
  changes?: ActivityChanges;    // For modification

  // Slot targeting
  target_day: number;           // Day index
  target_time_slot?: string;    // HH:mm format

  // Metadata
  proposed_by: string;
  proposed_at: string;
  expires_at?: string;

  // Status
  status: 'pending' | 'voting' | 'approved' | 'rejected' | 'withdrawn';

  // Grouping for tournaments
  slot_group_id?: string;       // Groups proposals for same slot
}
```

---

## Part 3: Mobile-First UI Components

### 3.1 Propose Button (Entry Point)

**Location**: Floating action button OR empty slot tap

```
┌────────────────────────────────────────┐
│  Day 2: April 15                        │
├────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  │
│  │ ☕ Morning Coffee                 │  │
│  │ Café de Flore • 9:00am           │  │
│  │ ✅ Confirmed                      │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│  │  + Suggest Activity              │  │  ← Dashed outline
│  │    Tap to propose                │  │    for empty slot
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │ 🏛️ Louvre Museum                 │  │
│  │ 2:00pm - 5:00pm                  │  │
│  │ 🔶 2 alternatives proposed       │  │  ← Orange badge
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

**Component**: `EmptySlotCard.tsx`
```tsx
interface EmptySlotCardProps {
  dayIndex: number;
  timeSlot?: string;  // "morning" | "afternoon" | "evening" or specific time
  onPropose: () => void;
  canPropose: boolean;
}
```

**Touch Target**: 48px minimum height, full width

### 3.2 Proposal Badge on Activity Cards

**States**:
- 🟡 **Proposed** (yellow) - Single proposal waiting
- 🔶 **2 alternatives** (orange) - Multiple proposals
- 🟢 **Confirmed** (green) - Accepted
- 🔴 **Rejected** (red, fades out)
- ⚪ **Voting** (pulsing blue) - Active vote

```
┌──────────────────────────────────────┐
│ 🏛️ Louvre Museum          [🔶 2 alt] │
│ Proposed by Sarah • 2h ago           │
│                                       │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐         │
│ │ 👍 │ │ 👌 │ │ 🤔 │ │ 👎 │  3/4   │
│ │ 2  │ │ 1  │ │ 0  │ │ 0  │ voted  │
│ └────┘ └────┘ └────┘ └────┘         │
│                                       │
│ [See Alternatives]                    │
└──────────────────────────────────────┘
```

### 3.3 Tournament View (Multiple Proposals)

**Bottom Sheet Modal** - Slides up when "See Alternatives" tapped

```
┌────────────────────────────────────────┐
│ ═══════════════════════════════════════│ ← Drag handle
│                                         │
│   Choose Dinner Option                  │
│   3 proposals • Day 2 Evening           │
│                                         │
├────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 🍕 Pizza Roma          👍 3     │   │ ← Leading
│  │ Proposed by Mike                 │   │
│  │ "Best pizza in the city!"       │   │
│  │ ████████████░░░░ 60%            │   │
│  │ [Vote for this]                  │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 🍣 Sushi Zen           👍 1     │   │
│  │ Proposed by Sarah                │   │
│  │ "Amazing omakase"               │   │
│  │ ████░░░░░░░░░░░░ 20%            │   │
│  │ [Vote for this]                  │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 🥘 Local Tapas         👍 1     │   │
│  │ Proposed by You                  │   │
│  │ "Authentic experience"          │   │
│  │ ████░░░░░░░░░░░░ 20%            │   │
│  │ [✓ Your vote]                   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ──────────────────────────────────── │
│  Voting ends in 23h or when 4/4 vote   │
│                                         │
└────────────────────────────────────────┘
```

**Component**: `TournamentBottomSheet.tsx`
```tsx
interface TournamentBottomSheetProps {
  proposals: Proposal[];
  votes: Map<string, Vote[]>;  // proposal_id → votes
  totalVoters: number;
  currentUserVote?: string;    // proposal_id user voted for
  onVote: (proposalId: string) => void;
  onClose: () => void;
  timeRemaining: string;
}
```

### 3.4 Quick Propose Flow (Bottom Sheet)

**Optimized for mobile - 3 taps to propose**:

```
Step 1: Search
┌────────────────────────────────────────┐
│ ═══════════════════════════════════════│
│                                         │
│   Suggest an Activity                   │
│   Day 2 Evening • April 15              │
│                                         │
│  ┌────────────────────────────────┐    │
│  │ 🔍 Search restaurants, museums...│    │
│  └────────────────────────────────┘    │
│                                         │
│  Recent Searches                        │
│  • Louvre Museum                        │
│  • Eiffel Tower                         │
│                                         │
│  From Activity Bank                     │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐          │
│  │🏛️  │ │🍕  │ │🎭  │ │🌳  │          │
│  └────┘ └────┘ └────┘ └────┘          │
│                                         │
└────────────────────────────────────────┘

Step 2: Confirm
┌────────────────────────────────────────┐
│ ═══════════════════════════════════════│
│                                         │
│   📍 Sushi Zen                          │
│   Japanese Restaurant                   │
│   ⭐ 4.8 • $$$  • 15 min walk          │
│                                         │
│  ┌────────────────────────────────┐    │
│  │ 📝 Add a note (optional)        │    │
│  │ "Best omakase in Paris!"       │    │
│  └────────────────────────────────┘    │
│                                         │
│  Proposed time: 7:00 PM                 │
│  Duration: ~2 hours                     │
│                                         │
│  ┌────────────────────────────────┐    │
│  │     ✨ Propose to Group         │    │  ← Primary CTA
│  └────────────────────────────────┘    │
│                                         │
└────────────────────────────────────────┘
```

### 3.5 Proposal Notification Cards

**In-app notification when someone proposes**:

```
┌────────────────────────────────────────┐
│ 🔔 Sarah proposed an activity          │
│                                         │
│ 🍣 Sushi Zen for Day 2 Dinner          │
│ "Amazing omakase experience!"          │
│                                         │
│ [View & Vote]              [Dismiss]   │
└────────────────────────────────────────┘
```

### 3.6 Owner's Proposal Queue

```
┌────────────────────────────────────────┐
│ ← Back            Pending Proposals    │
├────────────────────────────────────────┤
│                                         │
│  Day 1 - April 14                       │
│  ┌──────────────────────────────────┐  │
│  │ 🏛️ Orsay Museum                   │  │
│  │ By Sarah • 2h ago • 2/4 voted    │  │
│  │ [Force Confirm] [Force Reject]   │  │
│  └──────────────────────────────────┘  │
│                                         │
│  Day 3 - April 16                       │
│  ⚠️ Conflict: 3 proposals for dinner    │
│  ┌──────────────────────────────────┐  │
│  │ 🍕 Pizza Roma (Mike)             │  │
│  │ 🍣 Sushi Zen (Sarah)             │  │
│  │ 🥘 Tapas Bar (You)               │  │
│  │ [Resolve Conflict]               │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ────────────────────────────────────  │
│  [Approve All Non-Conflicting]         │
│                                         │
└────────────────────────────────────────┘
```

---

## Part 4: Engagement & Retention Design

### 4.1 Engagement Loops

**Daily Loop** (Active Planning Phase):
```
Notification: "2 new proposals for your Barcelona trip!"
     ↓
Open app → See what friends proposed
     ↓
Vote on proposals (satisfying micro-interaction)
     ↓
Propose something yourself (reciprocity)
     ↓
See votes come in (dopamine hit)
     ↓
Repeat daily until trip
```

**Weekly Loop** (Passive Phase):
```
Weekly digest: "Trip update: 5 activities confirmed!"
     ↓
Review trip progress
     ↓
Fill any gaps (propose for empty slots)
```

### 4.2 Notification Strategy

| Event | Push | In-App | Email |
|-------|------|--------|-------|
| New proposal | ✅ Immediate | ✅ | ❌ |
| Someone voted | ❌ | ✅ Badge | ❌ |
| Your proposal confirmed | ✅ Delayed 5min | ✅ Celebration | ❌ |
| Vote needed (reminder) | ✅ After 24h | ✅ | ✅ Weekly |
| Conflict detected | ✅ To owner | ✅ | ❌ |
| Deadlock needs resolution | ✅ To owner | ✅ | ✅ |

**Push Notification Caps**:
- Max 3 per day per trip
- Batch multiple events into one
- Quiet hours: 10pm - 8am local time

### 4.3 Gamification Elements

**Proposer Recognition**:
- "Top Contributor" badge for most accepted proposals
- "Great Taste" when your proposal gets all thumbs-up
- Show proposal acceptance rate in profile

**Voting Streaks**:
- "Active Planner" badge for voting daily
- Streak counter: "🔥 5 day voting streak"

**Trip Completion Progress**:
```
Trip Readiness: ████████░░ 80%
• 8/10 activities confirmed
• 2 pending proposals
• 0 conflicts
```

### 4.4 Converting Passive to Active

**Gentle Nudges for Non-Proposers**:
```
"Sarah and Mike have proposed 5 activities each.
 Got a favorite spot to share? [+ Propose]"
```

**Lowering Barrier**:
- Pre-filled suggestions: "Add this to your trip?" with one tap
- Activity Bank integration: browse without searching
- "Clone from Template" for common activities

---

## Part 5: ICE Scoring & Prioritization

### Feature Prioritization

| Feature | Impact (1-10) | Confidence (1-10) | Ease (1-10) | ICE Score | Priority |
|---------|---------------|-------------------|-------------|-----------|----------|
| **Basic Proposal Flow** | 9 | 9 | 7 | 8.3 | **P0** |
| Propose new activity for empty slot | | | | | |
| **Proposal Voting** | 9 | 9 | 8 | 8.7 | **P0** |
| Vote on single proposal | | | | | |
| **Replacement Proposals** | 8 | 8 | 6 | 7.3 | **P1** |
| "Propose alternative" to existing | | | | | |
| **Tournament View** | 7 | 7 | 5 | 6.3 | **P1** |
| Multiple proposals same slot | | | | | |
| **Owner Proposal Queue** | 6 | 8 | 7 | 7.0 | **P1** |
| Manage all pending proposals | | | | | |
| **Modification Proposals** | 5 | 7 | 8 | 6.7 | **P2** |
| Time/duration changes | | | | | |
| **Push Notifications** | 8 | 6 | 4 | 6.0 | **P2** |
| Notify on new proposals | | | | | |
| **Ranked Choice Voting** | 4 | 5 | 3 | 4.0 | **P3** |
| Complex tournament resolution | | | | | |
| **Gamification Badges** | 3 | 4 | 6 | 4.3 | **P3** |
| Contributor recognition | | | | | |

### Implementation Phases

**Phase 1 (MVP - P0)**: Basic Proposal + Voting
- Propose new activity (empty slot only)
- Vote on proposals
- Auto-confirm at consensus
- ~2-3 days

**Phase 2 (P1)**: Full Proposal System
- Replacement proposals
- Tournament view for conflicts
- Owner queue management
- ~3-4 days

**Phase 3 (P2)**: Polish & Notifications
- Modification proposals
- Push notifications
- Weekly digest email
- ~2-3 days

**Phase 4 (P3)**: Gamification
- Badges and recognition
- Advanced voting (ranked choice)
- Analytics dashboard
- Future iteration

---

## Part 6: Database Schema Extensions

### New Tables

```sql
-- Proposals table (extends activity_status concept)
CREATE TABLE activity_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- Proposal type
  type TEXT NOT NULL CHECK (type IN ('new', 'replacement', 'modification', 'removal')),

  -- The proposed activity (stored as JSONB for flexibility)
  activity_data JSONB NOT NULL,

  -- For replacements: what's being replaced
  target_activity_id TEXT,

  -- For modifications: the specific changes
  changes JSONB,

  -- Slot targeting
  target_day INTEGER NOT NULL,
  target_time_slot TEXT,  -- "morning", "afternoon", "evening", or "HH:mm"

  -- Grouping for tournament (same slot = same group)
  slot_group_id UUID,

  -- Metadata
  proposed_by UUID NOT NULL REFERENCES auth.users(id),
  proposed_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'voting', 'approved', 'rejected', 'withdrawn', 'superseded')),
  resolved_at TIMESTAMPTZ,
  resolution_method TEXT,  -- 'consensus', 'owner_force', 'timeout', 'withdrawn'

  -- Constraints
  UNIQUE(trip_id, target_day, target_time_slot, proposed_by, status)
    WHERE status IN ('pending', 'voting')  -- One active proposal per user per slot
);

-- Proposal votes (different from activity_votes - this is for choosing WHICH proposal)
CREATE TABLE proposal_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES activity_proposals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- For tournaments: rank preference (1 = first choice)
  rank INTEGER DEFAULT 1,

  voted_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(proposal_id, user_id)
);

-- Slot groups for tournament management
CREATE TABLE proposal_slot_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  target_day INTEGER NOT NULL,
  target_time_slot TEXT,

  status TEXT DEFAULT 'voting' CHECK (status IN ('voting', 'resolved')),
  winner_proposal_id UUID REFERENCES activity_proposals(id),
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(trip_id, target_day, target_time_slot)
);

-- Indexes
CREATE INDEX idx_proposals_trip ON activity_proposals(trip_id);
CREATE INDEX idx_proposals_status ON activity_proposals(status) WHERE status IN ('pending', 'voting');
CREATE INDEX idx_proposals_slot_group ON activity_proposals(slot_group_id);
CREATE INDEX idx_proposal_votes_proposal ON proposal_votes(proposal_id);
```

### RLS Policies

```sql
-- Proposals: Trip members can view, voters+ can propose
ALTER TABLE activity_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trip members can view proposals" ON activity_proposals
  FOR SELECT USING (public.user_can_access_trip(trip_id, auth.uid()));

CREATE POLICY "Voters can create proposals" ON activity_proposals
  FOR INSERT WITH CHECK (
    proposed_by = auth.uid()
    AND public.user_can_vote(trip_id, auth.uid())
  );

CREATE POLICY "Proposers can withdraw own proposals" ON activity_proposals
  FOR UPDATE USING (proposed_by = auth.uid())
  WITH CHECK (status = 'withdrawn');

-- Proposal votes
ALTER TABLE proposal_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trip members can view proposal votes" ON proposal_votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM activity_proposals p
      WHERE p.id = proposal_id
      AND public.user_can_access_trip(p.trip_id, auth.uid())
    )
  );

CREATE POLICY "Voters can vote on proposals" ON proposal_votes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM activity_proposals p
      WHERE p.id = proposal_id
      AND public.user_can_vote(p.trip_id, auth.uid())
    )
  );
```

---

## Part 7: API Endpoints

### Proposal Endpoints

```typescript
// POST /api/trips/[id]/proposals
// Create a new proposal
interface CreateProposalRequest {
  type: 'new' | 'replacement' | 'modification' | 'removal';
  activity?: Activity;          // For new/replacement
  target_activity_id?: string;  // For replacement/modification/removal
  changes?: ActivityChanges;    // For modification
  target_day: number;
  target_time_slot?: string;
  note?: string;
}

// GET /api/trips/[id]/proposals
// List all proposals (with filters)
interface ListProposalsQuery {
  status?: 'pending' | 'voting' | 'all';
  day?: number;
}

// GET /api/trips/[id]/proposals/[proposalId]
// Get proposal details with votes

// POST /api/trips/[id]/proposals/[proposalId]/vote
// Vote for a proposal (in tournament context)

// DELETE /api/trips/[id]/proposals/[proposalId]
// Withdraw own proposal

// POST /api/trips/[id]/proposals/[proposalId]/resolve
// Owner force-resolve (approve/reject)
```

### Slot Group Endpoints

```typescript
// GET /api/trips/[id]/slot-conflicts
// List all slots with multiple proposals

// POST /api/trips/[id]/slot-conflicts/[groupId]/resolve
// Owner resolves conflict by selecting winner
```

---

## Part 8: Component Architecture

### New Components to Create

```
components/
└── collaboration/
    ├── proposals/
    │   ├── ProposeButton.tsx           # Entry point CTA
    │   ├── ProposalCard.tsx            # Single proposal display
    │   ├── ProposalBadge.tsx           # Status badge (Proposed/Voting/etc)
    │   ├── ProposeActivitySheet.tsx    # Bottom sheet for creating proposal
    │   ├── TournamentSheet.tsx         # Multiple proposals comparison
    │   ├── ProposalVoteButtons.tsx     # Vote for THIS proposal
    │   └── ProposalQueue.tsx           # Owner's management view
    │
    ├── EmptySlotCard.tsx               # Dashed "+" card for empty slots
    │
    └── notifications/
        ├── ProposalNotification.tsx    # In-app notification card
        └── NotificationBadge.tsx       # Unread count badge
```

### Integration Points

**EditableActivityCard.tsx** changes:
- Add "Propose Alternative" menu item (for voters viewing confirmed activities)
- Show ProposalBadge when activity has proposals
- Show "X proposals" indicator for contested activities

**DaySection.tsx** changes:
- Render EmptySlotCard for time gaps
- Group activities by time slot
- Show slot conflict indicator

**TripDetailClient.tsx** changes:
- Add `useProposals` hook
- Handle proposal creation flow
- Manage tournament resolution

---

## Part 9: Success Metrics

### Engagement Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Proposals per trip | ≥5 | AVG proposals / trip with ≥2 collaborators |
| Proposal-to-vote rate | ≥70% | Proposals that receive ≥1 vote within 24h |
| Voter participation | ≥80% | Collaborators who vote / total collaborators |
| Conflict resolution time | <48h | AVG time from conflict → resolution |
| Proposer retention | +20% | D7 retention of users who proposed vs didn't |

### Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Proposal acceptance rate | ≥60% | Approved / total proposals |
| Force-resolution rate | <10% | Owner force-decides / total resolutions |
| Deadlock rate | <5% | Deadlocks / total contested slots |

---

## Appendix: UI Specifications

### Touch Targets
- All buttons: minimum 44x44px
- Vote buttons: 48x48px with 8px gaps
- Cards: full width tap area

### Colors (using existing palette)
- Proposed: `amber-500` (#f59e0b)
- Voting: `blue-500` (#3b82f6) with pulse animation
- Confirmed: `green-500` (#22c55e)
- Rejected: `red-500` (#ef4444)
- Contested: `orange-500` (#f97316)

### Animations
- Proposal card entry: slide up + fade in (200ms)
- Vote cast: button scale bounce (150ms)
- Status change: color morph (300ms)
- Tournament winner: confetti burst (optional, 500ms)

### Typography
- Proposal title: `text-base font-semibold`
- Proposer name: `text-sm text-slate-600`
- Vote counts: `text-sm font-medium`
- Status badges: `text-xs font-medium uppercase`
