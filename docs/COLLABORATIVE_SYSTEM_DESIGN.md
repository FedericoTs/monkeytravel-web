# Collaborative Trip Planning System Design

> **Version**: 1.0
> **Date**: December 20, 2025
> **Status**: Design Complete - Ready for Implementation
> **Research Sources**: [Figma Multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [NN/g Dot Voting](https://www.nngroup.com/articles/dot-voting/), [Loomio Consensus](https://www.loomio.com/), [SquadTrip](https://squadtrip.com/)

---

## Executive Summary

This document defines the complete design for MonkeyTravel's collaborative trip planning system. The core innovation is treating activities as **proposals that require group consensus** rather than direct edits, enabling graceful conflict resolution when travelers disagree.

### Design Principles

1. **Proposals, Not Edits** - Changes are suggestions until the group agrees
2. **Transparent Decision-Making** - Everyone sees who voted and why
3. **Passive-Friendly** - Works for both active planners and observers
4. **Mobile-First** - Touch-optimized, thumb-zone accessible
5. **Real-Time Joy** - Presence and reactions create social connection
6. **Graceful Degradation** - Works offline, syncs when reconnected

---

## Part 1: The Activity Lifecycle

### State Machine: From Idea to Memory

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    │
│ PROPOSED │───▶│  VOTING  │───▶│ CONFIRMED│───▶│ COMPLETED│    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    │
     │               │               │               │           │
     │               │               │               │           │
     ▼               ▼               ▼               ▼           │
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    │
│ REJECTED │    │ DEADLOCK │    │ REPLACED │    │  SKIPPED │    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    │
     │               │               │                           │
     └───────────────┴───────────────┴───────────────────────────┘
                          (Can be re-proposed)
```

### State Definitions

| State | Description | Visual Treatment | Actions Available |
|-------|-------------|------------------|-------------------|
| **PROPOSED** | New activity suggestion awaiting votes | Dashed border, amber badge "Pending" | Vote, Comment, Edit (proposer only), Withdraw |
| **VOTING** | Active voting in progress | Pulse animation, vote count visible | Vote, Change vote, Add reaction |
| **CONFIRMED** | Group approved, on official itinerary | Solid border, green checkmark | Edit (creates new proposal), Complete, Skip |
| **COMPLETED** | Done during trip | Green background, strikethrough | Rate, Add photos, Undo |
| **SKIPPED** | Group skipped during trip | Gray background, skip icon | Undo skip |
| **REJECTED** | Group voted no | Red X, collapsed by default | Re-propose with changes |
| **DEADLOCK** | No consensus reached | Yellow warning, needs discussion | Discuss, Modify, Escalate to owner |
| **REPLACED** | Replaced by another activity | Gray, link to replacement | View history |

### Auto-Confirmation Rules

Activities are **auto-confirmed** when:
1. **Solo trip** - No collaborators, instant confirm
2. **Unanimous approval** - All voters say yes
3. **Owner override** - Trip owner forces approval (premium feature)
4. **Time-based** - 48h passed with majority approval and no active objections
5. **Original itinerary** - AI-generated activities start as confirmed

### Deadlock Resolution

When votes are tied or no consensus after 72 hours:

```
DEADLOCK RESOLUTION OPTIONS:

1. DISCUSSION THREAD
   └── Opens focused chat about this activity
   └── AI summarizes key points of disagreement
   └── Suggests compromises

2. MODIFY & RE-VOTE
   └── Proposer edits the activity
   └── New vote starts with clean slate
   └── Previous voters notified

3. OWNER DECIDES
   └── Trip owner breaks the tie
   └── Marked as "Owner's choice"
   └── Others see it was escalated

4. REMOVE FROM ITINERARY
   └── Activity removed, no hard feelings
   └── Can be re-proposed later
   └── Alternative suggestions offered by AI
```

---

## Part 2: Permission System

### Role Hierarchy

```
OWNER (Creator)
├── Full control over all aspects
├── Can change anyone's role
├── Can delete trip
├── Can force-confirm activities (breaks deadlock)
├── Can remove collaborators
└── Receives all notifications

EDITOR
├── Can propose new activities
├── Can edit their own proposals
├── Can vote on all activities
├── Can manage logistics (dates, destination)
├── Can invite new collaborators (as Voter or Viewer)
└── Receives activity notifications

VOTER (Default for invites)
├── Can vote on activities
├── Can add reactions and comments
├── Can propose activities (enters Proposed state)
├── Cannot edit others' proposals
├── Cannot change trip settings
└── Receives vote-related notifications

VIEWER
├── Read-only access to itinerary
├── Can add reactions (emoji only)
├── Cannot vote or propose
├── Cannot see private discussions
└── Receives minimal notifications
```

### Permission Matrix

| Action | Owner | Editor | Voter | Viewer |
|--------|-------|--------|-------|--------|
| View trip & activities | ✅ | ✅ | ✅ | ✅ |
| Add reactions/emoji | ✅ | ✅ | ✅ | ✅ |
| Vote on activities | ✅ | ✅ | ✅ | ❌ |
| Propose new activity | ✅ | ✅ | ✅ | ❌ |
| Comment on activities | ✅ | ✅ | ✅ | ❌ |
| Edit own proposals | ✅ | ✅ | ✅ | ❌ |
| Edit others' proposals | ✅ | ❌ | ❌ | ❌ |
| Delete any activity | ✅ | ❌ | ❌ | ❌ |
| Force-confirm activity | ✅ | ❌ | ❌ | ❌ |
| Change trip dates/destination | ✅ | ✅ | ❌ | ❌ |
| Invite collaborators | ✅ | ✅* | ❌ | ❌ |
| Remove collaborators | ✅ | ❌ | ❌ | ❌ |
| Change roles | ✅ | ❌ | ❌ | ❌ |
| Delete trip | ✅ | ❌ | ❌ | ❌ |
| Export trip | ✅ | ✅ | ✅ | ❌ |

*Editors can only invite as Voter or Viewer, not Editor or Owner

### Dynamic Permission Escalation

```
PASSIVE USER DETECTION:
├── If user hasn't voted in 5+ activities
├── AND hasn't opened app in 48+ hours
├── THEN: Auto-downgrade vote weight to 0.5x
├── Notification: "We noticed you're less active. Your votes now count as preferences rather than requirements."
└── Can re-engage anytime to restore full weight

ACTIVE CONTRIBUTOR BONUS:
├── If user proposed 3+ confirmed activities
├── OR has 90%+ vote participation
├── THEN: Show "Active Planner" badge
└── Their proposals get priority in the feed
```

---

## Part 3: Voting & Consensus System

### Vote Types

Inspired by [Loomio's consensus model](https://www.loomio.com/) and [NN/g dot voting research](https://www.nngroup.com/articles/dot-voting/):

```
VOTE OPTIONS (4-point scale):

👍 YES, LOVE IT
   └── "I want to do this activity"
   └── Weight: +2

👌 SURE, I'M FLEXIBLE
   └── "I'm okay with this, but don't feel strongly"
   └── Weight: +1

🤔 HAVE CONCERNS
   └── "I have questions/reservations" (prompts comment)
   └── Weight: -1
   └── Requires explanation

👎 NO, NOT FOR ME
   └── "I don't want to do this activity"
   └── Weight: -2
   └── Requires explanation (what would you prefer?)
```

### Consensus Calculation

```javascript
function calculateConsensus(votes, totalVoters) {
  const weights = {
    'love': 2,
    'flexible': 1,
    'concerns': -1,
    'no': -2
  };

  let totalWeight = 0;
  let votedCount = 0;
  let hasStrongObjection = false;

  for (const vote of votes) {
    totalWeight += weights[vote.type] * vote.userWeight;
    votedCount++;
    if (vote.type === 'no') hasStrongObjection = true;
  }

  const participation = votedCount / totalVoters;
  const avgScore = totalWeight / votedCount;

  // Decision rules
  if (participation < 0.5) return 'WAITING'; // Need more votes
  if (hasStrongObjection && avgScore < 1) return 'DEADLOCK';
  if (avgScore >= 1.5) return 'CONFIRMED'; // Strong approval
  if (avgScore >= 0.5) return 'LIKELY_YES'; // Soft approval
  if (avgScore <= -1) return 'REJECTED';
  return 'VOTING'; // Still undecided
}
```

### Visual Vote Display

```
┌─────────────────────────────────────────┐
│ 🏛️ Louvre Museum                        │
│ Proposed by Sarah • 2 hours ago         │
├─────────────────────────────────────────┤
│                                         │
│  [👍 2] [👌 1] [🤔 0] [👎 0]              │
│                                         │
│  ████████████░░░░░░░ 3/4 voted          │
│                                         │
│  Waiting for: Mike                      │
│                                         │
│  [Cast Your Vote ▾]                     │
│                                         │
└─────────────────────────────────────────┘
```

### Reaction System (Non-Voting Feedback)

Separate from votes, anyone can add quick reactions:

```
QUICK REACTIONS (emoji bar):
🔥 Hot pick     → "This looks amazing"
💰 Pricey       → "Might be expensive"
🚶 Walkable     → "We can walk there"
📸 Photo spot   → "Great for photos"
🍽️ Food nearby  → "Good food options"
⏰ Time crunch  → "Might be rushed"
❤️ Must-do      → "This is essential"
```

Reactions appear as small badges below the activity, helping voters make decisions without cluttering the vote UI.

---

## Part 4: Real-Time Presence System

### Presence Indicators

Inspired by [Figma's multiplayer cursors](https://www.figma.com/blog/multiplayer-editing-in-figma/):

```
PRESENCE FEATURES:

1. COLLABORATOR AVATARS (Top of screen)
   ┌──────────────────────────────────────┐
   │ Paris Trip 🇫🇷                        │
   │                                      │
   │ 👤 You  [🟢 Sarah] [🟡 Mike] [⚪ Alex] │
   │                                      │
   └──────────────────────────────────────┘

   🟢 = Online now
   🟡 = Active in last 5 min
   ⚪ = Offline

2. ACTIVITY FOCUS INDICATOR
   When someone is viewing/editing an activity:

   ┌─────────────────────────────────────────┐
   │ 🏛️ Louvre Museum                        │
   │ 👁️ Sarah is viewing                     │
   └─────────────────────────────────────────┘

3. TYPING INDICATOR (in comments)
   "Sarah is typing..."

4. LIVE CURSOR (Optional - Desktop only)
   └── Shows cursor position on map view
   └── Toggle in settings (can be distracting)
```

### Presence Data Structure

```typescript
interface UserPresence {
  odiserId: string;
  tripId: string;
  status: 'online' | 'away' | 'offline';
  currentView: 'itinerary' | 'map' | 'chat' | 'activity';
  focusedActivityId?: string;
  lastActiveAt: Date;
  deviceType: 'mobile' | 'desktop';
}
```

### Real-Time Activity Feed

```
ACTIVITY FEED (collapsible sidebar on desktop, sheet on mobile):

┌─────────────────────────────────────────┐
│ 🔔 Trip Updates                      ✕ │
├─────────────────────────────────────────┤
│ Just now                                │
│ 👍 Sarah voted YES on Louvre Museum    │
├─────────────────────────────────────────┤
│ 2 min ago                               │
│ ➕ Mike proposed "Seine River Cruise"   │
│    [View & Vote]                        │
├─────────────────────────────────────────┤
│ 15 min ago                              │
│ ✅ "Eiffel Tower" was confirmed (4/4)   │
├─────────────────────────────────────────┤
│ 1 hour ago                              │
│ 💬 Alex commented on "Latin Quarter"   │
│    "Can we do this after lunch?"        │
└─────────────────────────────────────────┘
```

---

## Part 5: Invite & Onboarding Flow

### Invite Generation

```
INVITE TYPES:

1. MAGIC LINK (Default)
   └── https://monkeytravel.app/join/abc123xyz
   └── Expires: 7 days
   └── Role: Voter (default)
   └── One-time use (optional)

2. QR CODE (For in-person)
   └── Display on phone, friend scans
   └── Same link encoded

3. EMAIL INVITE
   └── Sends formatted email with trip preview
   └── Deep link to join flow

4. SHARE VIA APPS
   └── WhatsApp, iMessage, etc.
   └── Rich preview with trip image
```

### Invited User Journey

Following the [Gradual Engagement pattern](https://www.nngroup.com/articles/gradual-engagement/) from the onboarding skill:

```
STEP 1: LANDING PAGE (Pre-auth)
┌─────────────────────────────────────────┐
│                                         │
│  Sarah invited you to                   │
│                                         │
│  ✈️ Paris Adventure                     │
│  Mar 15-22, 2025 • 4 travelers          │
│                                         │
│  [Preview Trip →]                       │
│                                         │
│  ─────────────────────────────          │
│  Already have an account? [Sign In]     │
│                                         │
└─────────────────────────────────────────┘

STEP 2: TRIP PREVIEW (Still pre-auth)
┌─────────────────────────────────────────┐
│ ← Back                                  │
│                                         │
│ 🇫🇷 Paris Adventure                     │
│ Mar 15-22, 2025                         │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Day 1: Arrival & Eiffel Tower       │ │
│ │ Day 2: Louvre & Latin Quarter       │ │
│ │ Day 3: Versailles Day Trip          │ │
│ │ ... (blurred/locked content)        │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 👥 Travelers: Sarah, Mike, Alex, +You?  │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 🎉 Join this trip to:               │ │
│ │ • Vote on activities                │ │
│ │ • Suggest new places                │ │
│ │ • Chat with the group               │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Join with Google]  [Join with Email]   │
│                                         │
└─────────────────────────────────────────┘

STEP 3: QUICK SIGNUP (Minimal friction)
┌─────────────────────────────────────────┐
│ Join Paris Adventure                    │
│                                         │
│ [🔵 Continue with Google]               │
│ [🍎 Continue with Apple]                │
│                                         │
│ ──── or ────                            │
│                                         │
│ Email: [                    ]           │
│                                         │
│ [Send Magic Link →]                     │
│                                         │
│ By joining, you agree to Terms & Privacy│
│                                         │
└─────────────────────────────────────────┘

STEP 4: ROLE CONFIRMATION (Post-auth)
┌─────────────────────────────────────────┐
│                                         │
│ 🎉 Welcome to Paris Adventure!          │
│                                         │
│ You've joined as: VOTER                 │
│                                         │
│ This means you can:                     │
│ ✓ Vote on proposed activities           │
│ ✓ Suggest new activities                │
│ ✓ Add comments and reactions            │
│ ✓ Chat with the group                   │
│                                         │
│ [Got it! Show me the trip →]            │
│                                         │
└─────────────────────────────────────────┘

STEP 5: FIRST ACTION PROMPT
┌─────────────────────────────────────────┐
│ 🏛️ Louvre Museum needs your vote!       │
│                                         │
│ Sarah proposed this activity.           │
│ 3/4 people have voted.                  │
│                                         │
│ What do you think?                      │
│                                         │
│ [👍 Love it] [👌 Flexible]              │
│ [🤔 Concerns] [👎 Not for me]           │
│                                         │
└─────────────────────────────────────────┘
```

### Conversion Optimization

Key metrics to track:
- **Invite → Preview**: Target 80%+ (low friction link)
- **Preview → Signup**: Target 60%+ (show trip value)
- **Signup → First Vote**: Target 90%+ (immediate action prompt)
- **First Vote → Engaged**: Target 70%+ (notification retention)

---

## Part 6: Conflict Resolution UX

### When Travelers Disagree

```
SCENARIO: 2 people want Louvre, 2 people want Musée d'Orsay

DETECTION:
├── Both activities proposed for same time slot
├── System detects: "These might conflict"
└── Triggers: Conflict Resolution Mode

CONFLICT UI:
┌─────────────────────────────────────────┐
│ ⚠️ Activity Conflict Detected           │
│                                         │
│ For: Day 2 Morning (10:00 - 12:00)      │
│                                         │
│ ┌─────────────┐  ┌─────────────┐        │
│ │🏛️ Louvre    │  │🎨 Musée     │        │
│ │             │  │   d'Orsay   │        │
│ │ 👍 2 votes  │  │ 👍 2 votes  │        │
│ │ Sarah, Mike │  │ Alex, You   │        │
│ └─────────────┘  └─────────────┘        │
│                                         │
│ How should we resolve this?             │
│                                         │
│ [🗳️ Keep Voting]                        │
│    More votes might break the tie       │
│                                         │
│ [✂️ Split the Group]                    │
│    Some go to Louvre, some to d'Orsay   │
│                                         │
│ [📅 Do Both]                            │
│    Louvre Day 2, d'Orsay Day 3          │
│                                         │
│ [💬 Discuss]                            │
│    Open a chat about this               │
│                                         │
│ [👑 Let Owner Decide]                   │
│    Sarah (owner) will choose            │
│                                         │
└─────────────────────────────────────────┘
```

### AI-Powered Compromise Suggestions

```
AI MEDIATOR (When deadlock persists):

"I noticed you're having trouble deciding between
Louvre and Musée d'Orsay. Here are some ideas:

💡 COMPROMISE 1: Visit both museums
   Louvre: Day 2 morning (Mona Lisa focus, 2h)
   d'Orsay: Day 3 afternoon (Impressionists, 2h)
   This adds 30 min walking between activities.

💡 COMPROMISE 2: Alternative that combines both interests
   'Art History Walking Tour' covers highlights
   from both museums in 3 hours.
   [View this activity]

💡 COMPROMISE 3: Split and reunite
   Half the group does Louvre, half does d'Orsay,
   meet for lunch at Café de Flore at 1pm.

Would you like me to propose one of these?"
```

### Voting Reminder System

To prevent deadlock from inactivity:

```
REMINDER SCHEDULE:

24h after proposal:
  └── Push: "🗳️ {ActivityName} needs your vote"
  └── In-app badge on trip

48h after proposal:
  └── Push: "⏰ Voting closes soon on {ActivityName}"
  └── Email summary of pending votes

72h after proposal (if not resolved):
  └── Auto-escalate to deadlock resolution
  └── Owner notified: "Help needed"
```

---

## Part 7: UI Component Specifications

### CollaboratorAvatars Component

```tsx
// Position: Fixed top-right in trip header
// Size: 32px circles, -8px overlap

interface CollaboratorAvatarsProps {
  collaborators: Collaborator[];
  maxVisible: number; // Default: 4
  onAvatarClick: (userId: string) => void;
  showPresence: boolean;
}

// Visual:
// [👤1][👤2][👤3][+2]
//  🟢   🟡   ⚪
```

### ActivityVoteCard Component

```tsx
// Extends existing EditableActivityCard
// Adds voting UI below activity content

interface ActivityVoteCardProps extends ActivityCardProps {
  status: ActivityStatus;
  votes: Vote[];
  totalVoters: number;
  currentUserVote?: VoteType;
  onVote: (voteType: VoteType, comment?: string) => void;
  onReact: (emoji: string) => void;
  reactions: Reaction[];
  proposedBy: User;
  proposedAt: Date;
}

// Visual treatment based on status:
// PROPOSED: dashed border, amber "Pending" badge
// VOTING: pulse animation, vote progress bar
// CONFIRMED: solid border, green checkmark
// REJECTED: red X, collapsed by default
```

### VoteButtons Component

```tsx
// Horizontal button group, full width on mobile
// Thumb-zone optimized (bottom of card)

interface VoteButtonsProps {
  currentVote?: VoteType;
  onVote: (type: VoteType) => void;
  disabled?: boolean;
  requiresComment?: VoteType[]; // ['concerns', 'no']
}

// Sizes:
// Mobile: 44px height (touch target minimum)
// Desktop: 36px height

// States:
// Default: ghost button with emoji + label
// Selected: filled background, checkmark
// Disabled: 50% opacity
```

### ConflictResolutionSheet Component

```tsx
// BottomSheet on mobile, Modal on desktop
// Triggered when time slot conflict detected

interface ConflictResolutionSheetProps {
  conflictingActivities: Activity[];
  timeSlot: TimeSlot;
  onResolve: (resolution: ResolutionType, data?: any) => void;
  aiSuggestions?: Suggestion[];
}

// ResolutionType:
// 'keep_voting' | 'split_group' | 'do_both' | 'discuss' | 'owner_decides'
```

### ActivityFeed Component

```tsx
// Collapsible sidebar on desktop
// BottomSheet on mobile (swipe up from bottom)

interface ActivityFeedProps {
  tripId: string;
  events: TripEvent[];
  onEventClick: (event: TripEvent) => void;
  unreadCount: number;
}

// Event types:
// vote_cast, activity_proposed, activity_confirmed,
// activity_rejected, comment_added, reaction_added,
// user_joined, user_left, conflict_detected
```

### InviteModal Component

```tsx
// Triggered from "Invite" button in trip header

interface InviteModalProps {
  tripId: string;
  tripName: string;
  onInvite: (method: InviteMethod, role: Role) => void;
}

// Sections:
// 1. Role selector (Voter/Editor/Viewer)
// 2. Invite method (Link, QR, Email, WhatsApp)
// 3. Link preview with copy button
// 4. Pending invites list
```

---

## Part 8: Database Schema

### New Tables

```sql
-- Collaborators on a trip
CREATE TABLE trip_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'voter', 'viewer')),
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ DEFAULT now(),
  joined_at TIMESTAMPTZ,
  vote_weight DECIMAL DEFAULT 1.0,
  is_active BOOLEAN DEFAULT true,
  last_seen_at TIMESTAMPTZ,

  UNIQUE(trip_id, user_id)
);

-- Invite links
CREATE TABLE trip_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'voter', 'viewer')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER DEFAULT 1,
  use_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

-- Activity votes
CREATE TABLE activity_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('love', 'flexible', 'concerns', 'no')),
  comment TEXT,
  voted_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(trip_id, activity_id, user_id)
);

-- Activity reactions (non-voting emoji)
CREATE TABLE activity_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(trip_id, activity_id, user_id, emoji)
);

-- Activity status tracking
CREATE TABLE activity_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'proposed', 'voting', 'confirmed', 'rejected',
    'deadlock', 'completed', 'skipped', 'replaced'
  )),
  proposed_by UUID REFERENCES auth.users(id),
  proposed_at TIMESTAMPTZ DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  confirmation_method TEXT, -- 'unanimous', 'majority', 'owner_override', 'auto'
  replaced_by TEXT, -- activity_id of replacement
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Activity comments/discussion
CREATE TABLE activity_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  is_deleted BOOLEAN DEFAULT false
);

-- Trip event log (for activity feed)
CREATE TABLE trip_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  activity_id TEXT,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User presence (for real-time indicators)
CREATE TABLE user_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'offline',
  current_view TEXT,
  focused_activity_id TEXT,
  last_active_at TIMESTAMPTZ DEFAULT now(),
  device_type TEXT
);

-- Indexes for performance
CREATE INDEX idx_trip_collaborators_trip ON trip_collaborators(trip_id);
CREATE INDEX idx_trip_collaborators_user ON trip_collaborators(user_id);
CREATE INDEX idx_activity_votes_trip ON activity_votes(trip_id);
CREATE INDEX idx_activity_votes_activity ON activity_votes(trip_id, activity_id);
CREATE INDEX idx_activity_status_trip ON activity_status(trip_id);
CREATE INDEX idx_trip_events_trip ON trip_events(trip_id);
CREATE INDEX idx_trip_events_created ON trip_events(created_at DESC);
```

### Modify Existing Tables

```sql
-- Add to trips table
ALTER TABLE trips ADD COLUMN collaboration_mode TEXT
  DEFAULT 'voting'
  CHECK (collaboration_mode IN ('solo', 'voting', 'free_edit'));

ALTER TABLE trips ADD COLUMN auto_confirm_hours INTEGER DEFAULT 48;
ALTER TABLE trips ADD COLUMN deadlock_hours INTEGER DEFAULT 72;

-- Add to users table (if not exists)
ALTER TABLE users ADD COLUMN notification_preferences JSONB DEFAULT '{
  "votes": true,
  "proposals": true,
  "confirmations": true,
  "comments": true,
  "reminders": true
}';
```

---

## Part 9: API Endpoints

### Collaborator Management

```
POST   /api/trips/[id]/collaborators
       Body: { userId, role }
       Response: { collaborator }

GET    /api/trips/[id]/collaborators
       Response: { collaborators: [...] }

PATCH  /api/trips/[id]/collaborators/[userId]
       Body: { role?, is_active? }
       Response: { collaborator }

DELETE /api/trips/[id]/collaborators/[userId]
       Response: { success: true }
```

### Invite Management

```
POST   /api/trips/[id]/invites
       Body: { role, expiresIn?, maxUses? }
       Response: { invite, link }

GET    /api/trips/[id]/invites
       Response: { invites: [...] }

DELETE /api/trips/[id]/invites/[inviteId]
       Response: { success: true }

GET    /api/invites/[token]
       Response: { invite, trip (preview) }

POST   /api/invites/[token]/accept
       Response: { trip, role }
```

### Voting

```
POST   /api/trips/[id]/activities/[activityId]/vote
       Body: { voteType, comment? }
       Response: { vote, consensusStatus }

GET    /api/trips/[id]/activities/[activityId]/votes
       Response: { votes: [...], consensus }

DELETE /api/trips/[id]/activities/[activityId]/vote
       Response: { success: true }
```

### Reactions

```
POST   /api/trips/[id]/activities/[activityId]/reactions
       Body: { emoji }
       Response: { reaction }

DELETE /api/trips/[id]/activities/[activityId]/reactions/[emoji]
       Response: { success: true }

GET    /api/trips/[id]/activities/[activityId]/reactions
       Response: { reactions: [...] }
```

### Activity Status

```
GET    /api/trips/[id]/activities/[activityId]/status
       Response: { status, votes, reactions, proposedBy }

PATCH  /api/trips/[id]/activities/[activityId]/status
       Body: { status } // For owner force-confirm
       Response: { status }
```

### Activity Feed

```
GET    /api/trips/[id]/events
       Query: { limit?, after?, types? }
       Response: { events: [...], hasMore }
```

### Presence

```
POST   /api/trips/[id]/presence
       Body: { status, currentView, focusedActivityId? }
       Response: { success: true }

GET    /api/trips/[id]/presence
       Response: { users: [...] }
```

---

## Part 10: Real-Time Implementation

### Supabase Realtime Subscriptions

```typescript
// Subscribe to trip changes
const tripChannel = supabase
  .channel(`trip:${tripId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'activity_votes',
    filter: `trip_id=eq.${tripId}`
  }, (payload) => {
    handleVoteChange(payload);
  })
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'activity_status',
    filter: `trip_id=eq.${tripId}`
  }, (payload) => {
    handleStatusChange(payload);
  })
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'trip_events',
    filter: `trip_id=eq.${tripId}`
  }, (payload) => {
    handleNewEvent(payload);
  })
  .on('presence', { event: 'sync' }, () => {
    handlePresenceSync();
  })
  .subscribe();

// Broadcast presence
await tripChannel.track({
  odiserId: user.id,
  status: 'online',
  currentView: 'itinerary',
  focusedActivityId: selectedActivity?.id
});
```

### Optimistic Updates

```typescript
// Vote with optimistic update
async function castVote(activityId: string, voteType: VoteType) {
  // 1. Optimistically update UI
  setVotes(prev => ({
    ...prev,
    [activityId]: { ...prev[activityId], [userId]: voteType }
  }));

  // 2. Send to server
  try {
    await api.post(`/trips/${tripId}/activities/${activityId}/vote`, {
      voteType
    });
  } catch (error) {
    // 3. Revert on error
    setVotes(prev => {
      const updated = { ...prev };
      delete updated[activityId][userId];
      return updated;
    });
    toast.error('Failed to cast vote');
  }
}
```

---

## Part 11: Notification Strategy

### Notification Types & Channels

| Event | In-App | Push | Email |
|-------|--------|------|-------|
| New activity proposed | ✅ | ✅ | ❌ |
| Vote needed (24h reminder) | ✅ | ✅ | ✅ |
| Activity confirmed | ✅ | ✅ | ❌ |
| Activity rejected | ✅ | ✅ | ❌ |
| Deadlock detected | ✅ | ✅ | ✅ |
| New comment on your proposal | ✅ | ✅ | ❌ |
| Someone joined trip | ✅ | ❌ | ❌ |
| Trip starts tomorrow | ✅ | ✅ | ✅ |

### Notification Templates

```typescript
const NOTIFICATION_TEMPLATES = {
  vote_needed: {
    title: '🗳️ Vote needed on {activityName}',
    body: '{proposerName} proposed this activity. {votedCount}/{totalVoters} have voted.',
    action: { type: 'open_activity', activityId: '{activityId}' }
  },
  activity_confirmed: {
    title: '✅ {activityName} confirmed!',
    body: 'The group approved this activity for {dayDate}.',
    action: { type: 'open_trip', tripId: '{tripId}' }
  },
  deadlock: {
    title: '⚠️ Help needed on {tripName}',
    body: 'The group can\'t agree on {activityName}. Can you help resolve?',
    action: { type: 'open_conflict', activityId: '{activityId}' }
  }
};
```

---

## Part 12: Implementation Phases

### Phase 1: Foundation (Week 1)

```
DATABASE & API:
├── Create all new tables (migration)
├── Add RLS policies for all tables
├── Build collaborator CRUD endpoints
├── Build invite endpoints
└── Test with Postman/curl

UI BASICS:
├── CollaboratorAvatars component
├── InviteModal component
├── Update TripDetailClient to show collaborators
└── Invite link generation and sharing
```

### Phase 2: Voting System (Week 2)

```
VOTING CORE:
├── Build activity_votes endpoints
├── Build activity_status endpoints
├── Implement consensus calculation
├── Create VoteButtons component
├── Create ActivityVoteCard component
└── Add voting UI to EditableActivityCard

VISUAL POLISH:
├── Status badges (Pending, Voting, Confirmed, etc.)
├── Vote progress bar
├── Vote result display
└── Transition animations between states
```

### Phase 3: Real-Time (Week 3)

```
SUPABASE REALTIME:
├── Set up realtime subscriptions
├── Implement presence tracking
├── Build ActivityFeed component
├── Add optimistic updates for votes
└── Handle connection drops gracefully

PRESENCE UI:
├── Online/offline indicators on avatars
├── "X is viewing this activity" indicator
├── Typing indicators in comments
└── Activity feed sidebar/sheet
```

### Phase 4: Conflict Resolution (Week 4)

```
CONFLICT DETECTION:
├── Time slot conflict detection
├── ConflictResolutionSheet component
├── AI compromise suggestions
├── Owner override functionality
└── Deadlock escalation logic

POLISH & EDGE CASES:
├── Notification system integration
├── Email reminders for pending votes
├── Offline support and sync
├── Error handling and recovery
└── Comprehensive testing
```

---

## Part 13: Success Metrics

### Launch Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Invite → Join rate | > 50% | `accepted_invites / sent_invites` |
| First vote within 24h | > 70% | `votes_in_24h / new_collaborators` |
| Trips with 2+ collaborators | > 30% | `multi_user_trips / total_trips` |
| Deadlock rate | < 10% | `deadlocks / total_proposed` |
| Average votes per user | > 5 | `total_votes / active_voters` |

### Growth Metrics

| Metric | Current | Target (3mo) | Target (6mo) |
|--------|---------|--------------|--------------|
| K-Factor | 0.4 | 0.8 | 1.2+ |
| Invites per trip | 0 | 2.5 | 3.5 |
| Collaboration retention | N/A | 60% D7 | 70% D7 |

---

## Appendix A: Competitive Differentiation

| Feature | MonkeyTravel | Wanderlog | TripIt | SquadTrip |
|---------|--------------|-----------|--------|-----------|
| AI Itinerary Generation | ✅ | ❌ | ❌ | ❌ |
| Real-time Collaboration | ✅ | Basic | ❌ | ❌ |
| Voting/Consensus | ✅ | ❌ | ❌ | ❌ |
| Conflict Resolution | ✅ | ❌ | ❌ | ❌ |
| Presence Indicators | ✅ | ❌ | ❌ | ❌ |
| Activity Reactions | ✅ | ❌ | ❌ | ❌ |
| Email Import | Future | ❌ | ✅ | ❌ |
| Booking Integration | ✅ (Amadeus) | Affiliate | ✅ | Affiliate |

---

## Appendix B: Accessibility Considerations

- All vote buttons meet WCAG 2.1 AA contrast requirements
- Keyboard navigation for all voting actions
- Screen reader announcements for status changes
- Reduced motion option disables animations
- Color-blind friendly status indicators (not just color, also icons)

---

## Appendix C: Privacy & Security

- Invites use secure, unguessable tokens (UUID v4)
- Presence data auto-expires after 5 minutes of inactivity
- Users can disable presence tracking in settings
- Vote privacy option: show only counts, not who voted
- GDPR: users can export/delete all their trip contributions

---

*Document created with research from [Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [Nielsen Norman Group](https://www.nngroup.com/articles/dot-voting/), [Loomio](https://www.loomio.com/), and competitive analysis of [SquadTrip](https://squadtrip.com/), [Wanderlog](https://apps.apple.com/us/app/wanderlog-travel-planner/id1476732439), and [Frienzy](https://apps.apple.com/us/app/frienzy-group-travel-planner/id6446246578).*
