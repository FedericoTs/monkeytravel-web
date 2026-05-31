-- Day-5 atomic dedupe for wizard_step_events.
--
-- Day-4 P2.6 fix shipped a SELECT-then-INSERT soft dedupe in
-- app/api/wizard-event/route.ts. Prod showed 3 sequential POSTs with the
-- same (session_id, step) within 1.14s all inserted — by the time each
-- request's SELECT ran, the prior INSERTs hadn't committed yet, so all
-- three saw "no recent row" and inserted.
--
-- Fix: DB-level UNIQUE constraint on (session_id, step, dedupe_bucket)
-- where dedupe_bucket is the integer floor of EXTRACT(EPOCH FROM
-- created_at). Two inserts in the same second collapse to the same
-- bucket; the unique index rejects the second.
--
-- Why a trigger-populated column and not a GENERATED column:
-- earlier attempt used GENERATED ALWAYS AS (FLOOR(EXTRACT(EPOCH FROM
-- created_at))) STORED. That fails because EXTRACT(EPOCH FROM ...) on
-- timestamptz is not IMMUTABLE — it depends on the session timezone.
-- Postgres rejects non-IMMUTABLE expressions in generated columns. A
-- BEFORE INSERT trigger has no such constraint.

ALTER TABLE public.wizard_step_events
    ADD COLUMN IF NOT EXISTS dedupe_bucket bigint;

-- Backfill existing rows so the unique index can build.
UPDATE public.wizard_step_events
    SET dedupe_bucket = FLOOR(EXTRACT(EPOCH FROM created_at))
    WHERE dedupe_bucket IS NULL;

-- Historical duplicate cleanup. The Day-4 soft-dedupe bug let multiple
-- rows land in the same (session_id, step, second) — 174 of them across
-- 88 duplicate groups in prod as of this migration. Without this DELETE,
-- the CREATE UNIQUE INDEX below would fail with SQLSTATE 23505 and the
-- entire migration would roll back.
--
-- Keep the earliest row per group (lowest created_at, tie-broken by id
-- ASC for determinism) — that's the "real" event; the rest were the
-- bug. Funnel arithmetic on this table is approximate anyway (PostHog
-- is the canonical product-analytics surface) so dropping 174/884 rows
-- (~20%) of historical noise is safe.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY session_id, step, dedupe_bucket
               ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM public.wizard_step_events
)
DELETE FROM public.wizard_step_events
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Trigger: populate dedupe_bucket on every insert. coalesce against
-- NOW() so an insert that omits created_at still gets a correct
-- bucket — reading NEW.created_at before the column default is applied
-- in the same row-build phase yields NULL.
CREATE OR REPLACE FUNCTION public.set_wizard_dedupe_bucket()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.dedupe_bucket := FLOOR(EXTRACT(EPOCH FROM coalesce(NEW.created_at, NOW())));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_wizard_dedupe_bucket ON public.wizard_step_events;
CREATE TRIGGER trg_set_wizard_dedupe_bucket
    BEFORE INSERT ON public.wizard_step_events
    FOR EACH ROW
    EXECUTE FUNCTION public.set_wizard_dedupe_bucket();

-- The atomic dedupe primitive. A second insert with the same
-- (session_id, step) in the same wall-clock second is rejected with
-- SQLSTATE 23505 — the application catches it and treats as success.
CREATE UNIQUE INDEX IF NOT EXISTS wizard_step_events_dedupe_idx
    ON public.wizard_step_events (session_id, step, dedupe_bucket);

COMMENT ON COLUMN public.wizard_step_events.dedupe_bucket IS
    'Integer second bucket populated by trg_set_wizard_dedupe_bucket. Forms the unique key (session_id, step, dedupe_bucket) that atomically dedupes sub-second duplicate inserts. Do not write from application code — the trigger owns this column.';
