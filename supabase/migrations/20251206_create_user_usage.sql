-- Migration: Create user_usage table for tracking API usage limits
-- Date: 2024-12-06
-- Description: Implements per-user usage tracking for AI generation and Places API
--              with support for free/premium tiers and monthly/daily limits

-- ============================================================================
-- STEP 1: Create user_usage table for tracking usage counters
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Period tracking
  -- period_type: 'monthly' for AI generations, 'daily' for Places API
  -- period_key: 'YYYY-MM' for monthly, 'YYYY-MM-DD' for daily
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'daily')),
  period_key TEXT NOT NULL,

  -- AI Usage Counters (monthly)
  ai_generations_used INTEGER DEFAULT 0,
  ai_regenerations_used INTEGER DEFAULT 0,
  ai_assistant_messages_used INTEGER DEFAULT 0,
  ai_tokens_used INTEGER DEFAULT 0,

  -- Places API Counters (daily)
  places_autocomplete_used INTEGER DEFAULT 0,
  places_search_used INTEGER DEFAULT 0,
  places_details_used INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one row per user per period
  CONSTRAINT unique_user_period UNIQUE (user_id, period_type, period_key)
);

-- ============================================================================
-- STEP 2: Create indexes for fast lookups
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_usage_user_period
  ON user_usage(user_id, period_type, period_key);
CREATE INDEX IF NOT EXISTS idx_user_usage_period
  ON user_usage(period_type, period_key);
CREATE INDEX IF NOT EXISTS idx_user_usage_user_id
  ON user_usage(user_id);

-- ============================================================================
-- STEP 3: Enable Row Level Security
-- ============================================================================
ALTER TABLE user_usage ENABLE ROW LEVEL SECURITY;

-- Users can view their own usage
CREATE POLICY "Users can view their own usage"
ON user_usage FOR SELECT
USING (auth.uid() = user_id);

-- Service role can manage all usage (for incrementing)
-- Note: API routes use service role for atomic increments
CREATE POLICY "Service role can manage usage"
ON user_usage FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================================================
-- STEP 4: Add subscription fields to users table
-- ============================================================================
DO $$
BEGIN
  -- Add subscription_tier column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'subscription_tier'
  ) THEN
    ALTER TABLE users ADD COLUMN subscription_tier TEXT DEFAULT 'free'
      CHECK (subscription_tier IN ('free', 'premium', 'enterprise'));
  END IF;

  -- Add subscription_expires_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'subscription_expires_at'
  ) THEN
    ALTER TABLE users ADD COLUMN subscription_expires_at TIMESTAMPTZ;
  END IF;

  -- Add stripe_customer_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'stripe_customer_id'
  ) THEN
    ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
  END IF;

  -- Add stripe_subscription_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'stripe_subscription_id'
  ) THEN
    ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
  END IF;
END $$;

-- ============================================================================
-- STEP 5: Create function for atomic usage increment
-- ============================================================================
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_period_type TEXT,
  p_period_key TEXT,
  p_column_name TEXT,
  p_amount INTEGER DEFAULT 1
) RETURNS INTEGER AS $$
DECLARE
  v_current_value INTEGER;
BEGIN
  -- Insert or update with atomic increment
  INSERT INTO user_usage (user_id, period_type, period_key)
  VALUES (p_user_id, p_period_type, p_period_key)
  ON CONFLICT (user_id, period_type, period_key) DO NOTHING;

  -- Execute dynamic SQL for the increment
  EXECUTE format(
    'UPDATE user_usage SET %I = COALESCE(%I, 0) + $1, updated_at = NOW()
     WHERE user_id = $2 AND period_type = $3 AND period_key = $4
     RETURNING %I',
    p_column_name, p_column_name, p_column_name
  ) INTO v_current_value USING p_amount, p_user_id, p_period_type, p_period_key;

  RETURN v_current_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 6: Create function to get current usage
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_usage(
  p_user_id UUID,
  p_period_type TEXT,
  p_period_key TEXT
) RETURNS user_usage AS $$
DECLARE
  v_usage user_usage;
BEGIN
  SELECT * INTO v_usage
  FROM user_usage
  WHERE user_id = p_user_id
    AND period_type = p_period_type
    AND period_key = p_period_key;

  -- Return empty record with zeros if not found
  IF NOT FOUND THEN
    v_usage.user_id := p_user_id;
    v_usage.period_type := p_period_type;
    v_usage.period_key := p_period_key;
    v_usage.ai_generations_used := 0;
    v_usage.ai_regenerations_used := 0;
    v_usage.ai_assistant_messages_used := 0;
    v_usage.ai_tokens_used := 0;
    v_usage.places_autocomplete_used := 0;
    v_usage.places_search_used := 0;
    v_usage.places_details_used := 0;
  END IF;

  RETURN v_usage;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 7: Add comments for documentation
-- ============================================================================
COMMENT ON TABLE user_usage IS 'Tracks API usage per user for rate limiting and billing';
COMMENT ON COLUMN user_usage.period_type IS 'Type of period: monthly (for AI) or daily (for Places API)';
COMMENT ON COLUMN user_usage.period_key IS 'Period identifier: YYYY-MM for monthly, YYYY-MM-DD for daily';
COMMENT ON COLUMN user_usage.ai_generations_used IS 'Number of AI trip generations used this period';
COMMENT ON COLUMN user_usage.ai_regenerations_used IS 'Number of AI activity regenerations used this period';
COMMENT ON COLUMN user_usage.ai_assistant_messages_used IS 'Number of AI assistant messages used this period';
COMMENT ON COLUMN user_usage.places_autocomplete_used IS 'Number of Places autocomplete requests this period';
COMMENT ON COLUMN user_usage.places_search_used IS 'Number of Places search requests this period';
COMMENT ON COLUMN user_usage.places_details_used IS 'Number of Places details requests this period';

COMMENT ON FUNCTION increment_usage IS 'Atomically increment a usage counter and return new value';
COMMENT ON FUNCTION get_user_usage IS 'Get current usage for a user and period, returns zeros if no record';
