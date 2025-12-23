# Collaboration System Analytics Integration Plan

## Executive Summary

This plan details the integration of the collaboration system metrics into the Growth Analytics Dashboard. The goal is to track collaboration adoption, proposal engagement, and voting behavior while measuring their impact on user retention.

---

## Current State Analysis

### Database Tables

| Table | Rows | Purpose |
|-------|------|---------|
| `trip_collaborators` | 2 | Users with access to trips (role: owner/editor/voter/viewer) |
| `trip_invites` | 2 | Shareable invite links with role assignment |
| `activity_proposals` | 6 | Proposed activities for group decision-making |
| `proposal_votes` | 4 | Binary votes (approve/reject) on proposals |
| `activity_votes` | 2 | 4-point scale votes on existing activities |
| `activity_status` | 0 | Activity lifecycle tracking |
| `activity_reactions` | 0 | Emoji reactions on activities |

### Current Data Summary

- **Collaborators**: 2 total, 1 unique user, roles: 1 voter + 1 editor
- **Invites**: 2 total (2 active), 1 used, all voter role
- **Proposals**: 6 total (2 pending, 4 voting), 0 resolved
- **Proposal Votes**: 16 votes, 4 proposals with votes, 1 voter
- **Activity Votes**: 2 votes (both "love"), 2 voters

---

## Proposed KPIs

### 1. Collaboration Adoption Metrics

| KPI | Formula | Purpose |
|-----|---------|---------|
| `collaborativeTrips` | Trips with 2+ collaborators | Core adoption metric |
| `tripsWithInvites` | Distinct trips with invite links | Funnel entry point |
| `totalInvitesCreated` | COUNT(trip_invites) | Share intent |
| `inviteAcceptRate` | SUM(use_count) / COUNT(invites) * 100 | Conversion metric |
| `avgCollaboratorsPerTrip` | AVG collaborators per collaborative trip | Team size |
| `roleDistribution` | Count by role (editor/voter/viewer) | Permission usage |

### 2. Proposal Engagement Metrics

| KPI | Formula | Purpose |
|-----|---------|---------|
| `totalProposals` | COUNT(activity_proposals) | Volume metric |
| `proposalsByStatus` | GROUP BY status | Pipeline view |
| `proposalApprovalRate` | approved / (approved + rejected) * 100 | Success rate |
| `proposersCount` | DISTINCT proposed_by | Creator engagement |
| `avgVotesPerProposal` | votes / proposals with votes | Participation depth |
| `resolutionMethods` | GROUP BY resolution_method | How decisions are made |

### 3. Voting Participation Metrics

| KPI | Formula | Purpose |
|-----|---------|---------|
| `totalProposalVotes` | COUNT(proposal_votes) | Volume |
| `uniqueVoters` | DISTINCT user_id from votes | Engagement breadth |
| `voteDistribution` | approve vs reject counts | Sentiment |
| `participationRate` | voters / eligible collaborators * 100 | Engagement rate |

### 4. Collaboration Aha Moments

| Action | Measure | Expected Impact |
|--------|---------|-----------------|
| Created Invite | D7 retention: did vs didn't | High lift expected |
| Joined via Invite | D7 retention: joined vs organic | Network effect |
| Voted on Proposal | D7 retention: voted vs didn't | Engagement signal |
| Created Proposal | D7 retention: proposed vs didn't | Power user signal |

### 5. Collaboration Funnel

```
Users Created Trip → Created Invite → Invite Accepted → Proposal Created → Proposal Resolved
     (60)              (2)              (1)              (6)               (0)
```

---

## Implementation Plan

### Phase 1: Extend GrowthStats Interface

Add new `collaboration` property to `GrowthStats` interface in `/app/api/admin/growth/route.ts`:

```typescript
collaboration: {
  // Adoption
  collaborativeTrips: number;        // Trips with 2+ collaborators
  tripsWithInvites: number;          // Trips with invite links
  totalInvitesCreated: number;       // Total invites
  inviteAcceptRate: number;          // % invites used
  avgCollaboratorsPerTrip: number;   // Avg team size
  totalCollaborators: number;        // Total collaborator records

  // Proposals
  totalProposals: number;
  proposalsByStatus: {
    pending: number;
    voting: number;
    approved: number;
    rejected: number;
    withdrawn: number;
    expired: number;
  };
  proposalApprovalRate: number;      // % of resolved that were approved
  avgVotesPerProposal: number;
  proposersCount: number;

  // Voting
  totalProposalVotes: number;
  uniqueVoters: number;
  voteDistribution: { approve: number; reject: number };
  participationRate: number;

  // Resolution
  resolutionMethods: {
    consensus: number;
    ownerOverride: number;
    autoApprove: number;
    timeout: number;
    withdrawn: number;
  };

  // Role distribution
  roleDistribution: {
    owner: number;
    editor: number;
    voter: number;
    viewer: number;
  };

  // Funnel
  funnel: {
    tripsCreated: number;
    invitesCreated: number;
    invitesAccepted: number;
    proposalsCreated: number;
    proposalsResolved: number;
  };
};
```

### Phase 2: Add Data Fetching

Add new parallel queries to fetch collaboration data:

```typescript
// Add to Promise.all in growth route
collaboratorsResult,
invitesResult,
proposalsResult,
proposalVotesResult,
```

### Phase 3: Add Aha Moments

Add collaboration-related aha moment calculations:

```typescript
ahaMoments: {
  // Existing...
  createdInvite: { didIt: number; didntDoIt: number; retentionLift: number };
  joinedViaInvite: { didIt: number; didntDoIt: number; retentionLift: number };
  votedOnProposal: { didIt: number; didntDoIt: number; retentionLift: number };
  createdProposal: { didIt: number; didntDoIt: number; retentionLift: number };
};
```

### Phase 4: Create UI Component

Add `CollaborationAnalytics` component to GrowthDashboard:

- Adoption metrics cards
- Proposal pipeline visualization
- Voting distribution chart
- Collaboration funnel

---

## Data Integrity Verification

### Required Checks

1. **Collaborator Uniqueness**: UNIQUE(trip_id, user_id) constraint verified ✓
2. **Invite Token Uniqueness**: UNIQUE(token) constraint verified ✓
3. **Vote Uniqueness**: UNIQUE(proposal_id, user_id) constraint verified ✓
4. **Role Validation**: CHECK constraints on role columns verified ✓
5. **Status Validation**: CHECK constraints on status columns verified ✓

### Data Quality Issues Found

1. **proposal_votes.vote_type**: All 16 votes are "reject" - likely testing data
2. **No resolved proposals**: All proposals in pending/voting status
3. **Low collaboration**: 0 trips with 2+ collaborators

---

## Risk Mitigation

### Parallel Development Concerns

**Other Claude instances are working on UI/UX of collaboration system.**

**Strategy:**
1. Focus ONLY on API layer (growth/route.ts)
2. Create NEW UI component (don't modify existing)
3. Keep changes additive, not modifying
4. Avoid touching any files in `/components/collaboration/`

### Backwards Compatibility

- New `collaboration` field is optional in GrowthStats
- Existing dashboard continues to work if field is missing
- UI component gracefully handles empty data

---

## Files to Modify

| File | Changes | Risk |
|------|---------|------|
| `/app/api/admin/growth/route.ts` | Add collaboration queries + metrics | LOW - additive only |
| `/components/admin/GrowthDashboard.tsx` | Add CollaborationAnalytics section | LOW - additive only |

### Files NOT to Touch

- `/components/collaboration/*` - UI/UX being modified by other instances
- `/app/api/trips/[id]/proposals/*` - Core functionality
- `/app/api/trips/[id]/collaborators/*` - Core functionality
- `/lib/hooks/useProposals.ts` - Client-side logic
- `/lib/proposals/consensus.ts` - Business logic

---

## Success Metrics

After implementation:

1. **All KPIs visible** in Growth Dashboard under new "Collaboration" section
2. **No build errors** - TypeScript types properly extended
3. **No UI conflicts** - Changes isolated from collaboration UI work
4. **Data accuracy** - Metrics match raw SQL queries

---

## Estimated Effort

| Task | Lines | Time |
|------|-------|------|
| Extend GrowthStats interface | ~50 | 5 min |
| Add data fetching | ~30 | 5 min |
| Calculate collaboration metrics | ~100 | 15 min |
| Calculate aha moments | ~40 | 10 min |
| Create UI component | ~200 | 20 min |
| Testing & verification | - | 10 min |
| **Total** | **~420** | **~65 min** |

---

## Next Steps

1. ✅ Document plan (this file)
2. ⏳ Implement collaboration metrics in growth route
3. ⏳ Add collaboration aha moments
4. ⏳ Create CollaborationAnalytics UI component
5. ⏳ Verify build passes
6. ⏳ Test with current data
