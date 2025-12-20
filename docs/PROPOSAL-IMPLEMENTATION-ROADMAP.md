# Proposal System Implementation Roadmap

## Quick Reference

**Total Estimated Effort**: 8-12 days across 4 phases
**Dependencies**: Existing voting system (complete), Collaboration system (complete)

---

## Phase 1: Core Proposal MVP (P0) - Days 1-3

### Goal
Allow voters to propose new activities for empty slots and vote on them.

### Day 1: Database & Types

**1.1 Create Migration**
```bash
File: supabase/migrations/20251221_create_proposals.sql
```

```sql
-- activity_proposals table
CREATE TABLE activity_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'new' CHECK (type IN ('new', 'replacement', 'modification', 'removal')),
  activity_data JSONB NOT NULL,
  target_activity_id TEXT,
  changes JSONB,
  target_day INTEGER NOT NULL,
  target_time_slot TEXT,
  slot_group_id UUID,
  proposed_by UUID NOT NULL REFERENCES auth.users(id),
  proposed_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'voting', 'approved', 'rejected', 'withdrawn', 'superseded')),
  resolved_at TIMESTAMPTZ,
  resolution_method TEXT,
  note TEXT
);

-- proposal_votes table
CREATE TABLE proposal_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES activity_proposals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote_type TEXT NOT NULL DEFAULT 'approve' CHECK (vote_type IN ('approve', 'reject')),
  rank INTEGER DEFAULT 1,
  voted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(proposal_id, user_id)
);

-- Indexes
CREATE INDEX idx_proposals_trip ON activity_proposals(trip_id);
CREATE INDEX idx_proposals_trip_status ON activity_proposals(trip_id, status);
CREATE INDEX idx_proposal_votes_proposal ON proposal_votes(proposal_id);

-- RLS (use existing user_can_vote function)
ALTER TABLE activity_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trip members view proposals" ON activity_proposals FOR SELECT
  USING (public.user_can_access_trip(trip_id, auth.uid()));

CREATE POLICY "Voters create proposals" ON activity_proposals FOR INSERT
  WITH CHECK (proposed_by = auth.uid() AND public.user_can_vote(trip_id, auth.uid()));

CREATE POLICY "Proposers update own" ON activity_proposals FOR UPDATE
  USING (proposed_by = auth.uid());

CREATE POLICY "View proposal votes" ON proposal_votes FOR SELECT
  USING (EXISTS (SELECT 1 FROM activity_proposals p WHERE p.id = proposal_id AND public.user_can_access_trip(p.trip_id, auth.uid())));

CREATE POLICY "Cast proposal votes" ON proposal_votes FOR INSERT
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM activity_proposals p WHERE p.id = proposal_id AND public.user_can_vote(p.trip_id, auth.uid())));

CREATE POLICY "Update own votes" ON proposal_votes FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Delete own votes" ON proposal_votes FOR DELETE
  USING (user_id = auth.uid());
```

**1.2 Add TypeScript Types**
```bash
File: types/index.ts (append)
```

```typescript
// Proposal Types
export type ProposalType = 'new' | 'replacement' | 'modification' | 'removal';
export type ProposalStatus = 'pending' | 'voting' | 'approved' | 'rejected' | 'withdrawn' | 'superseded';

export interface ActivityProposal {
  id: string;
  trip_id: string;
  type: ProposalType;
  activity_data: Activity;
  target_activity_id?: string;
  changes?: Record<string, unknown>;
  target_day: number;
  target_time_slot?: string;
  slot_group_id?: string;
  proposed_by: string;
  proposed_at: string;
  expires_at: string;
  status: ProposalStatus;
  resolved_at?: string;
  resolution_method?: string;
  note?: string;
  // Joined data
  proposer?: {
    display_name: string;
    avatar_url?: string;
  };
  votes?: ProposalVote[];
  vote_summary?: {
    approve: number;
    reject: number;
    total: number;
  };
}

export interface ProposalVote {
  id: string;
  proposal_id: string;
  user_id: string;
  vote_type: 'approve' | 'reject';
  rank?: number;
  voted_at: string;
  user?: {
    display_name: string;
    avatar_url?: string;
  };
}

export interface ProposalConsensusResult {
  status: 'waiting' | 'likely_approve' | 'approved' | 'rejected' | 'deadlock';
  approveCount: number;
  rejectCount: number;
  participation: number;
  canAutoResolve: boolean;
}
```

### Day 2: API Endpoints

**2.1 Create Proposal Endpoint**
```bash
File: app/api/trips/[id]/proposals/route.ts
```

- `GET` - List proposals for trip (with status filter)
- `POST` - Create new proposal

**2.2 Single Proposal Endpoint**
```bash
File: app/api/trips/[id]/proposals/[proposalId]/route.ts
```

- `GET` - Get proposal with votes
- `DELETE` - Withdraw proposal (owner only)
- `PATCH` - Update status (force approve/reject by owner)

**2.3 Proposal Vote Endpoint**
```bash
File: app/api/trips/[id]/proposals/[proposalId]/vote/route.ts
```

- `POST` - Cast vote on proposal
- `DELETE` - Remove vote

### Day 3: Basic UI Components

**3.1 Empty Slot Card**
```bash
File: components/collaboration/EmptySlotCard.tsx
```

Dashed outline card with "+" icon, tappable to open propose sheet.

**3.2 Propose Activity Sheet**
```bash
File: components/collaboration/proposals/ProposeActivitySheet.tsx
```

Bottom sheet modal with:
- Search input for places
- Activity Bank quick picks
- Confirm button

**3.3 Proposal Badge**
```bash
File: components/collaboration/proposals/ProposalBadge.tsx
```

Small status indicator: Proposed (yellow), Voting (blue pulse), Approved (green).

**3.4 Integration Hook**
```bash
File: lib/hooks/useProposals.ts
```

```typescript
interface UseProposalsReturn {
  proposals: ActivityProposal[];
  isLoading: boolean;
  createProposal: (data: CreateProposalInput) => Promise<void>;
  voteOnProposal: (proposalId: string, voteType: 'approve' | 'reject') => Promise<void>;
  withdrawProposal: (proposalId: string) => Promise<void>;
  getProposalsForSlot: (day: number, timeSlot?: string) => ActivityProposal[];
}
```

---

## Phase 2: Replacement & Tournament (P1) - Days 4-7

### Goal
Handle replacement proposals and multiple proposals for same slot.

### Day 4: Replacement Flow

**4.1 Add "Propose Alternative" to Activity Card**
```bash
File: components/trip/EditableActivityCard.tsx
Modify: Add menu item for voters
```

**4.2 Replacement Proposal UI**
```bash
File: components/collaboration/proposals/ReplacementCompareView.tsx
```

Side-by-side comparison: Current Activity vs Proposed Replacement.

### Day 5: Tournament System

**5.1 Slot Grouping Logic**
```bash
File: lib/proposals/tournament.ts
```

```typescript
// Group proposals by slot
export function groupProposalsBySlot(proposals: ActivityProposal[]): Map<string, ActivityProposal[]>

// Calculate tournament winner
export function calculateTournamentWinner(
  proposals: ActivityProposal[],
  votes: Map<string, ProposalVote[]>,
  totalVoters: number
): { winner: ActivityProposal | null; status: 'voting' | 'winner' | 'tie' }
```

**5.2 Tournament Bottom Sheet**
```bash
File: components/collaboration/proposals/TournamentSheet.tsx
```

Shows all proposals for a contested slot with vote progress.

### Day 6: Conflict Detection

**6.1 Slot Conflict Indicator**
```bash
File: components/collaboration/proposals/SlotConflictBadge.tsx
```

Badge showing "3 proposals" for contested slots.

**6.2 Day Section Integration**
```bash
File: components/trip/DaySection.tsx
Modify: Render empty slot cards, show conflict badges
```

### Day 7: Real-time Updates

**7.1 Extend useProposals Hook**
```bash
File: lib/hooks/useProposals.ts
Modify: Add Supabase Realtime subscription
```

Subscribe to `activity_proposals` and `proposal_votes` changes.

---

## Phase 3: Owner Tools & Notifications (P2) - Days 8-10

### Goal
Give owners management tools and add notification system.

### Day 8: Owner Proposal Queue

**8.1 Proposal Queue Page/Component**
```bash
File: components/collaboration/proposals/ProposalQueue.tsx
```

List all pending proposals grouped by day, with bulk actions.

**8.2 Force Resolve UI**
```bash
File: components/collaboration/proposals/ForceResolveDialog.tsx
```

Confirmation modal for owner to force-approve or force-reject.

### Day 9: Notification System

**9.1 In-App Notifications**
```bash
File: components/collaboration/notifications/ProposalNotification.tsx
```

Toast-style notifications for new proposals.

**9.2 Notification Badge**
```bash
File: components/collaboration/notifications/NotificationBadge.tsx
```

Unread count badge for trip header.

### Day 10: Email Notifications (Optional)

**10.1 Email Templates**
```bash
Files:
- emails/proposal-new.tsx
- emails/proposal-approved.tsx
- emails/weekly-digest.tsx
```

**10.2 Notification Preferences**
```bash
File: app/api/users/notification-preferences/route.ts
```

Allow users to configure notification settings.

---

## Phase 4: Polish & Gamification (P3) - Days 11-12

### Goal
Add engagement features and polish the experience.

### Day 11: Activity Integration

**11.1 Auto-Add Approved Proposals to Itinerary**
```bash
File: lib/proposals/integration.ts
```

When proposal is approved, automatically add activity to trip's itinerary JSONB.

**11.2 Proposal History**
```bash
File: components/collaboration/proposals/ProposalHistory.tsx
```

Show archived/rejected proposals for transparency.

### Day 12: Gamification

**12.1 Contributor Stats**
```bash
File: components/collaboration/ContributorStats.tsx
```

Show proposal counts, acceptance rates per collaborator.

**12.2 Trip Readiness Indicator**
```bash
File: components/collaboration/TripReadiness.tsx
```

Progress bar showing confirmed vs pending activities.

---

## File Change Summary

### New Files (Create)

| File | Phase | Priority |
|------|-------|----------|
| `supabase/migrations/20251221_create_proposals.sql` | 1 | P0 |
| `types/index.ts` (append) | 1 | P0 |
| `app/api/trips/[id]/proposals/route.ts` | 1 | P0 |
| `app/api/trips/[id]/proposals/[proposalId]/route.ts` | 1 | P0 |
| `app/api/trips/[id]/proposals/[proposalId]/vote/route.ts` | 1 | P0 |
| `lib/hooks/useProposals.ts` | 1 | P0 |
| `components/collaboration/EmptySlotCard.tsx` | 1 | P0 |
| `components/collaboration/proposals/ProposeActivitySheet.tsx` | 1 | P0 |
| `components/collaboration/proposals/ProposalBadge.tsx` | 1 | P0 |
| `components/collaboration/proposals/ProposalCard.tsx` | 1 | P0 |
| `lib/proposals/tournament.ts` | 2 | P1 |
| `components/collaboration/proposals/TournamentSheet.tsx` | 2 | P1 |
| `components/collaboration/proposals/ReplacementCompareView.tsx` | 2 | P1 |
| `components/collaboration/proposals/SlotConflictBadge.tsx` | 2 | P1 |
| `components/collaboration/proposals/ProposalQueue.tsx` | 3 | P2 |
| `components/collaboration/proposals/ForceResolveDialog.tsx` | 3 | P2 |
| `components/collaboration/notifications/ProposalNotification.tsx` | 3 | P2 |
| `lib/proposals/integration.ts` | 4 | P3 |
| `components/collaboration/ContributorStats.tsx` | 4 | P3 |
| `components/collaboration/TripReadiness.tsx` | 4 | P3 |

### Modified Files

| File | Phase | Changes |
|------|-------|---------|
| `types/index.ts` | 1 | Add proposal types |
| `components/trip/EditableActivityCard.tsx` | 2 | Add "Propose Alternative" menu |
| `components/trip/DaySection.tsx` | 2 | Render EmptySlotCard, conflict badges |
| `app/trips/[id]/TripDetailClient.tsx` | 1-2 | Add useProposals hook, pass props |

---

## Testing Checklist

### Phase 1 Tests
- [ ] Create proposal as voter succeeds
- [ ] Create proposal as viewer fails (403)
- [ ] Vote on proposal updates count
- [ ] Proposal auto-approves at consensus
- [ ] Real-time updates work across clients

### Phase 2 Tests
- [ ] Replacement proposal shows comparison view
- [ ] Multiple proposals show tournament view
- [ ] Tournament winner selection works
- [ ] Slot conflict badge appears correctly

### Phase 3 Tests
- [ ] Owner sees proposal queue
- [ ] Force-resolve updates proposal status
- [ ] Notifications appear for new proposals
- [ ] Notification badge shows correct count

### Phase 4 Tests
- [ ] Approved proposals add to itinerary
- [ ] Contributor stats calculate correctly
- [ ] Trip readiness percentage is accurate

---

## Rollback Plan

If issues arise:

1. **Database**: Migration can be reversed with:
   ```sql
   DROP TABLE IF EXISTS proposal_votes;
   DROP TABLE IF EXISTS activity_proposals;
   ```

2. **UI**: Feature flag can hide proposal UI:
   ```typescript
   const ENABLE_PROPOSALS = process.env.NEXT_PUBLIC_ENABLE_PROPOSALS === 'true';
   ```

3. **API**: Endpoints return 404 when feature is disabled.
