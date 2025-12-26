# Referral & Bananas System - Ultra Plan

## Executive Summary

Design a viral referral loop where users unlock benefits at **3, 6, and 10 successful referrals** while earning **Bananas** currency. This builds on the existing referral infrastructure and gamification system.

**Goal:** Increase viral coefficient (K-factor) from estimated 0.2 → 0.6+

### Key Decisions (Confirmed)

| Decision | Choice | Notes |
|----------|--------|-------|
| Banana expiration | 12 months | Badges remain permanent |
| Leaderboard | Yes, anonymized | No sensitive info exposed |
| Collaborators as referrals | Yes | Trip invite → signup counts |
| Partner discounts | Infrastructure only | No actual discounts yet |

---

## Current State Analysis

### What Already Exists

| Component | Status | Location |
|-----------|--------|----------|
| Referral codes table | ✅ Exists | `referral_codes` |
| Referral events tracking | ✅ Exists | `referral_events` |
| Click/signup/conversion flow | ✅ Exists | `/api/referral/*` |
| Free trips reward (1 per conversion) | ✅ Exists | `users.free_trips_remaining` |
| XP & Achievement system | ✅ Exists | `types/timeline.ts` |
| Usage limits (3 AI gen/month) | ✅ Exists | `lib/usage-limits/` |
| Tier system (free/premium) | ✅ Exists | `subscription_tier` column |

### What Needs Building

| Component | Priority | Effort |
|-----------|----------|--------|
| Bananas currency system | P0 | Medium |
| Referral tier rewards (3/6/10) | P0 | Medium |
| Referral dashboard UI | P0 | Medium |
| Anti-fraud measures | P1 | Low |
| Celebration animations | P2 | Low |
| Leaderboard (optional) | P3 | Low |

---

## Bananas Currency Design

### Why "Bananas"?

1. **Brand alignment** - MonkeyTravel = monkeys = bananas
2. **Playful & memorable** - Differentiates from generic "credits" or "points"
3. **Psychological pricing** - 100 bananas feels more rewarding than $1

### Currency Economics

```
1 Banana = $0.10 USD value (internal)
```

| Earning Method | Bananas | Rationale |
|----------------|---------|-----------|
| Successful referral | 50 🍌 | Core viral incentive |
| Tier 1 bonus (3 refs) | 100 🍌 | Milestone reward |
| Tier 2 bonus (6 refs) | 200 🍌 | Increasing value |
| Tier 3 bonus (10 refs) | 500 🍌 | Major achievement |
| Complete trip | 10 🍌 | Engagement reward |
| First trip | 25 🍌 | Activation bonus |
| Leave review | 5 🍌 | Content generation |

### Spending Options

| Item | Cost | Value |
|------|------|-------|
| 1 Extra AI Generation | 30 🍌 | $3 equivalent |
| Premium Template Pack | 100 🍌 | $10 equivalent |
| 1 Month Premium Trial | 300 🍌 | $30 equivalent |
| Priority AI (faster) | 20 🍌/trip | $2 equivalent |
| Custom Trip Export | 50 🍌 | $5 equivalent |

---

## Referral Tier System

### Tier Benefits Matrix

| Benefit | Base | Tier 1 (3 refs) | Tier 2 (6 refs) | Tier 3 (10 refs) |
|---------|------|-----------------|-----------------|------------------|
| **AI Generations/month** | 3 | 5 (+2) | 8 (+5) | 15 (+12) |
| **AI Regenerations/month** | 10 | 15 (+5) | 25 (+15) | Unlimited |
| **Bananas per referral** | 50 | 60 (+20%) | 75 (+50%) | 100 (+100%) |
| **Exclusive badge** | - | 🌟 Explorer | 🔥 Ambassador | 👑 Champion |
| **Tier bonus (one-time)** | - | 100 🍌 | 200 🍌 | 500 🍌 |
| **Premium templates** | 0 | 3 | 10 | All |
| **Priority support** | ❌ | ❌ | ✅ | ✅ |
| **Early access features** | ❌ | ❌ | ❌ | ✅ |

### Why These Tiers Work

1. **Tier 1 (3 referrals)** - Achievable "first win"
   - 67% increase in AI generations (3→5)
   - Low barrier builds momentum
   - Target: 30% of referring users reach this

2. **Tier 2 (6 referrals)** - Committed advocates
   - 167% increase in AI generations (3→8)
   - Premium template access creates stickiness
   - Target: 10% of referring users reach this

3. **Tier 3 (10 referrals)** - Power users / influencers
   - Near-unlimited usage
   - Champion badge = social status
   - Early access creates loyalty
   - Target: 3% of referring users reach this

---

## Viral Loop Optimization

### K-Factor Calculation

```
K = (invites sent per user) × (conversion rate)

Current estimate:
- Avg invites sent: 2
- Conversion rate: 10%
- K = 2 × 0.10 = 0.2

Target with new system:
- Avg invites sent: 5 (better incentives)
- Conversion rate: 15% (better referee reward)
- K = 5 × 0.15 = 0.75
```

### Referee (Invited User) Incentives

**Current:** 1 free trip on first trip creation

**Proposed:**
```
Sign up with referral → Get 50 🍌 immediately
Create first trip → Get 25 🍌 + 1 free trip
Total: 75 🍌 + 1 free trip ($12.50 value)
```

### Share Moments (When to Prompt)

| Moment | Prompt | Conversion Est. |
|--------|--------|-----------------|
| After trip creation | "Share your trip with friends!" | 15% |
| After completing trip | "Loved your trip? Invite friends!" | 25% |
| Tier unlock | "You unlocked X! Share the love" | 30% |
| Weekly digest email | "Earn bananas by inviting friends" | 5% |
| Profile/settings | Persistent referral section | 10% |

---

## Anti-Fraud Measures

### Detection Rules

| Rule | Implementation | Action |
|------|----------------|--------|
| Same IP signup | Hash + check last 24h | Flag, delay reward |
| Same device | Device fingerprint | Block referral credit |
| Email pattern | Regex detection (+1, temp domains) | Block signup |
| Velocity limit | Max 5 conversions/day | Delay excess |
| Engagement check | Referee must create trip | Required for conversion |
| Account age | Referrer must be 24h+ old | Prevent abuse |

### Fraud Score System

```typescript
interface FraudCheck {
  score: number; // 0-100 (higher = more suspicious)
  factors: {
    sameIp: boolean;        // +30 points
    similarEmail: boolean;  // +20 points
    newAccount: boolean;    // +15 points
    noEngagement: boolean;  // +25 points
    vpnDetected: boolean;   // +10 points
  };
}

// Block if score > 50
// Manual review if score > 30
// Auto-approve if score < 30
```

### Clawback Policy

- If referee deletes account within 7 days → Reverse rewards
- If fraud detected post-reward → Deduct bananas, adjust tier
- Negative banana balance possible (prevents gaming then cashing out)

---

## Database Schema Changes

### New Tables

```sql
-- Bananas currency ledger
CREATE TABLE banana_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- Positive = earn, Negative = spend
  balance_after INTEGER NOT NULL,
  transaction_type TEXT NOT NULL, -- 'referral', 'tier_bonus', 'trip_complete', 'spend', 'clawback'
  reference_id UUID, -- Links to referral_event, trip, etc.
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_transaction_type CHECK (
    transaction_type IN ('referral', 'tier_bonus', 'trip_complete', 'review', 'signup_bonus', 'spend', 'clawback', 'admin')
  )
);

CREATE INDEX idx_banana_transactions_user ON banana_transactions(user_id);
CREATE INDEX idx_banana_transactions_created ON banana_transactions(created_at);

-- Referral tier tracking
CREATE TABLE referral_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  current_tier INTEGER DEFAULT 0, -- 0, 1, 2, 3
  tier_1_unlocked_at TIMESTAMPTZ,
  tier_2_unlocked_at TIMESTAMPTZ,
  tier_3_unlocked_at TIMESTAMPTZ,
  lifetime_conversions INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_referral_tiers_user ON referral_tiers(user_id);
```

### Schema Modifications

```sql
-- Add banana balance to users table
ALTER TABLE users ADD COLUMN banana_balance INTEGER DEFAULT 0;

-- Add fraud score to referral_events
ALTER TABLE referral_events ADD COLUMN fraud_score INTEGER DEFAULT 0;
ALTER TABLE referral_events ADD COLUMN fraud_factors JSONB DEFAULT '{}';
ALTER TABLE referral_events ADD COLUMN reward_status TEXT DEFAULT 'pending';
-- reward_status: 'pending', 'approved', 'blocked', 'clawback'

-- Add tier-based limit overrides
ALTER TABLE users ADD COLUMN referral_tier INTEGER DEFAULT 0;
```

---

## API Endpoints

### New Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/bananas` | Get balance & transaction history |
| POST | `/api/bananas/spend` | Spend bananas on items |
| GET | `/api/referral/tier` | Get tier status & progress |
| GET | `/api/referral/dashboard` | Full referral dashboard data |
| POST | `/api/referral/share` | Track share actions |

### Modified Endpoints

| Endpoint | Changes |
|----------|---------|
| `/api/referral/complete` | Add banana rewards, tier checks, fraud scoring |
| `/api/ai/generate` | Check referral tier for limit overrides |

---

## UI Components

### Referral Dashboard (Mobile-First)

```
┌─────────────────────────────────────┐
│  🍌 Your Bananas                    │
│  ┌─────────────────────────────┐   │
│  │     🍌 425                  │   │
│  │   Available Balance         │   │
│  └─────────────────────────────┘   │
│                                     │
│  📊 Referral Progress               │
│  ┌─────────────────────────────┐   │
│  │ ●───●───●───○───○───○───○   │   │
│  │ 0   1   2   3   4   5   6   │   │
│  │         ↑                   │   │
│  │    You are here             │   │
│  │                             │   │
│  │ 🔓 Tier 1: 1 more referral! │   │
│  └─────────────────────────────┘   │
│                                     │
│  🎁 Your Rewards                    │
│  ┌─────────────────────────────┐   │
│  │ ✅ 50 🍌 per referral       │   │
│  │ 🔒 +2 AI generations (Tier 1)│   │
│  │ 🔒 🌟 Explorer badge (Tier 1)│   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  📤 Share Your Link         │   │
│  │  monkeytravel.app/r/ABC123  │   │
│  │                             │   │
│  │  [Copy] [WhatsApp] [More]   │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Tier Progress Card

```
┌─────────────────────────────────────┐
│  🏆 Referral Champion Path          │
│                                     │
│  Tier 1 🌟          Tier 2 🔥      │
│  3 referrals        6 referrals     │
│  ┌──────┐          ┌──────┐        │
│  │ 2/3  │──────────│ 0/6  │        │
│  │ ▓▓░░ │          │ ░░░░ │        │
│  └──────┘          └──────┘        │
│       │                  │          │
│       │                  │          │
│       ▼                  ▼          │
│  +2 AI gens         +5 AI gens     │
│  +100 🍌            +200 🍌        │
│  Explorer badge     10 templates    │
│                                     │
│            Tier 3 👑               │
│           10 referrals              │
│           ┌──────┐                 │
│           │ 0/10 │                 │
│           │ ░░░░ │                 │
│           └──────┘                 │
│                │                    │
│                ▼                    │
│         Unlimited AI                │
│         +500 🍌                    │
│         Champion badge              │
│         Early access                │
└─────────────────────────────────────┘
```

### Celebration Moments

**Tier Unlock Animation:**
```
1. Confetti explosion (2s)
2. Badge reveal with glow effect
3. Banana rain animation
4. "+100 🍌" floating text
5. Share prompt with pre-filled message
```

**Share Success:**
```
1. Checkmark animation
2. "Link copied!" toast
3. Subtle banana +1 animation
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create `banana_transactions` table
- [ ] Create `referral_tiers` table
- [ ] Add `banana_balance` to users
- [ ] Create `/api/bananas` endpoint
- [ ] Modify `/api/referral/complete` for bananas

### Phase 2: Tier System (Week 2)
- [ ] Implement tier calculation logic
- [ ] Modify usage limits to respect tiers
- [ ] Create `/api/referral/tier` endpoint
- [ ] Add tier upgrade notifications

### Phase 3: Dashboard UI (Week 3)
- [ ] Create ReferralDashboard component
- [ ] Create BananaBalance component
- [ ] Create TierProgress component
- [ ] Add to profile page
- [ ] Create share modal with multiple options

### Phase 4: Polish & Anti-Fraud (Week 4)
- [ ] Implement fraud scoring
- [ ] Add celebration animations
- [ ] Create banana spending UI
- [ ] Add referral analytics to admin
- [ ] Test edge cases

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Referral rate | ~5% | 25% | Users who share / Total users |
| K-factor | ~0.2 | 0.6 | Invites × Conversion rate |
| Tier 1 reach | N/A | 30% | Users at Tier 1+ / Users who refer |
| Avg invites/user | ~2 | 5 | Total invites / Referring users |
| Invite conversion | ~10% | 15% | Signups / Invites sent |
| Banana engagement | N/A | 40% | Users who spend / Users with balance |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Fraud/gaming | Medium | High | Fraud scoring + clawback |
| Reward inflation | Low | Medium | Controlled earning rates |
| User confusion | Low | Low | Clear UI + onboarding |
| Tier grinding burnout | Medium | Medium | Diminishing returns built in |
| Cannibalizing paid tiers | Low | High | Premium still has unique value |

---

## Cost Analysis

### Per 1000 New Users (via referral)

| Item | Cost |
|------|------|
| Referee signup bonus (50 🍌) | $5,000 |
| Referee trip bonus (25 🍌) | $2,500 |
| Referrer rewards (50 🍌 × 1000) | $5,000 |
| Tier bonuses (estimated) | $2,000 |
| **Total banana liability** | **$14,500** |
| **Actual cost (redemption ~40%)** | **~$5,800** |
| **Cost per acquired user** | **~$5.80** |

**Comparison:** Paid acquisition typically $15-30/user for travel apps.

**ROI:** If 10% of referred users convert to premium ($10/mo), break-even in 6 months.

---

---

## Banana Expiration System (12 Months)

### Design Principles

1. **FIFO (First In, First Out)** - Oldest bananas expire first
2. **Badges are permanent** - Tier badges never expire
3. **Grace notifications** - Warn users before expiration
4. **Activity resets clock** - Any earning activity refreshes oldest bananas

### Expiration Logic

```typescript
interface BananaTransaction {
  id: string;
  user_id: string;
  amount: number;           // Positive = earn, Negative = spend
  balance_after: number;
  transaction_type: string;
  expires_at: Date | null;  // NULL for spending transactions
  expired: boolean;         // Soft delete flag
  created_at: Date;
}

// Expiration calculation
const EXPIRATION_MONTHS = 12;

function calculateExpiration(earnedAt: Date): Date {
  const expires = new Date(earnedAt);
  expires.setMonth(expires.getMonth() + EXPIRATION_MONTHS);
  return expires;
}

// Available balance = earned (not expired) - spent
function getAvailableBalance(transactions: BananaTransaction[]): number {
  const earned = transactions
    .filter(t => t.amount > 0 && !t.expired && new Date(t.expires_at) > new Date())
    .reduce((sum, t) => sum + t.amount, 0);

  const spent = transactions
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  return earned - spent;
}
```

### Spending with FIFO

When user spends bananas, consume from oldest non-expired batches first:

```typescript
async function spendBananas(userId: string, amount: number): Promise<boolean> {
  // Get all non-expired earning transactions ordered by expiration
  const { data: earnedBatches } = await supabase
    .from('banana_transactions')
    .select('id, amount, expires_at')
    .eq('user_id', userId)
    .eq('expired', false)
    .gt('amount', 0)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true }); // FIFO: oldest first

  // Calculate available in each batch after prior spending
  // ... deduct from oldest batches first
}
```

### Expiration Cron Job

Run daily at 00:00 UTC:

```sql
-- Mark expired transactions
UPDATE banana_transactions
SET expired = true
WHERE expires_at < NOW()
  AND expired = false
  AND amount > 0;

-- Recalculate user balances
UPDATE users u
SET banana_balance = COALESCE((
  SELECT SUM(CASE WHEN bt.amount > 0 AND NOT bt.expired THEN bt.amount ELSE bt.amount END)
  FROM banana_transactions bt
  WHERE bt.user_id = u.id
    AND (bt.amount < 0 OR (bt.expires_at > NOW() AND NOT bt.expired))
), 0);
```

### Expiration Notifications

| Trigger | Channel | Message |
|---------|---------|---------|
| 30 days before | In-app + Email | "🍌 Heads up! 50 bananas expire in 30 days" |
| 7 days before | In-app + Push | "🍌 Use your bananas! 50 expire in 7 days" |
| Day of expiration | In-app | "🍌 50 bananas expired today" |

### UI Display

```tsx
// BananaBalance component
<div className="banana-balance">
  <div className="total">🍌 425</div>
  <div className="expiring-soon text-amber-500">
    ⚠️ 50 expire in 12 days
  </div>
</div>
```

---

## Leaderboard System (Privacy-First)

### Design Principles

1. **No sensitive data** - No emails, full names, or locations
2. **Opt-in display names** - Users choose what to show
3. **Anonymization option** - Can appear as "Traveler #1234"
4. **Tier badges visible** - Show achievement status
5. **Monthly + All-time** - Two time periods

### Leaderboard Entry Structure

```typescript
interface LeaderboardEntry {
  rank: number;
  displayName: string;      // "John D." or "Anonymous Traveler"
  avatarUrl: string | null; // Null = show default avatar
  badge: 'explorer' | 'ambassador' | 'champion' | null;
  referralCount: number;
  isCurrentUser: boolean;   // Highlight user's own row
}
```

### Display Name Rules

```typescript
function getLeaderboardDisplayName(user: User): string {
  // Check user's privacy preference
  if (user.leaderboard_visibility === 'anonymous') {
    return `Traveler #${user.id.substring(0, 4).toUpperCase()}`;
  }

  if (user.leaderboard_visibility === 'initials') {
    const name = user.display_name || '';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0]} ${parts[1][0]}.`; // "John D."
    }
    return `${name.substring(0, 1)}***`; // "J***"
  }

  // 'full' - show display_name
  return user.display_name || 'Traveler';
}
```

### User Privacy Settings

```typescript
interface LeaderboardPreferences {
  leaderboard_visibility: 'full' | 'initials' | 'anonymous';
  show_on_leaderboard: boolean; // Opt-out entirely
}
```

### API Endpoint

```typescript
// GET /api/referral/leaderboard?period=monthly|alltime&limit=20
interface LeaderboardResponse {
  period: 'monthly' | 'alltime';
  entries: LeaderboardEntry[];
  userRank: number | null;  // Current user's rank (even if not in top N)
  totalParticipants: number;
}
```

### SQL Query

```sql
SELECT
  RANK() OVER (ORDER BY rc.total_conversions DESC) as rank,
  CASE
    WHEN u.leaderboard_visibility = 'anonymous'
      THEN 'Traveler #' || UPPER(LEFT(u.id::text, 4))
    WHEN u.leaderboard_visibility = 'initials'
      THEN SPLIT_PART(u.display_name, ' ', 1) || ' ' || LEFT(SPLIT_PART(u.display_name, ' ', 2), 1) || '.'
    ELSE COALESCE(u.display_name, 'Traveler')
  END as display_name,
  CASE WHEN u.leaderboard_visibility != 'anonymous' THEN u.avatar_url END as avatar_url,
  rt.current_tier as badge_tier,
  rc.total_conversions as referral_count
FROM referral_codes rc
JOIN users u ON u.id = rc.user_id
LEFT JOIN referral_tiers rt ON rt.user_id = rc.user_id
WHERE u.show_on_leaderboard = true
  AND rc.total_conversions > 0
ORDER BY rc.total_conversions DESC
LIMIT 20;
```

### Leaderboard UI

```
┌─────────────────────────────────────┐
│  🏆 Top Referrers                   │
│  [Monthly ▼]                        │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 1. 👑 John D.         28 🎫 │   │
│  │ 2. 🔥 Maria S.        24 🎫 │   │
│  │ 3. 🔥 Traveler #A7F2  19 🎫 │   │
│  │ 4. 🌟 Alex T.         15 🎫 │   │
│  │ 5. 🌟 Anonymous       12 🎫 │   │
│  │ ...                          │   │
│  │ 47. ── You ──          3 🎫 │   │
│  └─────────────────────────────┘   │
│                                     │
│  Invite friends to climb up! 🚀    │
│  [Share Your Link]                  │
└─────────────────────────────────────┘
```

---

## Collaborators as Referrals

### How It Works

When a user invites someone to collaborate on a trip, and that person:
1. **Signs up** (new account) to accept the invite
2. **Creates their first trip** (activation)

→ The inviter gets referral credit (bananas + tier progress)

### Integration Points

**Current Flow (trip_invites):**
```
Trip Owner creates invite → Generates token → Shares link
                                    ↓
New user clicks link → Signs up → Accepts invite → Joins as collaborator
```

**Enhanced Flow:**
```
Trip Owner creates invite → Generates token → Shares link
                                    ↓
New user clicks link → Signs up (track invited_by) → Accepts invite → Joins
                                    ↓
New user creates first trip → Trigger referral completion
```

### Schema Changes

```sql
-- Add referral tracking to trip_invites
ALTER TABLE trip_invites
ADD COLUMN is_referral_eligible BOOLEAN DEFAULT true;

-- Track which invite caused signup (for attribution)
ALTER TABLE users
ADD COLUMN signed_up_via_trip_invite UUID REFERENCES trip_invites(id);
```

### Modified Invite Accept Flow

```typescript
// In POST /api/invites/[token] (invite acceptance)

// After adding collaborator, check if this is a new signup that should count as referral
async function checkCollaboratorReferral(
  userId: string,
  invite: TripInvite,
  userCreatedAt: Date
): Promise<void> {
  // Only count if:
  // 1. User signed up recently (within 24h of invite acceptance)
  // 2. User doesn't already have a referral code attached
  // 3. Invite creator is different from the new user

  const hoursSinceSignup = (Date.now() - userCreatedAt.getTime()) / (1000 * 60 * 60);

  if (hoursSinceSignup > 24) return; // Not a new signup

  const { data: user } = await supabase
    .from('users')
    .select('referred_by_code, referral_completed_at')
    .eq('id', userId)
    .single();

  if (user?.referred_by_code) return; // Already has referral attribution

  // Get inviter's referral code
  const { data: inviterCode } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('user_id', invite.created_by)
    .single();

  if (!inviterCode) return;

  // Attribute this user to the inviter's referral code
  await supabase
    .from('users')
    .update({
      referred_by_code: inviterCode.code,
      signed_up_via_trip_invite: invite.id
    })
    .eq('id', userId);

  // Record signup event
  await supabase
    .from('referral_events')
    .insert({
      referral_code_id: inviterCode.id,
      referee_id: userId,
      event_type: 'signup',
      metadata: { source: 'trip_invite', trip_id: invite.trip_id }
    });
}
```

### Conversion Trigger

The existing `/api/referral/complete` endpoint (called when user creates first trip) handles the rest - it checks for `referred_by_code` and grants rewards.

### Deduplication

A user can only be counted as ONE referral, even if they:
- Click multiple referral links
- Accept multiple trip invites
- Use both referral link AND trip invite

**Priority:** First attribution wins (stored in `referred_by_code`)

---

## Future Discount Infrastructure

### Design Principles

1. **Build the plumbing now** - Tables, types, API structure
2. **No actual discounts yet** - Partners not onboarded
3. **"Coming Soon" UI** - Tease future value
4. **Extensible schema** - Easy to add partner types later

### Redemption Options Schema

```sql
-- Future: Catalog of things users can spend bananas on
CREATE TABLE banana_redemption_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Display
  name TEXT NOT NULL,                    -- "1 Extra AI Generation"
  description TEXT,                       -- "Generate one additional trip"
  icon_url TEXT,                          -- Emoji or image
  category TEXT NOT NULL,                 -- 'feature' | 'partner' | 'subscription'

  -- Pricing
  banana_cost INTEGER NOT NULL,           -- 30 bananas

  -- Availability
  is_active BOOLEAN DEFAULT true,
  available_from TIMESTAMPTZ,
  available_until TIMESTAMPTZ,
  stock_limit INTEGER,                    -- NULL = unlimited
  stock_used INTEGER DEFAULT 0,

  -- Redemption rules
  per_user_limit INTEGER,                 -- NULL = unlimited
  cooldown_hours INTEGER,                 -- Hours between redemptions

  -- For partner discounts (future)
  partner_id UUID,                        -- References future partners table
  partner_config JSONB,                   -- Partner-specific data
  discount_type TEXT,                     -- 'percentage' | 'fixed' | 'upgrade'
  discount_value DECIMAL,                 -- 10 (for 10% or $10)

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track redemptions
CREATE TABLE banana_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL REFERENCES banana_redemption_catalog(id),
  bananas_spent INTEGER NOT NULL,

  -- Status tracking
  status TEXT DEFAULT 'pending', -- 'pending' | 'fulfilled' | 'expired' | 'refunded'
  fulfilled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,        -- For time-limited rewards

  -- For partner integrations (future)
  partner_reference TEXT,        -- External booking ID, voucher code, etc.
  partner_response JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_redemptions_user ON banana_redemptions(user_id);
CREATE INDEX idx_redemptions_status ON banana_redemptions(status);
```

### Initial Catalog Items (Active Now)

```sql
INSERT INTO banana_redemption_catalog (name, description, icon_url, category, banana_cost, is_active) VALUES
('Extra AI Generation', 'Generate one additional trip itinerary', '✨', 'feature', 30, true),
('Priority AI Queue', 'Skip the queue for faster generation', '⚡', 'feature', 20, true),
('Premium Template Pack', 'Access to 10 curated trip templates', '📦', 'feature', 100, true),
('1 Month Premium Trial', 'Try all premium features for 30 days', '👑', 'subscription', 300, true);
```

### Future Catalog Items (Coming Soon - Inactive)

```sql
INSERT INTO banana_redemption_catalog (name, description, icon_url, category, banana_cost, is_active, partner_id) VALUES
('Hotel Discount 10%', 'Save 10% on your next hotel booking', '🏨', 'partner', 200, false, NULL),
('Free Airport Lounge', 'One-time lounge access at partner airports', '✈️', 'partner', 150, false, NULL),
('Travel Insurance Upgrade', 'Free upgrade to premium coverage', '🛡️', 'partner', 250, false, NULL),
('Local Experience Credit', '$20 off tours and activities', '🎭', 'partner', 180, false, NULL);
```

### API Structure

```typescript
// GET /api/bananas/catalog
interface CatalogResponse {
  available: RedemptionItem[];    // Active, in stock
  comingSoon: RedemptionItem[];   // Inactive, teaser
  userRedemptions: UserRedemption[]; // User's past redemptions
}

// POST /api/bananas/redeem
interface RedeemRequest {
  catalogItemId: string;
}

interface RedeemResponse {
  success: boolean;
  redemption?: {
    id: string;
    status: 'fulfilled' | 'pending';
    expiresAt?: string;
    instructions?: string;  // "Your extra generation is ready!"
  };
  newBalance: number;
  error?: string;
}
```

### "Coming Soon" UI Component

```tsx
function ComingSoonRewards() {
  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        🔮 Coming Soon
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
          Partner Perks
        </span>
      </h3>

      <div className="mt-4 grid gap-3 opacity-60">
        {comingSoonItems.map(item => (
          <div
            key={item.id}
            className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{item.icon}</span>
              <div>
                <div className="font-medium">{item.name}</div>
                <div className="text-sm text-slate-500">{item.description}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-slate-400">{item.bananaCost} 🍌</div>
              <div className="text-xs text-amber-600">Coming Q2 2025</div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-sm text-slate-500 text-center">
        💡 Start earning bananas now to unlock these perks when they launch!
      </p>
    </div>
  );
}
```

### Partner Integration Prep (Future)

```typescript
// Future: Partner webhook for redemption fulfillment
interface PartnerWebhook {
  type: 'redemption_request';
  redemptionId: string;
  userId: string;
  userEmail: string;
  catalogItem: {
    id: string;
    name: string;
    discountType: string;
    discountValue: number;
  };
  metadata: Record<string, unknown>;
}

// Partner responds with:
interface PartnerFulfillment {
  success: boolean;
  voucherCode?: string;
  expiresAt?: string;
  redemptionUrl?: string;
  error?: string;
}
```

---

## Updated Database Schema

### Complete Migration

```sql
-- =====================================================
-- Migration: Referral Bananas System
-- =====================================================

-- 1. Add banana balance and preferences to users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS banana_balance INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS referral_tier INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS leaderboard_visibility TEXT DEFAULT 'initials'
  CHECK (leaderboard_visibility IN ('full', 'initials', 'anonymous')),
ADD COLUMN IF NOT EXISTS show_on_leaderboard BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS signed_up_via_trip_invite UUID REFERENCES trip_invites(id);

-- 2. Banana transactions (with expiration)
CREATE TABLE IF NOT EXISTS banana_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN (
      'referral', 'tier_bonus', 'trip_complete', 'signup_bonus',
      'review', 'collaboration', 'spend', 'clawback', 'expiration', 'admin'
    )
  ),
  reference_id UUID,
  description TEXT,
  expires_at TIMESTAMPTZ,  -- NULL for spending transactions
  expired BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_banana_tx_user ON banana_transactions(user_id);
CREATE INDEX idx_banana_tx_expires ON banana_transactions(expires_at) WHERE NOT expired;
CREATE INDEX idx_banana_tx_type ON banana_transactions(transaction_type);

-- 3. Referral tiers (permanent badges)
CREATE TABLE IF NOT EXISTS referral_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  current_tier INTEGER DEFAULT 0,
  tier_1_unlocked_at TIMESTAMPTZ,
  tier_2_unlocked_at TIMESTAMPTZ,
  tier_3_unlocked_at TIMESTAMPTZ,
  lifetime_conversions INTEGER DEFAULT 0,
  -- Badge permanence (even if bananas expire)
  highest_tier_achieved INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_referral_tiers_user ON referral_tiers(user_id);
CREATE INDEX idx_referral_tiers_tier ON referral_tiers(current_tier);

-- 4. Redemption catalog
CREATE TABLE IF NOT EXISTS banana_redemption_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  category TEXT NOT NULL CHECK (category IN ('feature', 'partner', 'subscription')),
  banana_cost INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  available_from TIMESTAMPTZ,
  available_until TIMESTAMPTZ,
  stock_limit INTEGER,
  stock_used INTEGER DEFAULT 0,
  per_user_limit INTEGER,
  cooldown_hours INTEGER,
  partner_id UUID,
  partner_config JSONB,
  discount_type TEXT,
  discount_value DECIMAL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. User redemptions
CREATE TABLE IF NOT EXISTS banana_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL REFERENCES banana_redemption_catalog(id),
  bananas_spent INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'expired', 'refunded')),
  fulfilled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  partner_reference TEXT,
  partner_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_redemptions_user ON banana_redemptions(user_id);
CREATE INDEX idx_redemptions_status ON banana_redemptions(status);

-- 6. Update referral_events for fraud tracking
ALTER TABLE referral_events
ADD COLUMN IF NOT EXISTS fraud_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS fraud_factors JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS reward_status TEXT DEFAULT 'pending'
  CHECK (reward_status IN ('pending', 'approved', 'blocked', 'clawback'));

-- 7. Add referral eligibility to trip_invites
ALTER TABLE trip_invites
ADD COLUMN IF NOT EXISTS is_referral_eligible BOOLEAN DEFAULT true;

-- 8. RLS Policies
ALTER TABLE banana_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own transactions" ON banana_transactions
  FOR SELECT USING (user_id = auth.uid());

ALTER TABLE referral_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own tier" ON referral_tiers
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Anyone can view tiers for leaderboard" ON referral_tiers
  FOR SELECT USING (true);

ALTER TABLE banana_redemption_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view catalog" ON banana_redemption_catalog
  FOR SELECT USING (true);

ALTER TABLE banana_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own redemptions" ON banana_redemptions
  FOR SELECT USING (user_id = auth.uid());

-- 9. Initial catalog items
INSERT INTO banana_redemption_catalog (name, description, icon_url, category, banana_cost, is_active, sort_order) VALUES
('Extra AI Generation', 'Generate one additional trip itinerary', '✨', 'feature', 30, true, 1),
('Priority AI Queue', 'Skip the queue for faster generation', '⚡', 'feature', 20, true, 2),
('Premium Template Pack', 'Access to 10 curated trip templates', '📦', 'feature', 100, true, 3),
('1 Month Premium Trial', 'Try all premium features for 30 days', '👑', 'subscription', 300, true, 4),
-- Coming soon items (inactive)
('Hotel Discount 10%', 'Save 10% on your next hotel booking', '🏨', 'partner', 200, false, 10),
('Free Airport Lounge', 'One-time lounge access at partner airports', '✈️', 'partner', 150, false, 11),
('Travel Insurance Upgrade', 'Free upgrade to premium coverage', '🛡️', 'partner', 250, false, 12),
('Local Experience Credit', '$20 off tours and activities', '🎭', 'partner', 180, false, 13);

-- 10. Function to add bananas (with expiration)
CREATE OR REPLACE FUNCTION add_bananas(
  p_user_id UUID,
  p_amount INTEGER,
  p_type TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  v_new_balance INTEGER;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Calculate expiration (12 months from now)
  v_expires_at := NOW() + INTERVAL '12 months';

  -- Get current balance
  SELECT COALESCE(banana_balance, 0) INTO v_new_balance FROM users WHERE id = p_user_id;
  v_new_balance := v_new_balance + p_amount;

  -- Insert transaction
  INSERT INTO banana_transactions (user_id, amount, balance_after, transaction_type, reference_id, description, expires_at)
  VALUES (p_user_id, p_amount, v_new_balance, p_type, p_reference_id, p_description, v_expires_at);

  -- Update user balance
  UPDATE users SET banana_balance = v_new_balance WHERE id = p_user_id;

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Function to spend bananas (FIFO)
CREATE OR REPLACE FUNCTION spend_bananas(
  p_user_id UUID,
  p_amount INTEGER,
  p_type TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_available INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Calculate available (non-expired) balance
  SELECT COALESCE(SUM(
    CASE
      WHEN amount > 0 AND NOT expired AND expires_at > NOW() THEN amount
      WHEN amount < 0 THEN amount
      ELSE 0
    END
  ), 0) INTO v_available
  FROM banana_transactions
  WHERE user_id = p_user_id;

  IF v_available < p_amount THEN
    RETURN FALSE;
  END IF;

  -- Get current balance
  SELECT COALESCE(banana_balance, 0) INTO v_new_balance FROM users WHERE id = p_user_id;
  v_new_balance := v_new_balance - p_amount;

  -- Insert spending transaction (no expiration)
  INSERT INTO banana_transactions (user_id, amount, balance_after, transaction_type, reference_id, description, expires_at)
  VALUES (p_user_id, -p_amount, v_new_balance, p_type, p_reference_id, p_description, NULL);

  -- Update user balance
  UPDATE users SET banana_balance = v_new_balance WHERE id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12. Function to expire old bananas (run via cron)
CREATE OR REPLACE FUNCTION expire_old_bananas() RETURNS INTEGER AS $$
DECLARE
  v_expired_count INTEGER;
BEGIN
  -- Mark expired transactions
  WITH expired AS (
    UPDATE banana_transactions
    SET expired = true
    WHERE expires_at < NOW()
      AND expired = false
      AND amount > 0
    RETURNING user_id, amount
  )
  SELECT COUNT(*) INTO v_expired_count FROM expired;

  -- Recalculate affected user balances
  UPDATE users u
  SET banana_balance = COALESCE((
    SELECT SUM(
      CASE
        WHEN bt.amount > 0 AND NOT bt.expired AND bt.expires_at > NOW() THEN bt.amount
        WHEN bt.amount < 0 THEN bt.amount
        ELSE 0
      END
    )
    FROM banana_transactions bt
    WHERE bt.user_id = u.id
  ), 0)
  WHERE u.id IN (
    SELECT DISTINCT user_id FROM banana_transactions
    WHERE expired = true AND expires_at >= NOW() - INTERVAL '1 day'
  );

  RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Open Questions (Resolved)

| Question | Decision | Rationale |
|----------|----------|-----------|
| ~~Banana expiration?~~ | ✅ 12 months | Prevents infinite accumulation, creates urgency |
| ~~Negative balance?~~ | ❌ No | Too complex, users might feel trapped |
| ~~Leaderboard?~~ | ✅ Yes, anonymized | Competitive motivation without privacy risk |
| ~~Team referrals?~~ | ✅ Yes | Natural viral loop from collaboration |
| ~~Partner rewards?~~ | ✅ Infrastructure only | Prep for future, no commitment yet |

---

## Appendix: Competitor Analysis

| App | Referral Reward | Tiers | Currency |
|-----|-----------------|-------|----------|
| Revolut | £50 both parties | ❌ | Cash |
| Dropbox | 500MB storage | ✅ | Storage |
| Uber | $10 credit both | ❌ | Cash |
| Duolingo | 1 week premium | ❌ | Time |
| Airbnb | $25 travel credit | ❌ | Cash |

**Our differentiation:** Tiered progression + branded currency + gamification

---

*Document created: 2025-12-24*
*Status: Ready for review*
*Author: Claude Code + Growth Skills*
