# Bananas System - Detailed Implementation Plan

## Pre-Implementation Analysis

### Critical Decision: Referral Tiers vs Subscription Tiers

**Question:** How do referral tier bonuses interact with existing subscription tiers?

| Approach | Pros | Cons |
|----------|------|------|
| **Replace** - Referral tier overrides subscription | Simple | Cannibalizes premium subscriptions |
| **Additive** - Bonuses added to base tier | Preserves premium value | More complex |
| **Hybrid** - Cap at premium limits | Balance | Confusing UX |

**Decision: ADDITIVE**

```
Final Limit = Base Tier Limit + Referral Tier Bonus

Examples:
- Free (3) + Tier 1 (+2) = 5 AI generations/month
- Free (3) + Tier 2 (+5) = 8 AI generations/month
- Free (3) + Tier 3 (+12) = 15 AI generations/month
- Premium (-1) + Any Tier = -1 (already unlimited)
```

This preserves the value of premium subscriptions while rewarding referrers.

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 1: DATABASE                            │
├─────────────────────────────────────────────────────────────────┤
│  1.1 Users table alterations                                    │
│      ├── banana_balance                                         │
│      ├── referral_tier                                          │
│      ├── leaderboard_visibility                                 │
│      ├── show_on_leaderboard                                    │
│      └── signed_up_via_trip_invite                              │
│                                                                 │
│  1.2 New tables                                                 │
│      ├── banana_transactions (depends on: users)                │
│      ├── referral_tiers (depends on: users)                     │
│      ├── banana_redemption_catalog (standalone)                 │
│      └── banana_redemptions (depends on: users, catalog)        │
│                                                                 │
│  1.3 Existing table alterations                                 │
│      ├── referral_events (add fraud columns)                    │
│      └── trip_invites (add is_referral_eligible)                │
│                                                                 │
│  1.4 Functions                                                  │
│      ├── add_bananas() (depends on: banana_transactions)        │
│      ├── spend_bananas() (depends on: banana_transactions)      │
│      └── expire_old_bananas() (depends on: banana_transactions) │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 2: TYPES & CONFIG                      │
├─────────────────────────────────────────────────────────────────┤
│  2.1 TypeScript types                                           │
│      ├── types/bananas.ts (new file)                            │
│      └── types/index.ts (export new types)                      │
│                                                                 │
│  2.2 Configuration                                              │
│      ├── lib/bananas/config.ts (earning rates, tier bonuses)    │
│      └── lib/usage-limits/config.ts (add referral tier bonuses) │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 3: CORE LIBRARY                        │
├─────────────────────────────────────────────────────────────────┤
│  3.1 Banana operations (lib/bananas/)                           │
│      ├── index.ts (main exports)                                │
│      ├── balance.ts (get balance, check expiring)               │
│      ├── transactions.ts (add, spend, history)                  │
│      └── tiers.ts (check tier, unlock tier, get bonuses)        │
│                                                                 │
│  3.2 Usage limits integration                                   │
│      └── lib/usage-limits/check.ts (add referral tier bonuses)  │
│          MODIFY: checkUsageLimit() to add tier bonuses          │
│          MODIFY: getUserTier() to also return referral_tier     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 4: API ENDPOINTS                       │
├─────────────────────────────────────────────────────────────────┤
│  4.1 New endpoints                                              │
│      ├── /api/bananas/route.ts (GET balance & transactions)     │
│      ├── /api/bananas/spend/route.ts (POST redeem item)         │
│      ├── /api/bananas/catalog/route.ts (GET redemption catalog) │
│      ├── /api/referral/tier/route.ts (GET tier status)          │
│      └── /api/referral/leaderboard/route.ts (GET leaderboard)   │
│                                                                 │
│  4.2 Modified endpoints                                         │
│      ├── /api/referral/complete/route.ts                        │
│      │   MODIFY: Award bananas + check tier unlock              │
│      ├── /api/referral/code/route.ts                            │
│      │   MODIFY: Return banana stats                            │
│      ├── /api/referral/history/route.ts                         │
│      │   MODIFY: Include banana transactions                    │
│      └── /api/invites/[token]/route.ts                          │
│          MODIFY: Track collaborator referrals                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 5: UI COMPONENTS                       │
├─────────────────────────────────────────────────────────────────┤
│  5.1 New components                                             │
│      ├── components/bananas/BananaBalance.tsx                   │
│      ├── components/bananas/BananaHistory.tsx                   │
│      ├── components/bananas/TierProgress.tsx                    │
│      ├── components/bananas/TierBadge.tsx                       │
│      ├── components/bananas/RedemptionCatalog.tsx               │
│      ├── components/bananas/Leaderboard.tsx                     │
│      └── components/bananas/ReferralDashboard.tsx               │
│                                                                 │
│  5.2 Modified components                                        │
│      ├── components/referral/ReferralModal.tsx                  │
│      │   MODIFY: Show bananas earned instead of trips           │
│      ├── components/Navbar.tsx                                  │
│      │   MODIFY: Add banana balance indicator                   │
│      └── app/[locale]/profile/ProfileClient.tsx                 │
│          MODIFY: Add referral rewards section                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 6: INTEGRATION                         │
├─────────────────────────────────────────────────────────────────┤
│  6.1 Referral completion flow                                   │
│      └── Ensure /api/referral/complete awards bananas           │
│                                                                 │
│  6.2 Collaborator referral flow                                 │
│      └── Hook /api/invites/[token] into referral system         │
│                                                                 │
│  6.3 Profile page integration                                   │
│      └── Add referral dashboard section                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Database Migration

### 1.1 Migration Safety Checklist

- [ ] All ALTER TABLE statements use `IF NOT EXISTS` / `IF EXISTS`
- [ ] No data loss possible (only additions, no drops without backup)
- [ ] Indexes added for query patterns we'll use
- [ ] RLS policies tested
- [ ] Rollback script prepared
- [ ] Migration tested on branch first

### 1.2 Migration File

**File:** `supabase/migrations/[timestamp]_create_bananas_system.sql`

```sql
-- =====================================================
-- Migration: Bananas Referral System
-- Date: 2025-12-24
-- Description: Adds banana currency, referral tiers, and redemption system
-- =====================================================

-- SAFETY: All operations are idempotent (can be run multiple times)

BEGIN;

-- =====================================================
-- 1. USERS TABLE ALTERATIONS
-- =====================================================

-- Banana balance (cached for quick reads)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS banana_balance INTEGER DEFAULT 0;

-- Referral tier (0-3)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS referral_tier INTEGER DEFAULT 0
CHECK (referral_tier >= 0 AND referral_tier <= 3);

-- Leaderboard privacy settings
ALTER TABLE users
ADD COLUMN IF NOT EXISTS leaderboard_visibility TEXT DEFAULT 'initials'
CHECK (leaderboard_visibility IN ('full', 'initials', 'anonymous'));

ALTER TABLE users
ADD COLUMN IF NOT EXISTS show_on_leaderboard BOOLEAN DEFAULT true;

-- Track if user signed up via trip collaboration invite
-- This enables counting collaborators as referrals
ALTER TABLE users
ADD COLUMN IF NOT EXISTS signed_up_via_trip_invite UUID;

-- Add foreign key constraint (may fail if trip_invites doesn't exist yet)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_signed_up_via_trip_invite_fkey'
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT users_signed_up_via_trip_invite_fkey
    FOREIGN KEY (signed_up_via_trip_invite)
    REFERENCES trip_invites(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  -- Ignore if trip_invites table doesn't exist
  NULL;
END $$;

-- =====================================================
-- 2. BANANA TRANSACTIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS banana_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Transaction details
  amount INTEGER NOT NULL,  -- Positive = earn, Negative = spend
  balance_after INTEGER NOT NULL,

  -- Transaction classification
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN (
      'referral',         -- Earned from referral conversion
      'tier_bonus',       -- One-time tier unlock bonus
      'trip_complete',    -- Earned from completing a trip
      'signup_bonus',     -- New user signup bonus
      'review',           -- Earned from leaving review
      'collaboration',    -- Earned from collaborator referral
      'spend',            -- Spent on redemption
      'clawback',         -- Reversed due to fraud
      'expiration',       -- Expired after 12 months
      'admin'             -- Manual admin adjustment
    )
  ),

  -- Reference to related entity (e.g., referral_event_id, redemption_id)
  reference_id UUID,
  description TEXT,

  -- Expiration tracking (12 months from creation)
  expires_at TIMESTAMPTZ,  -- NULL for spending/clawback transactions
  expired BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_banana_tx_user
  ON banana_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_banana_tx_expires
  ON banana_transactions(expires_at)
  WHERE NOT expired AND amount > 0;
CREATE INDEX IF NOT EXISTS idx_banana_tx_type
  ON banana_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_banana_tx_created
  ON banana_transactions(created_at DESC);

-- =====================================================
-- 3. REFERRAL TIERS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS referral_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Current tier (can decrease if bananas expire, but badges remain)
  current_tier INTEGER DEFAULT 0 CHECK (current_tier >= 0 AND current_tier <= 3),

  -- Timestamp when each tier was first unlocked (for badges - permanent)
  tier_1_unlocked_at TIMESTAMPTZ,
  tier_2_unlocked_at TIMESTAMPTZ,
  tier_3_unlocked_at TIMESTAMPTZ,

  -- Lifetime stats (never decreases)
  lifetime_conversions INTEGER DEFAULT 0,

  -- Highest tier ever achieved (for permanent badge display)
  highest_tier_achieved INTEGER DEFAULT 0,

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT referral_tiers_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_tiers_user
  ON referral_tiers(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_tiers_tier
  ON referral_tiers(current_tier)
  WHERE current_tier > 0;
CREATE INDEX IF NOT EXISTS idx_referral_tiers_conversions
  ON referral_tiers(lifetime_conversions DESC);

-- =====================================================
-- 4. REDEMPTION CATALOG TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS banana_redemption_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Display info
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,  -- Emoji or image URL

  -- Categorization
  category TEXT NOT NULL CHECK (category IN ('feature', 'partner', 'subscription')),

  -- Pricing
  banana_cost INTEGER NOT NULL CHECK (banana_cost > 0),

  -- Availability
  is_active BOOLEAN DEFAULT true,
  available_from TIMESTAMPTZ,
  available_until TIMESTAMPTZ,

  -- Stock management
  stock_limit INTEGER,  -- NULL = unlimited
  stock_used INTEGER DEFAULT 0,

  -- Per-user limits
  per_user_limit INTEGER,  -- NULL = unlimited
  cooldown_hours INTEGER,  -- Hours between redemptions for same user

  -- Future: Partner integration
  partner_id UUID,
  partner_config JSONB DEFAULT '{}',
  discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed', 'upgrade') OR discount_type IS NULL),
  discount_value DECIMAL,

  -- Display ordering
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_active
  ON banana_redemption_catalog(is_active, sort_order)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_catalog_category
  ON banana_redemption_catalog(category);

-- =====================================================
-- 5. USER REDEMPTIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS banana_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL REFERENCES banana_redemption_catalog(id),

  -- Transaction details
  bananas_spent INTEGER NOT NULL,

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'expired', 'refunded')),
  fulfilled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,  -- When the redeemed benefit expires

  -- Future: Partner integration
  partner_reference TEXT,  -- External voucher code, booking ID, etc.
  partner_response JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redemptions_user
  ON banana_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_status
  ON banana_redemptions(status);
CREATE INDEX IF NOT EXISTS idx_redemptions_item
  ON banana_redemptions(catalog_item_id);

-- =====================================================
-- 6. MODIFY EXISTING TABLES
-- =====================================================

-- Add fraud tracking to referral_events
ALTER TABLE referral_events
ADD COLUMN IF NOT EXISTS fraud_score INTEGER DEFAULT 0;

ALTER TABLE referral_events
ADD COLUMN IF NOT EXISTS fraud_factors JSONB DEFAULT '{}';

ALTER TABLE referral_events
ADD COLUMN IF NOT EXISTS reward_status TEXT DEFAULT 'pending'
CHECK (reward_status IN ('pending', 'approved', 'blocked', 'clawback'));

-- Add referral eligibility flag to trip_invites
ALTER TABLE trip_invites
ADD COLUMN IF NOT EXISTS is_referral_eligible BOOLEAN DEFAULT true;

-- =====================================================
-- 7. ROW LEVEL SECURITY
-- =====================================================

-- Banana transactions: Users can only see their own
ALTER TABLE banana_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own banana transactions" ON banana_transactions;
CREATE POLICY "Users can view own banana transactions"
  ON banana_transactions FOR SELECT
  USING (user_id = auth.uid());

-- Referral tiers: Users can view own, leaderboard can view all (for ranking)
ALTER TABLE referral_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tier" ON referral_tiers;
CREATE POLICY "Users can view own tier"
  ON referral_tiers FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Leaderboard can view tiers" ON referral_tiers;
CREATE POLICY "Leaderboard can view tiers"
  ON referral_tiers FOR SELECT
  USING (true);  -- Leaderboard needs to rank all users

-- Catalog: Anyone can view
ALTER TABLE banana_redemption_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view catalog" ON banana_redemption_catalog;
CREATE POLICY "Anyone can view catalog"
  ON banana_redemption_catalog FOR SELECT
  USING (true);

-- Redemptions: Users can view their own
ALTER TABLE banana_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own redemptions" ON banana_redemptions;
CREATE POLICY "Users can view own redemptions"
  ON banana_redemptions FOR SELECT
  USING (user_id = auth.uid());

-- =====================================================
-- 8. FUNCTIONS
-- =====================================================

-- Function: Add bananas to user account (with 12-month expiration)
CREATE OR REPLACE FUNCTION add_bananas(
  p_user_id UUID,
  p_amount INTEGER,
  p_type TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS TABLE (new_balance INTEGER, transaction_id UUID) AS $$
DECLARE
  v_new_balance INTEGER;
  v_expires_at TIMESTAMPTZ;
  v_tx_id UUID;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Calculate expiration (12 months from now)
  v_expires_at := NOW() + INTERVAL '12 months';

  -- Get current balance with row lock
  SELECT COALESCE(banana_balance, 0) INTO v_new_balance
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_new_balance := v_new_balance + p_amount;

  -- Insert transaction
  INSERT INTO banana_transactions (
    user_id, amount, balance_after, transaction_type,
    reference_id, description, expires_at
  ) VALUES (
    p_user_id, p_amount, v_new_balance, p_type,
    p_reference_id, p_description, v_expires_at
  ) RETURNING id INTO v_tx_id;

  -- Update user balance
  UPDATE users SET banana_balance = v_new_balance WHERE id = p_user_id;

  RETURN QUERY SELECT v_new_balance, v_tx_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Spend bananas (FIFO - oldest expire first)
CREATE OR REPLACE FUNCTION spend_bananas(
  p_user_id UUID,
  p_amount INTEGER,
  p_type TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS TABLE (success BOOLEAN, new_balance INTEGER, transaction_id UUID) AS $$
DECLARE
  v_available INTEGER;
  v_new_balance INTEGER;
  v_tx_id UUID;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Lock user row
  SELECT COALESCE(banana_balance, 0) INTO v_new_balance
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, NULL::UUID;
    RETURN;
  END IF;

  -- Calculate available (non-expired) balance
  SELECT COALESCE(SUM(
    CASE
      WHEN amount > 0 AND NOT expired AND (expires_at IS NULL OR expires_at > NOW()) THEN amount
      WHEN amount < 0 THEN amount  -- Spending reduces available
      ELSE 0
    END
  ), 0) INTO v_available
  FROM banana_transactions
  WHERE user_id = p_user_id;

  -- Check if user has enough
  IF v_available < p_amount THEN
    RETURN QUERY SELECT false, v_new_balance, NULL::UUID;
    RETURN;
  END IF;

  v_new_balance := v_new_balance - p_amount;

  -- Insert spending transaction (no expiration for spends)
  INSERT INTO banana_transactions (
    user_id, amount, balance_after, transaction_type,
    reference_id, description, expires_at
  ) VALUES (
    p_user_id, -p_amount, v_new_balance, p_type,
    p_reference_id, p_description, NULL
  ) RETURNING id INTO v_tx_id;

  -- Update user balance
  UPDATE users SET banana_balance = v_new_balance WHERE id = p_user_id;

  RETURN QUERY SELECT true, v_new_balance, v_tx_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Expire old bananas (run via cron daily)
CREATE OR REPLACE FUNCTION expire_old_bananas() RETURNS INTEGER AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_affected_users UUID[];
BEGIN
  -- Collect affected users first
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_affected_users
  FROM banana_transactions
  WHERE expires_at < NOW()
    AND expired = false
    AND amount > 0;

  -- Mark expired transactions
  WITH expired AS (
    UPDATE banana_transactions
    SET expired = true
    WHERE expires_at < NOW()
      AND expired = false
      AND amount > 0
    RETURNING id
  )
  SELECT COUNT(*) INTO v_expired_count FROM expired;

  -- Recalculate balances for affected users
  IF v_affected_users IS NOT NULL AND array_length(v_affected_users, 1) > 0 THEN
    UPDATE users u
    SET banana_balance = COALESCE((
      SELECT SUM(
        CASE
          WHEN bt.amount > 0 AND NOT bt.expired AND (bt.expires_at IS NULL OR bt.expires_at > NOW()) THEN bt.amount
          WHEN bt.amount < 0 THEN bt.amount
          ELSE 0
        END
      )
      FROM banana_transactions bt
      WHERE bt.user_id = u.id
    ), 0)
    WHERE u.id = ANY(v_affected_users);
  END IF;

  RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get user's available balance (accounting for expiration)
CREATE OR REPLACE FUNCTION get_available_banana_balance(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  SELECT COALESCE(SUM(
    CASE
      WHEN amount > 0 AND NOT expired AND (expires_at IS NULL OR expires_at > NOW()) THEN amount
      WHEN amount < 0 THEN amount
      ELSE 0
    END
  ), 0) INTO v_balance
  FROM banana_transactions
  WHERE user_id = p_user_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check and unlock referral tier
CREATE OR REPLACE FUNCTION check_and_unlock_tier(p_user_id UUID)
RETURNS TABLE (
  new_tier INTEGER,
  tier_unlocked BOOLEAN,
  bonus_bananas INTEGER
) AS $$
DECLARE
  v_conversions INTEGER;
  v_current_tier INTEGER;
  v_new_tier INTEGER;
  v_highest_tier INTEGER;
  v_tier_unlocked BOOLEAN := false;
  v_bonus INTEGER := 0;
BEGIN
  -- Get current conversion count
  SELECT COALESCE(total_conversions, 0) INTO v_conversions
  FROM referral_codes
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    v_conversions := 0;
  END IF;

  -- Calculate tier based on conversions
  v_new_tier := CASE
    WHEN v_conversions >= 10 THEN 3
    WHEN v_conversions >= 6 THEN 2
    WHEN v_conversions >= 3 THEN 1
    ELSE 0
  END;

  -- Get or create referral_tiers record
  INSERT INTO referral_tiers (user_id, lifetime_conversions)
  VALUES (p_user_id, v_conversions)
  ON CONFLICT (user_id) DO UPDATE
  SET lifetime_conversions = GREATEST(referral_tiers.lifetime_conversions, v_conversions),
      updated_at = NOW()
  RETURNING current_tier, highest_tier_achieved INTO v_current_tier, v_highest_tier;

  -- Check if new tier is higher than current
  IF v_new_tier > COALESCE(v_current_tier, 0) THEN
    v_tier_unlocked := true;

    -- Calculate bonus (only for newly unlocked tiers)
    v_bonus := CASE v_new_tier
      WHEN 1 THEN 100  -- Tier 1 bonus
      WHEN 2 THEN 200  -- Tier 2 bonus
      WHEN 3 THEN 500  -- Tier 3 bonus
      ELSE 0
    END;

    -- Update tier record
    UPDATE referral_tiers
    SET current_tier = v_new_tier,
        highest_tier_achieved = GREATEST(highest_tier_achieved, v_new_tier),
        tier_1_unlocked_at = CASE WHEN v_new_tier >= 1 AND tier_1_unlocked_at IS NULL THEN NOW() ELSE tier_1_unlocked_at END,
        tier_2_unlocked_at = CASE WHEN v_new_tier >= 2 AND tier_2_unlocked_at IS NULL THEN NOW() ELSE tier_2_unlocked_at END,
        tier_3_unlocked_at = CASE WHEN v_new_tier = 3 AND tier_3_unlocked_at IS NULL THEN NOW() ELSE tier_3_unlocked_at END,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- Update users table for quick access
    UPDATE users SET referral_tier = v_new_tier WHERE id = p_user_id;

    -- Award tier bonus bananas
    IF v_bonus > 0 THEN
      PERFORM add_bananas(
        p_user_id,
        v_bonus,
        'tier_bonus',
        NULL,
        'Tier ' || v_new_tier || ' unlock bonus'
      );
    END IF;
  END IF;

  RETURN QUERY SELECT v_new_tier, v_tier_unlocked, v_bonus;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 9. INITIAL DATA: REDEMPTION CATALOG
-- =====================================================

-- Active items (can redeem now)
INSERT INTO banana_redemption_catalog (name, description, icon_url, category, banana_cost, is_active, sort_order)
VALUES
  ('Extra AI Generation', 'Generate one additional trip itinerary', '✨', 'feature', 30, true, 1),
  ('Priority AI Queue', 'Skip the queue for faster generation on your next trip', '⚡', 'feature', 20, true, 2),
  ('Premium Template Pack', 'Access to 10 curated trip templates for popular destinations', '📦', 'feature', 100, true, 3),
  ('1 Month Premium Trial', 'Try all premium features free for 30 days', '👑', 'subscription', 300, true, 4)
ON CONFLICT DO NOTHING;

-- Coming soon items (inactive, for display purposes)
INSERT INTO banana_redemption_catalog (name, description, icon_url, category, banana_cost, is_active, sort_order)
VALUES
  ('Hotel Discount 10%', 'Save 10% on your next hotel booking with our partners', '🏨', 'partner', 200, false, 10),
  ('Free Airport Lounge', 'One-time lounge access at 100+ partner airports worldwide', '✈️', 'partner', 150, false, 11),
  ('Travel Insurance Upgrade', 'Free upgrade to premium coverage on your next trip', '🛡️', 'partner', 250, false, 12),
  ('Local Experience Credit', '$20 off tours and local activities through our partners', '🎭', 'partner', 180, false, 13)
ON CONFLICT DO NOTHING;

COMMIT;
```

---

## Phase 2: TypeScript Types

### File: `types/bananas.ts`

```typescript
/**
 * Bananas Currency System Types
 */

// =============================================================================
// BANANA TRANSACTIONS
// =============================================================================

export type BananaTransactionType =
  | 'referral'        // Earned from successful referral
  | 'tier_bonus'      // One-time tier unlock bonus
  | 'trip_complete'   // Earned from completing a trip
  | 'signup_bonus'    // New user signup bonus
  | 'review'          // Earned from leaving a review
  | 'collaboration'   // Earned from collaborator referral
  | 'spend'           // Spent on redemption
  | 'clawback'        // Reversed due to fraud
  | 'expiration'      // Expired after 12 months
  | 'admin';          // Manual admin adjustment

export interface BananaTransaction {
  id: string;
  userId: string;
  amount: number;          // Positive = earn, Negative = spend
  balanceAfter: number;
  transactionType: BananaTransactionType;
  referenceId?: string;
  description?: string;
  expiresAt?: string;      // ISO date string
  expired: boolean;
  createdAt: string;
}

export interface BananaBalanceInfo {
  available: number;       // Current spendable balance
  expiringSoon: number;    // Amount expiring in next 30 days
  expiringDate?: string;   // When the soonest expiration is
  lifetimeEarned: number;  // Total ever earned
  lifetimeSpent: number;   // Total ever spent
}

// =============================================================================
// REFERRAL TIERS
// =============================================================================

export type ReferralTierLevel = 0 | 1 | 2 | 3;

export interface ReferralTierInfo {
  currentTier: ReferralTierLevel;
  highestTierAchieved: ReferralTierLevel;  // For permanent badges
  lifetimeConversions: number;
  conversionsToNextTier: number;           // 0 if at max tier
  nextTierAt: number;                      // Conversion count needed
  tier1UnlockedAt?: string;
  tier2UnlockedAt?: string;
  tier3UnlockedAt?: string;
}

export interface TierBadgeInfo {
  tier: ReferralTierLevel;
  name: string;           // "Explorer", "Ambassador", "Champion"
  emoji: string;          // "🌟", "🔥", "👑"
  unlocked: boolean;
  unlockedAt?: string;
}

export interface TierBenefits {
  aiGenerationsBonus: number;
  aiRegenerationsBonus: number;
  bananasPerReferral: number;
  tierBonus: number;
  hasTemplateAccess: boolean;
  templateCount: number;
  hasPrioritySupport: boolean;
  hasEarlyAccess: boolean;
}

// =============================================================================
// REDEMPTION CATALOG
// =============================================================================

export type RedemptionCategory = 'feature' | 'partner' | 'subscription';

export interface RedemptionItem {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;        // Emoji or image URL
  category: RedemptionCategory;
  bananaCost: number;
  isActive: boolean;
  availableFrom?: string;
  availableUntil?: string;
  stockLimit?: number;
  stockRemaining?: number;
  perUserLimit?: number;
  cooldownHours?: number;
  sortOrder: number;

  // For partner items (future)
  partnerId?: string;
  discountType?: 'percentage' | 'fixed' | 'upgrade';
  discountValue?: number;
}

export interface UserRedemption {
  id: string;
  userId: string;
  catalogItemId: string;
  catalogItem: RedemptionItem;
  bananasSpent: number;
  status: 'pending' | 'fulfilled' | 'expired' | 'refunded';
  fulfilledAt?: string;
  expiresAt?: string;
  partnerReference?: string;
  createdAt: string;
}

// =============================================================================
// LEADERBOARD
// =============================================================================

export type LeaderboardVisibility = 'full' | 'initials' | 'anonymous';
export type LeaderboardPeriod = 'monthly' | 'alltime';

export interface LeaderboardEntry {
  rank: number;
  displayName: string;     // Anonymized based on visibility preference
  avatarUrl?: string;      // Hidden if anonymous
  badge: TierBadgeInfo | null;
  referralCount: number;
  isCurrentUser: boolean;
}

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  userRank: number | null;        // Current user's rank (even if not in top N)
  totalParticipants: number;
  updatedAt: string;
}

// =============================================================================
// API RESPONSES
// =============================================================================

export interface BananasDashboardResponse {
  balance: BananaBalanceInfo;
  tier: ReferralTierInfo;
  badges: TierBadgeInfo[];
  recentTransactions: BananaTransaction[];
  referralStats: {
    totalReferrals: number;
    pendingReferrals: number;
    bananasEarned: number;
  };
}

export interface RedeemResponse {
  success: boolean;
  redemption?: UserRedemption;
  newBalance: number;
  error?: string;
  errorCode?: 'INSUFFICIENT_BALANCE' | 'OUT_OF_STOCK' | 'LIMIT_REACHED' | 'COOLDOWN_ACTIVE';
}
```

---

## Phase 3: Configuration

### File: `lib/bananas/config.ts`

```typescript
/**
 * Bananas System Configuration
 *
 * All earning rates, tier definitions, and system constants.
 */

import type { ReferralTierLevel, TierBenefits } from '@/types/bananas';

// =============================================================================
// EARNING RATES
// =============================================================================

/**
 * Base earning rates (before tier multipliers)
 */
export const BANANA_EARNING_RATES = {
  referral: 50,           // Per successful referral
  tripComplete: 10,       // Per completed trip
  firstTrip: 25,          // Bonus for first trip (one-time)
  signupBonus: 0,         // No signup bonus (earn through referrals)
  review: 5,              // Per review left
  collaboration: 50,      // Collaborator counted as referral
} as const;

/**
 * Tier-based earning multipliers
 */
export const TIER_EARNING_MULTIPLIERS: Record<ReferralTierLevel, number> = {
  0: 1.0,    // Base rate
  1: 1.2,    // +20% at Tier 1
  2: 1.5,    // +50% at Tier 2
  3: 2.0,    // +100% at Tier 3
};

// =============================================================================
// TIER THRESHOLDS
// =============================================================================

/**
 * Number of referrals needed to unlock each tier
 */
export const TIER_THRESHOLDS: Record<ReferralTierLevel, number> = {
  0: 0,
  1: 3,
  2: 6,
  3: 10,
};

/**
 * One-time bonus bananas awarded when unlocking a tier
 */
export const TIER_UNLOCK_BONUSES: Record<ReferralTierLevel, number> = {
  0: 0,
  1: 100,
  2: 200,
  3: 500,
};

// =============================================================================
// TIER BENEFITS
// =============================================================================

/**
 * Benefits at each tier level
 */
export const TIER_BENEFITS: Record<ReferralTierLevel, TierBenefits> = {
  0: {
    aiGenerationsBonus: 0,
    aiRegenerationsBonus: 0,
    bananasPerReferral: 50,
    tierBonus: 0,
    hasTemplateAccess: false,
    templateCount: 0,
    hasPrioritySupport: false,
    hasEarlyAccess: false,
  },
  1: {
    aiGenerationsBonus: 2,        // +2 AI generations/month
    aiRegenerationsBonus: 5,      // +5 regenerations/month
    bananasPerReferral: 60,       // +20% bananas per referral
    tierBonus: 100,
    hasTemplateAccess: true,
    templateCount: 3,
    hasPrioritySupport: false,
    hasEarlyAccess: false,
  },
  2: {
    aiGenerationsBonus: 5,        // +5 AI generations/month
    aiRegenerationsBonus: 15,     // +15 regenerations/month
    bananasPerReferral: 75,       // +50% bananas per referral
    tierBonus: 200,
    hasTemplateAccess: true,
    templateCount: 10,
    hasPrioritySupport: true,
    hasEarlyAccess: false,
  },
  3: {
    aiGenerationsBonus: 12,       // +12 AI generations/month (15 total for free)
    aiRegenerationsBonus: -1,     // Unlimited regenerations
    bananasPerReferral: 100,      // +100% bananas per referral
    tierBonus: 500,
    hasTemplateAccess: true,
    templateCount: -1,            // All templates
    hasPrioritySupport: true,
    hasEarlyAccess: true,
  },
};

// =============================================================================
// TIER METADATA
// =============================================================================

export const TIER_NAMES: Record<ReferralTierLevel, string> = {
  0: 'Traveler',
  1: 'Explorer',
  2: 'Ambassador',
  3: 'Champion',
};

export const TIER_EMOJIS: Record<ReferralTierLevel, string> = {
  0: '',
  1: '🌟',
  2: '🔥',
  3: '👑',
};

export const TIER_COLORS: Record<ReferralTierLevel, string> = {
  0: 'slate',
  1: 'amber',
  2: 'orange',
  3: 'purple',
};

// =============================================================================
// EXPIRATION
// =============================================================================

export const BANANA_EXPIRATION_MONTHS = 12;
export const EXPIRATION_WARNING_DAYS = 30;

// =============================================================================
// SPENDING
// =============================================================================

/**
 * Feature codes that can be unlocked with banana redemptions
 */
export const REDEEMABLE_FEATURES = {
  EXTRA_AI_GENERATION: 'extra_ai_generation',
  PRIORITY_AI_QUEUE: 'priority_ai_queue',
  PREMIUM_TEMPLATES: 'premium_templates',
  PREMIUM_TRIAL: 'premium_trial',
} as const;

// =============================================================================
// FRAUD PREVENTION
// =============================================================================

export const FRAUD_THRESHOLDS = {
  sameIpScore: 30,
  similarEmailScore: 20,
  newAccountScore: 15,
  noEngagementScore: 25,
  vpnScore: 10,
  blockThreshold: 50,
  reviewThreshold: 30,
};

export const MAX_REFERRALS_PER_DAY = 5;
export const MIN_ACCOUNT_AGE_HOURS = 24;
export const CLAWBACK_WINDOW_DAYS = 7;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the tier level for a given conversion count
 */
export function getTierForConversions(conversions: number): ReferralTierLevel {
  if (conversions >= TIER_THRESHOLDS[3]) return 3;
  if (conversions >= TIER_THRESHOLDS[2]) return 2;
  if (conversions >= TIER_THRESHOLDS[1]) return 1;
  return 0;
}

/**
 * Get conversions needed for next tier
 */
export function getConversionsToNextTier(currentConversions: number): number {
  const currentTier = getTierForConversions(currentConversions);
  if (currentTier === 3) return 0;

  const nextTierThreshold = TIER_THRESHOLDS[(currentTier + 1) as ReferralTierLevel];
  return nextTierThreshold - currentConversions;
}

/**
 * Calculate bananas earned for a referral based on tier
 */
export function getBananasForReferral(tier: ReferralTierLevel): number {
  return TIER_BENEFITS[tier].bananasPerReferral;
}

/**
 * Check if a limit value means unlimited
 */
export function isUnlimited(value: number): boolean {
  return value === -1;
}
```

---

## Phase 4: Implementation Order

### Step-by-Step Checklist

```
WEEK 1: DATABASE & TYPES
========================
□ Day 1-2: Database migration
  □ Review migration script
  □ Test on Supabase branch
  □ Apply to production
  □ Verify all tables created
  □ Verify RLS policies working

□ Day 3-4: TypeScript types
  □ Create types/bananas.ts
  □ Export from types/index.ts
  □ Create lib/bananas/config.ts
  □ Run tsc to verify no errors

□ Day 5: Core library
  □ Create lib/bananas/index.ts
  □ Create lib/bananas/balance.ts
  □ Create lib/bananas/transactions.ts
  □ Create lib/bananas/tiers.ts
  □ Unit test core functions

WEEK 2: API ENDPOINTS
=====================
□ Day 1: New endpoints
  □ GET /api/bananas
  □ POST /api/bananas/spend
  □ GET /api/bananas/catalog

□ Day 2: Referral endpoints
  □ GET /api/referral/tier
  □ GET /api/referral/leaderboard

□ Day 3-4: Modify existing endpoints
  □ /api/referral/complete (award bananas)
  □ /api/referral/code (return banana stats)
  □ /api/invites/[token] (collaborator tracking)

□ Day 5: Usage limits integration
  □ Modify checkUsageLimit for tier bonuses
  □ Test tier bonuses applied correctly

WEEK 3: UI COMPONENTS
=====================
□ Day 1-2: Core components
  □ BananaBalance.tsx
  □ TierBadge.tsx
  □ TierProgress.tsx

□ Day 3: Dashboard
  □ ReferralDashboard.tsx
  □ BananaHistory.tsx
  □ RedemptionCatalog.tsx

□ Day 4: Leaderboard
  □ Leaderboard.tsx
  □ Privacy settings UI

□ Day 5: Integration
  □ Update ReferralModal
  □ Add to Navbar
  □ Add to Profile page

WEEK 4: POLISH & TESTING
========================
□ Day 1-2: Celebration animations
  □ Tier unlock animation
  □ Banana earn animation
  □ Confetti for milestones

□ Day 3: Anti-fraud
  □ Implement fraud scoring
  □ Add rate limiting
  □ Test edge cases

□ Day 4: Admin tools
  □ Admin view for banana stats
  □ Manual adjustment capability
  □ Fraud review queue

□ Day 5: Final testing
  □ End-to-end referral flow
  □ Tier progression
  □ Spending flow
  □ Edge cases
```

---

## Risk Mitigation

### Database Risks

| Risk | Mitigation |
|------|------------|
| Migration fails | All statements are idempotent, can re-run |
| RLS locks users out | Tested policies before applying |
| Performance issues | Indexes on all query patterns |

### Business Risks

| Risk | Mitigation |
|------|------------|
| Banana inflation | Fixed earning rates, no admin abuse |
| Fraud abuse | Scoring system + clawback policy |
| Premium cannibalization | Tier benefits cap below premium |

### Technical Risks

| Risk | Mitigation |
|------|------------|
| Breaking existing referrals | Backward compatible - free_trips still works |
| Cache invalidation | Clear cache on tier changes |
| Race conditions | Database functions use row locks |

---

## Rollback Plan

If issues arise:

1. **Database rollback:**
   ```sql
   -- Remove new columns (data preserved in transaction tables)
   ALTER TABLE users DROP COLUMN IF EXISTS banana_balance;
   ALTER TABLE users DROP COLUMN IF EXISTS referral_tier;
   -- Tables can remain, just won't be used
   ```

2. **Code rollback:**
   - Revert API changes
   - Remove new components
   - Keep types (unused is fine)

3. **Feature flag approach:**
   ```typescript
   const ENABLE_BANANAS = process.env.ENABLE_BANANAS === 'true';
   ```

---

*Document created: 2025-12-24*
*Status: Ready for implementation*
