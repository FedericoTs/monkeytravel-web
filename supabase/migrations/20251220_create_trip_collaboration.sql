-- Migration: Create Trip Collaboration Tables
-- Applied via Supabase MCP on 2025-12-20
-- Tables: trip_collaborators, trip_invites

-- =====================================================
-- Table: trip_invites
-- =====================================================
CREATE TABLE IF NOT EXISTS trip_invites (
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

COMMENT ON TABLE trip_invites IS 'Shareable invite links for collaborative trip access';
COMMENT ON COLUMN trip_invites.role IS 'Role assigned to users who accept this invite';
COMMENT ON COLUMN trip_invites.max_uses IS 'Maximum number of times this invite can be used (1 = single use)';

-- RLS for trip_invites
ALTER TABLE trip_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view invites" ON trip_invites FOR SELECT USING (true);

CREATE POLICY "Trip owners can create invites" ON trip_invites
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND t.user_id = auth.uid())
  );

CREATE POLICY "Trip owners can update invites" ON trip_invites
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND t.user_id = auth.uid())
  );

CREATE POLICY "Trip owners can delete invites" ON trip_invites
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND t.user_id = auth.uid())
  );

-- =====================================================
-- Table: trip_collaborators
-- =====================================================
CREATE TABLE IF NOT EXISTS trip_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'voter', 'viewer')),
  invited_by UUID REFERENCES auth.users(id),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(trip_id, user_id)
);

COMMENT ON TABLE trip_collaborators IS 'Users who can access and collaborate on a trip';
COMMENT ON COLUMN trip_collaborators.role IS 'Permission level: owner (full control), editor (can edit), voter (can vote/suggest), viewer (read-only)';

CREATE INDEX IF NOT EXISTS idx_trip_collaborators_trip ON trip_collaborators(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_user ON trip_collaborators(user_id);

-- RLS for trip_collaborators
-- IMPORTANT: Avoid self-referencing policies to prevent infinite recursion
ALTER TABLE trip_collaborators ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can view collaborators (simple, no recursion)
CREATE POLICY "Authenticated users can view collaborators" ON trip_collaborators
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Trip owners can insert collaborators (references trips table only)
CREATE POLICY "Trip owners can insert collaborators" ON trip_collaborators
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_id AND trips.user_id = auth.uid())
  );

-- Trip owners can update collaborators
CREATE POLICY "Trip owners can update collaborators" ON trip_collaborators
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_id AND trips.user_id = auth.uid())
  );

-- Trip owners can delete collaborators
CREATE POLICY "Trip owners can delete collaborators" ON trip_collaborators
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_id AND trips.user_id = auth.uid())
  );

-- =====================================================
-- Update trips table RLS for collaborator access
-- =====================================================
-- Note: These policies are applied in 20260112_sync_referral_and_collaboration_fields migration
-- to allow idempotent application (checks if collaborator access already exists)

-- trips_select: Allow collaborators to view trips they're part of
-- trips_update: Allow editors to update trips
-- See: sync_referral_and_collaboration_fields migration for implementation
