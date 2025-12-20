-- =====================================================
-- Activity Proposals System
-- =====================================================
-- This migration creates tables for collaborative activity proposals
-- allowing voters to suggest new activities or replacements for existing ones.
--
-- Dependencies:
--   - trips table (FK)
--   - auth.users (FK)
--   - user_can_access_trip function (RLS)
--   - user_can_vote function (RLS - reused for canSuggest)
--
-- Tables created:
--   1. activity_proposals - stores proposed activities
--   2. proposal_votes - stores votes on proposals
-- =====================================================

-- =====================================================
-- Table: activity_proposals
-- =====================================================
-- Stores activity proposals from collaborators.
-- Proposals go through: pending → voting → approved/rejected/withdrawn/expired

CREATE TABLE IF NOT EXISTS public.activity_proposals (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  proposed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Proposal type
  -- 'new': Add new activity to empty slot
  -- 'replacement': Replace existing activity
  type TEXT NOT NULL DEFAULT 'new'
    CHECK (type IN ('new', 'replacement')),

  -- The proposed activity (full Activity object as JSONB)
  -- Must contain at minimum: name, type, time_slot, start_time, duration_minutes
  activity_data JSONB NOT NULL,

  -- For replacement proposals: ID of activity to replace
  -- References activity.id in trips.itinerary JSONB
  target_activity_id TEXT,

  -- Slot targeting (where to place the activity)
  target_day INTEGER NOT NULL CHECK (target_day >= 0),
  target_time_slot TEXT CHECK (target_time_slot IN ('morning', 'afternoon', 'evening')),

  -- Optional note from proposer explaining why
  note TEXT,

  -- Lifecycle status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'voting', 'approved', 'rejected', 'withdrawn', 'expired')),

  -- Resolution details (filled when resolved)
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  resolution_method TEXT
    CHECK (resolution_method IS NULL OR resolution_method IN (
      'consensus',       -- Approved by group vote
      'owner_override',  -- Owner force-approved/rejected
      'auto_approve',    -- Auto-approved after timeout with positive score
      'timeout',         -- Expired without resolution
      'withdrawn'        -- Proposer withdrew
    )),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

-- Add table comment
COMMENT ON TABLE public.activity_proposals IS
  'Activity proposals from collaborators for group decision-making';

-- Add column comments
COMMENT ON COLUMN public.activity_proposals.type IS
  'Proposal type: new (add to slot) or replacement (replace existing)';
COMMENT ON COLUMN public.activity_proposals.activity_data IS
  'Full Activity object as JSONB containing name, type, description, etc.';
COMMENT ON COLUMN public.activity_proposals.target_activity_id IS
  'For replacement: references activity.id in trips.itinerary JSONB';
COMMENT ON COLUMN public.activity_proposals.target_day IS
  'Day index (0-based) for where to place the activity';
COMMENT ON COLUMN public.activity_proposals.target_time_slot IS
  'Time slot: morning, afternoon, or evening';

-- =====================================================
-- Indexes for activity_proposals
-- =====================================================

-- Index for fetching active proposals by trip (most common query)
CREATE INDEX IF NOT EXISTS idx_proposals_trip_active
  ON public.activity_proposals(trip_id, status)
  WHERE status IN ('pending', 'voting');

-- Index for fetching proposals by day (for slot grouping)
CREATE INDEX IF NOT EXISTS idx_proposals_trip_day
  ON public.activity_proposals(trip_id, target_day, target_time_slot);

-- Index for user's proposals
CREATE INDEX IF NOT EXISTS idx_proposals_proposed_by
  ON public.activity_proposals(proposed_by);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_proposals_expires
  ON public.activity_proposals(expires_at)
  WHERE status IN ('pending', 'voting');

-- =====================================================
-- Table: proposal_votes
-- =====================================================
-- Stores votes on proposals (simpler than activity_votes)
-- Vote types: approve or reject

CREATE TABLE IF NOT EXISTS public.proposal_votes (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  proposal_id UUID NOT NULL REFERENCES public.activity_proposals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Vote type (binary: approve or reject)
  vote_type TEXT NOT NULL DEFAULT 'approve'
    CHECK (vote_type IN ('approve', 'reject')),

  -- Optional comment (especially useful for reject votes)
  comment TEXT,

  -- For future tournament ranking (Phase 2)
  rank INTEGER,

  -- Timestamps
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One vote per user per proposal
  UNIQUE (proposal_id, user_id)
);

-- Add table comment
COMMENT ON TABLE public.proposal_votes IS
  'Votes on activity proposals for group decision-making';

-- Add column comments
COMMENT ON COLUMN public.proposal_votes.vote_type IS
  'Vote type: approve (+2 weight) or reject (-2 weight)';
COMMENT ON COLUMN public.proposal_votes.rank IS
  'Future: ranking preference for tournament voting (1 = first choice)';

-- =====================================================
-- Indexes for proposal_votes
-- =====================================================

-- Index for fetching votes by proposal (most common query)
CREATE INDEX IF NOT EXISTS idx_proposal_votes_proposal
  ON public.proposal_votes(proposal_id);

-- Index for user's votes across proposals
CREATE INDEX IF NOT EXISTS idx_proposal_votes_user
  ON public.proposal_votes(user_id);

-- =====================================================
-- Helper function: user_is_trip_owner
-- =====================================================
-- Check if a user is the owner of a trip
-- Used for RLS policies that need owner-only access

CREATE OR REPLACE FUNCTION public.user_is_trip_owner(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trips
    WHERE id = p_trip_id
    AND user_id = p_user_id
  );
$$;

COMMENT ON FUNCTION public.user_is_trip_owner IS
  'Check if user is the owner of a trip';

-- =====================================================
-- RLS Policies: activity_proposals
-- =====================================================

ALTER TABLE public.activity_proposals ENABLE ROW LEVEL SECURITY;

-- Policy: Trip members can view proposals
CREATE POLICY "Trip members can view proposals"
  ON public.activity_proposals
  FOR SELECT
  USING (public.user_can_access_trip(trip_id, auth.uid()));

-- Policy: Users who can vote/suggest can create proposals
-- Note: user_can_vote returns true for owner/editor/voter roles
-- This matches canSuggest permission in ROLE_PERMISSIONS
CREATE POLICY "Suggesters can create proposals"
  ON public.activity_proposals
  FOR INSERT
  WITH CHECK (
    proposed_by = auth.uid()
    AND public.user_can_vote(trip_id, auth.uid())
  );

-- Policy: Proposers can update their own proposals (withdraw only)
CREATE POLICY "Proposers can update own proposals"
  ON public.activity_proposals
  FOR UPDATE
  USING (
    proposed_by = auth.uid()
    AND status IN ('pending', 'voting')
  );

-- Policy: Trip owners can update any proposal (resolve)
CREATE POLICY "Owners can resolve proposals"
  ON public.activity_proposals
  FOR UPDATE
  USING (public.user_is_trip_owner(trip_id, auth.uid()));

-- Policy: Proposers can delete their own pending proposals
CREATE POLICY "Proposers can delete own pending proposals"
  ON public.activity_proposals
  FOR DELETE
  USING (
    proposed_by = auth.uid()
    AND status = 'pending'
  );

-- =====================================================
-- RLS Policies: proposal_votes
-- =====================================================

ALTER TABLE public.proposal_votes ENABLE ROW LEVEL SECURITY;

-- Policy: Trip members can view votes
-- Need to join through proposals to check trip access
CREATE POLICY "Trip members can view proposal votes"
  ON public.proposal_votes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.activity_proposals p
      WHERE p.id = proposal_id
      AND public.user_can_access_trip(p.trip_id, auth.uid())
    )
  );

-- Policy: Users who can vote can cast votes on proposals
CREATE POLICY "Voters can vote on proposals"
  ON public.proposal_votes
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.activity_proposals p
      WHERE p.id = proposal_id
      AND p.status IN ('pending', 'voting')
      AND public.user_can_vote(p.trip_id, auth.uid())
    )
  );

-- Policy: Users can update their own votes
CREATE POLICY "Users can update own proposal votes"
  ON public.proposal_votes
  FOR UPDATE
  USING (user_id = auth.uid());

-- Policy: Users can delete their own votes
CREATE POLICY "Users can delete own proposal votes"
  ON public.proposal_votes
  FOR DELETE
  USING (user_id = auth.uid());

-- =====================================================
-- Trigger: Update updated_at on proposals
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_proposal_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_proposal_updated_at
  BEFORE UPDATE ON public.activity_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_proposal_updated_at();

-- =====================================================
-- Trigger: Update updated_at on proposal_votes
-- =====================================================

CREATE TRIGGER trigger_proposal_vote_updated_at
  BEFORE UPDATE ON public.proposal_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_proposal_updated_at();

-- =====================================================
-- Trigger: Auto-transition proposal status when first vote
-- =====================================================
-- When the first vote is cast on a proposal, transition from 'pending' to 'voting'

CREATE OR REPLACE FUNCTION public.on_proposal_vote_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update proposal status to 'voting' if it's still 'pending'
  UPDATE public.activity_proposals
  SET status = 'voting'
  WHERE id = NEW.proposal_id
  AND status = 'pending';

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_proposal_vote_insert
  AFTER INSERT ON public.proposal_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.on_proposal_vote_insert();
