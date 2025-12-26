-- Migration: Add admin_grant_early_access function
-- Purpose: Allow admins to grant early access to users, bypassing RLS
--
-- To apply manually:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Paste this entire file
-- 3. Run

-- RPC function to grant early access (admin only, bypasses RLS)
-- SECURITY DEFINER runs with the privileges of the function owner (postgres)

CREATE OR REPLACE FUNCTION admin_grant_early_access(
  p_user_id UUID,
  p_code_id UUID,
  p_code_used TEXT,
  p_ai_generations_limit INT DEFAULT NULL,
  p_ai_regenerations_limit INT DEFAULT NULL,
  p_ai_assistant_limit INT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_granted_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access_id UUID;
BEGIN
  -- Insert the access record
  INSERT INTO user_tester_access (
    user_id,
    code_id,
    code_used,
    ai_generations_limit,
    ai_generations_used,
    ai_regenerations_limit,
    ai_regenerations_used,
    ai_assistant_limit,
    ai_assistant_used,
    expires_at,
    redeemed_at
  ) VALUES (
    p_user_id,
    p_code_id,
    p_code_used,
    p_ai_generations_limit,
    0,
    p_ai_regenerations_limit,
    0,
    p_ai_assistant_limit,
    0,
    p_expires_at,
    NOW()
  )
  RETURNING id INTO v_access_id;

  RETURN v_access_id;
END;
$$;

-- Grant execute permission to authenticated users (admin check is done in the API route)
GRANT EXECUTE ON FUNCTION admin_grant_early_access TO authenticated;

COMMENT ON FUNCTION admin_grant_early_access IS 'Admin-only function to grant early access to a user. Bypasses RLS via SECURITY DEFINER.';

-- Quick grant for Giulia (can be run immediately if function exists)
-- User ID: 94c67778-2acd-4b7b-8e6d-7ed8b0a23e3e
-- Code ID: a30a248d-7219-4164-be76-549af1e52870 (BETA2026)
/*
SELECT admin_grant_early_access(
  '94c67778-2acd-4b7b-8e6d-7ed8b0a23e3e'::UUID,  -- Giulia's user_id
  'a30a248d-7219-4164-be76-549af1e52870'::UUID,  -- BETA2026 code_id
  'BETA2026',
  NULL,  -- unlimited generations
  NULL,  -- unlimited regenerations
  NULL,  -- unlimited assistant
  '2026-02-28T00:00:00+00:00'::TIMESTAMPTZ  -- expires Feb 28, 2026
);
*/
