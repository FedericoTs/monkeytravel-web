-- /explore UGC Trip Feed — Week 1 schema
--
-- Adds the engagement primitives (likes, saves, reports), the fork
-- relationship (parent_trip_id), the Editor's Picks flag, and a single
-- atomic-counter RPC per surface. Wires RLS so anon visitors can read
-- public trips + counts, authenticated users can like/save/fork, and
-- only owners can publish or hide.
--
-- Plan: docs/PLAN_EXPLORE_UGC_FEED.md
-- Decision log (locked 2026-05-25):
--   - Likes require auth (no anon likes — moderation simpler)
--   - Saves work for anon (cookie-keyed) + auth (user_id-keyed)
--   - Forks are public by default = NO (clone lands as private)
--   - Editor's Picks are algorithmic — daily cron writes is_editors_pick
--
-- Idempotency: like/save/report each have a UNIQUE that prevents double-
-- inserts; the atomic counters fire only on successful insert (caller
-- responsibility) so a duplicated like doesn't double-count.

-- ===========================================================
-- 1. trips ALTER — engagement counters + fork pointer + Editor's flag
-- ===========================================================
-- All NOT NULL DEFAULTs so existing rows backfill instantly.
-- `author_display_name` + `author_note` are user-set strings that
-- surface on /explore cards; deliberately separate from user profile
-- so users can curate per-trip narrative.

ALTER TABLE public.trips
    ADD COLUMN IF NOT EXISTS parent_trip_id      UUID REFERENCES public.trips(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS like_count          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS save_count          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fork_count          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS author_display_name TEXT,
    ADD COLUMN IF NOT EXISTS author_note         TEXT,
    ADD COLUMN IF NOT EXISTS reported_count      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_hidden           BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_editors_pick     BOOLEAN NOT NULL DEFAULT false;

-- 280 chars matches Twitter convention + fits cleanly on the card
-- without truncation. Enforced via constraint so the API doesn't have
-- to second-guess.
ALTER TABLE public.trips
    DROP CONSTRAINT IF EXISTS trips_author_note_length,
    ADD  CONSTRAINT trips_author_note_length
         CHECK (author_note IS NULL OR length(author_note) <= 280);

ALTER TABLE public.trips
    DROP CONSTRAINT IF EXISTS trips_author_display_name_length,
    ADD  CONSTRAINT trips_author_display_name_length
         CHECK (author_display_name IS NULL OR length(author_display_name) <= 80);

-- Fork lookup: "how many trips forked from this one" and "what's the
-- ancestry of this trip." Partial index — most trips have no parent.
CREATE INDEX IF NOT EXISTS idx_trips_parent_trip_id
    ON public.trips(parent_trip_id) WHERE parent_trip_id IS NOT NULL;

-- Editor's Picks browse — small set, hot read path on /explore.
CREATE INDEX IF NOT EXISTS idx_trips_editors_pick
    ON public.trips(is_editors_pick, trending_score DESC)
    WHERE is_editors_pick = true;

-- Hidden trips never appear in any public surface. Most trips won't be
-- hidden so partial index keeps the maintenance cost trivial.
CREATE INDEX IF NOT EXISTS idx_trips_visible_public
    ON public.trips(visibility, shared_at DESC)
    WHERE visibility = 'public' AND is_hidden = false;

COMMENT ON COLUMN public.trips.parent_trip_id IS
    'When a user forks a public trip, the new trip stores the source trip id here. ON DELETE SET NULL so forks survive parent deletion (but lose attribution). NULL for original trips.';
COMMENT ON COLUMN public.trips.like_count IS
    'Materialized count of rows in trip_likes for this trip. Maintained by increment_trip_like_count / decrement_trip_like_count RPCs.';
COMMENT ON COLUMN public.trips.save_count IS
    'Materialized count of rows in trip_saves for this trip. Maintained by increment_trip_save_count / decrement_trip_save_count RPCs.';
COMMENT ON COLUMN public.trips.fork_count IS
    'Materialized count of trips with parent_trip_id = this trip''s id. Maintained by increment_trip_fork_count on /api/trips/[id]/fork.';
COMMENT ON COLUMN public.trips.author_display_name IS
    'Per-trip pen name shown on /explore cards. Falls back to "Anonymous traveler" in the UI. Max 80 chars.';
COMMENT ON COLUMN public.trips.author_note IS
    'Optional user-set blurb (max 280 chars) that explains the trip''s angle ("Honeymoon, prioritized hidden gems"). Shown under the title on /explore + /shared/[token].';
COMMENT ON COLUMN public.trips.reported_count IS
    'Number of rows in trip_reports for this trip. Auto-hide threshold (5) implemented in /api/trips/[id]/report.';
COMMENT ON COLUMN public.trips.is_hidden IS
    'Soft-delete flag — true means the trip is removed from every public surface (still readable by owner). Set by moderation or by auto-hide.';
COMMENT ON COLUMN public.trips.is_editors_pick IS
    'Algorithmic flag — written by app/api/cron/recompute-editors-picks daily. True when age >= 7d AND fork_count >= 5 AND trending_score >= 50.';


-- ===========================================================
-- 2. trip_likes — authenticated 1-per-user-per-trip
-- ===========================================================
-- Likes require auth. Anon visitors can save (cookie-keyed) but not
-- like. Rationale: likes are a public engagement signal; saves are a
-- private "for later" list. Anon likes would need cookie dedup logic
-- with no real abuse benefit.

CREATE TABLE IF NOT EXISTS public.trip_likes (
    trip_id    UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_likes_trip_recent
    ON public.trip_likes(trip_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trip_likes_user
    ON public.trip_likes(user_id, created_at DESC);

ALTER TABLE public.trip_likes ENABLE ROW LEVEL SECURITY;

-- Public read so /explore can show the avatar cluster without
-- auth. The trip itself must be visibility=public for likes to be
-- exposed (filtered at the API layer via a join).
DROP POLICY IF EXISTS trip_likes_public_read ON public.trip_likes;
CREATE POLICY trip_likes_public_read ON public.trip_likes
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS trip_likes_self_insert ON public.trip_likes;
CREATE POLICY trip_likes_self_insert ON public.trip_likes
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS trip_likes_self_delete ON public.trip_likes;
CREATE POLICY trip_likes_self_delete ON public.trip_likes
    FOR DELETE
    USING (auth.uid() = user_id);

COMMENT ON TABLE public.trip_likes IS
    'Public engagement: authenticated user has expressed approval of a trip. One row per (trip,user). RLS: anyone reads; only the liker inserts/deletes their own row.';


-- ===========================================================
-- 3. trip_saves — "for later" list, works for anon + auth
-- ===========================================================
-- Anon: cookie id (set by middleware as `mt_saver_cookie`, httpOnly,
-- 1-year expiry). Auth: user_id. CHECK constraint enforces exactly
-- one of them is non-null per row.
--
-- Anon saves are inserted by the service-role API route — RLS won't
-- match an anon JWT against a cookie. Auth saves can go either via
-- the API or directly via Supabase client.

CREATE TABLE IF NOT EXISTS public.trip_saves (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id         UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    saver_cookie_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT trip_saves_one_owner CHECK (
        (user_id IS NOT NULL AND saver_cookie_id IS NULL) OR
        (user_id IS NULL     AND saver_cookie_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_trip_saves_user
    ON public.trip_saves(trip_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_trip_saves_cookie
    ON public.trip_saves(trip_id, saver_cookie_id)
    WHERE saver_cookie_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trip_saves_user
    ON public.trip_saves(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trip_saves_cookie
    ON public.trip_saves(saver_cookie_id, created_at DESC)
    WHERE saver_cookie_id IS NOT NULL;

ALTER TABLE public.trip_saves ENABLE ROW LEVEL SECURITY;

-- Saves are private to the saver. The owner doesn't need to see who
-- saved their trip (use save_count for the aggregate signal).
DROP POLICY IF EXISTS trip_saves_self_read ON public.trip_saves;
CREATE POLICY trip_saves_self_read ON public.trip_saves
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS trip_saves_self_insert ON public.trip_saves;
CREATE POLICY trip_saves_self_insert ON public.trip_saves
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS trip_saves_self_delete ON public.trip_saves;
CREATE POLICY trip_saves_self_delete ON public.trip_saves
    FOR DELETE
    USING (auth.uid() = user_id);

-- Anon save path goes through /api/trips/[id]/save (service-role) so
-- RLS doesn't need an anon policy.

COMMENT ON TABLE public.trip_saves IS
    'Private "for later" list per user OR per anonymous cookie. Exactly one of user_id/saver_cookie_id is set. Anon path uses the service-role API; auth path can use the Supabase client directly.';


-- ===========================================================
-- 4. trip_reports — abuse queue
-- ===========================================================
-- Lightweight in v1. Daily digest goes to moderation@. Auto-hide at
-- reported_count >= 5 happens in /api/trips/[id]/report.

CREATE TABLE IF NOT EXISTS public.trip_reports (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id          UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    reporter_ip      TEXT,
    reporter_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reason           TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at      TIMESTAMPTZ,
    resolved_by      UUID REFERENCES auth.users(id),
    action_taken     TEXT
);

CREATE INDEX IF NOT EXISTS idx_trip_reports_unresolved
    ON public.trip_reports(created_at DESC)
    WHERE resolved_at IS NULL;

-- Per-IP rate limit lives in the API route, not the DB. But this index
-- supports the "how many reports has this IP filed in the last 24h" check.
CREATE INDEX IF NOT EXISTS idx_trip_reports_ip_recent
    ON public.trip_reports(reporter_ip, created_at DESC)
    WHERE reporter_ip IS NOT NULL;

ALTER TABLE public.trip_reports ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE policies = nobody can touch this table
-- except service_role. Reports go through the API only, and the
-- moderation digest reads via service_role too.

COMMENT ON TABLE public.trip_reports IS
    'Abuse reports against public trips. Service-role only. Anon reports identified by IP; auth reports also stamp reporter_user_id. Auto-hide threshold (5) implemented in the API.';


-- ===========================================================
-- 5. Atomic counter RPCs
-- ===========================================================
-- Follow the same pattern as increment_template_copy_count (see
-- 20260524_atomic_counters.sql). One UPDATE per call, SECURITY DEFINER
-- so callers don't need elevated privileges to bump the counter.
--
-- IMPORTANT: callers must insert the trip_likes / trip_saves row FIRST,
-- then call the RPC. If the insert fails (unique violation = duplicate
-- like), the RPC must NOT be called. The API routes own this contract.

CREATE OR REPLACE FUNCTION public.increment_trip_like_count(p_trip_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE public.trips
    SET like_count = COALESCE(like_count, 0) + 1
    WHERE id = p_trip_id
    RETURNING like_count INTO new_count;
    -- Also bump trending_score (function already exists).
    PERFORM update_trip_trending_score(p_trip_id);
    RETURN COALESCE(new_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_trip_like_count(p_trip_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE public.trips
    SET like_count = GREATEST(0, COALESCE(like_count, 0) - 1)
    WHERE id = p_trip_id
    RETURNING like_count INTO new_count;
    PERFORM update_trip_trending_score(p_trip_id);
    RETURN COALESCE(new_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_trip_save_count(p_trip_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE public.trips
    SET save_count = COALESCE(save_count, 0) + 1
    WHERE id = p_trip_id
    RETURNING save_count INTO new_count;
    PERFORM update_trip_trending_score(p_trip_id);
    RETURN COALESCE(new_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_trip_save_count(p_trip_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE public.trips
    SET save_count = GREATEST(0, COALESCE(save_count, 0) - 1)
    WHERE id = p_trip_id
    RETURNING save_count INTO new_count;
    PERFORM update_trip_trending_score(p_trip_id);
    RETURN COALESCE(new_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_trip_fork_count(p_trip_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE public.trips
    SET fork_count = COALESCE(fork_count, 0) + 1
    WHERE id = p_trip_id
    RETURNING fork_count INTO new_count;
    PERFORM update_trip_trending_score(p_trip_id);
    RETURN COALESCE(new_count, 0);
END;
$$;

-- Anon + auth callers all hit these. RLS on the parent row still
-- gates whether they can see the result.
GRANT EXECUTE ON FUNCTION public.increment_trip_like_count(UUID)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_trip_like_count(UUID)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_trip_save_count(UUID)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_trip_save_count(UUID)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_trip_fork_count(UUID)  TO authenticated, service_role;

COMMENT ON FUNCTION public.increment_trip_like_count IS
    'Atomic +1 on trips.like_count + trending_score recompute. Called by POST /api/trips/[id]/like AFTER the trip_likes insert succeeds.';
COMMENT ON FUNCTION public.decrement_trip_like_count IS
    'Atomic -1 on trips.like_count + trending_score recompute. Called by DELETE /api/trips/[id]/like AFTER the trip_likes delete succeeds.';
COMMENT ON FUNCTION public.increment_trip_save_count IS
    'Atomic +1 on trips.save_count + trending_score recompute. Called by POST /api/trips/[id]/save AFTER the trip_saves insert succeeds.';
COMMENT ON FUNCTION public.decrement_trip_save_count IS
    'Atomic -1 on trips.save_count + trending_score recompute. Called when a save is removed.';
COMMENT ON FUNCTION public.increment_trip_fork_count IS
    'Atomic +1 on trips.fork_count + trending_score recompute. Called by POST /api/trips/[id]/fork AFTER the new trip row is created with parent_trip_id set.';


-- ===========================================================
-- 6. Trending score formula update — include likes + saves + forks
-- ===========================================================
-- Original formula (see 20260218_security_fix_search_paths...):
--   (template_copy_count * 10) + view_count + max(0, 100 - days_since_shared)
--
-- New formula adds the UGC engagement signals:
--   (fork_count * 10) + (like_count * 3) + (save_count * 1)
--     + view_count + max(0, 100 - days_since_shared)
--
-- We keep the template_copy_count weighting too because legacy templates
-- still use it. New UGC trips will mostly use fork_count.

CREATE OR REPLACE FUNCTION public.update_trip_trending_score(p_trip_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_score INTEGER;
BEGIN
    UPDATE public.trips
    SET trending_score =
            (COALESCE(template_copy_count, 0) * 10)
          + (COALESCE(fork_count, 0)          * 10)
          + (COALESCE(like_count, 0)          *  3)
          + (COALESCE(save_count, 0)          *  1)
          +  COALESCE(view_count, 0)
          +  GREATEST(0, 100 - GREATEST(0,
                EXTRACT(EPOCH FROM (now() - COALESCE(shared_at, created_at))) / 86400
             )::INTEGER)
    WHERE id = p_trip_id
    RETURNING trending_score INTO v_score;
    RETURN COALESCE(v_score, 0);
END;
$$;

COMMENT ON FUNCTION public.update_trip_trending_score IS
    'Recomputes trending_score = template_copy_count*10 + fork_count*10 + like_count*3 + save_count + view_count + recency_boost. Called from every engagement RPC + the view-count trigger.';


-- ===========================================================
-- 7. trips RLS — make sure public reads work for explore
-- ===========================================================
-- The existing visibility='public' read policy may already cover this,
-- but we're explicit here so the explore feed contract is unambiguous.
-- Existing policies (private/shared via collaborators/share_token) are
-- not touched.

DROP POLICY IF EXISTS trips_explore_public_read ON public.trips;
CREATE POLICY trips_explore_public_read ON public.trips
    FOR SELECT
    TO anon, authenticated
    USING (
        visibility = 'public'
        AND share_token IS NOT NULL
        AND is_hidden = false
    );

COMMENT ON POLICY trips_explore_public_read ON public.trips IS
    'Public trips (opt-in via /publish) are readable by anyone. is_hidden flag (set by moderation or auto-hide) removes them from this policy.';
