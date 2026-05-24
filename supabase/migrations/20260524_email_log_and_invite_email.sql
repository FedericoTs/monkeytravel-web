-- Email service scaffold — deliverability tracking + invite-by-email.
--
-- Pairs with lib/email/ (Resend client) and the existing notifications
-- scaffold (20260523_notifications_scaffold.sql).
--
-- DESIGN
--
-- email_log captures every send attempt — successful, suppressed, errored,
-- or skipped (no API key). Two reasons:
--   1. Deliverability tracking: bounce/complaint rates need a per-recipient
--      history to feed Resend's webhook handler. >2% bounce = throttled
--      sender; >0.1% complaints = suspended sender. We need to know.
--   2. Idempotency: cron retries and double-firing event hooks should never
--      double-send. The idempotency_key column + unique partial index
--      ensures one row per logical send.
--
-- trip_invites ALTER adds the single-recipient email path. NULL recipient_email
-- preserves the existing shareable-link semantics (anyone with the link can
-- redeem). When set, the invite is bound to that address.
--
-- ZERO RISK to existing flows: every new column is nullable / defaulted; the
-- new table is additive; no INSERT/UPDATE/DELETE policy changes on
-- trip_invites.

-- =====================================================
-- Table: email_log
-- =====================================================
CREATE TABLE IF NOT EXISTS public.email_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Recipient email address. Stored lowercase + trimmed; we enforce that
    -- in the send helper, not via DB constraint (some addresses are case-
    -- sensitive per RFC 5321 but practically nobody uses that).
    recipient_email TEXT NOT NULL,
    -- Template identifier. Free-form because a future template can be added
    -- without a schema change. The send helper enforces a known set.
    -- Examples: 'invite', 'vote_cast', 'comment_added', 'weekly_digest'.
    template_id TEXT NOT NULL,
    -- Provider message id (Resend returns one on success). NULL while the
    -- send is in-flight or if the send was skipped.
    message_id TEXT,
    -- Lifecycle status. The send helper sets one of these:
    --   'queued'      — row inserted, send not yet attempted
    --   'sent'        — provider accepted
    --   'skipped_no_key' — RESEND_API_KEY missing (dev / pre-launch)
    --   'skipped_disabled' — user's notification_settings opted out
    --   'skipped_suppressed' — recipient previously bounced/complained
    --   'failed'      — provider rejected; check error column
    -- A 'bounced' / 'complained' row is set asynchronously by the webhook
    -- handler (future) when Resend reports back.
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
        'queued', 'sent', 'skipped_no_key', 'skipped_disabled',
        'skipped_suppressed', 'failed', 'bounced', 'complained'
    )),
    sent_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    bounced_at TIMESTAMPTZ,
    complained_at TIMESTAMPTZ,
    -- Free-text error for failed sends. Truncate at insert time.
    error TEXT,
    -- Idempotency key for double-send prevention. The send helper builds
    -- this from (template_id + recipient + the source notification id) so
    -- "same notification, retried" dedupes; "different notification, same
    -- recipient + template" goes through (e.g. two separate vote events).
    idempotency_key TEXT,
    -- Loosely typed bag of template-specific context — useful for replay
    -- + debugging without joining back to the source notification.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.email_log IS
    'Outbound email lifecycle log. Service-role writes only; user reads own via recipient match.';

-- Partial unique index on idempotency_key — NULL keys (legacy / direct sends)
-- aren't deduped. Allows the same key to appear in the failure history
-- (status='failed') AND in a later retry (status='sent') because the
-- (key, status) tuple isn't constrained — only key alone, and only when
-- not in a terminal-failure status. Simplest workable approach: unique on
-- key when the send actually succeeded.
CREATE UNIQUE INDEX IF NOT EXISTS email_log_idempotency_sent_idx
    ON public.email_log (idempotency_key)
    WHERE idempotency_key IS NOT NULL AND status IN ('sent', 'queued');

-- Lookup-by-recipient (for bounce suppression + user-visible email history)
CREATE INDEX IF NOT EXISTS email_log_recipient_recent_idx
    ON public.email_log (recipient_email, created_at DESC);

-- RLS
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Users can see emails sent to their own address. We match on
-- auth.users.email — defense in depth: a user shouldn't be able to read
-- email logs for an address they don't own, even via a SQL injection
-- attempting to widen scope.
DROP POLICY IF EXISTS "email_log_select_own" ON public.email_log;
CREATE POLICY "email_log_select_own"
    ON public.email_log
    FOR SELECT
    USING (
        recipient_email = (
            SELECT email FROM auth.users WHERE id = auth.uid()
        )
    );

-- INSERT/UPDATE only via service role — no client should be able to
-- fabricate a send entry. The send helper uses the service-role client.

-- =====================================================
-- Table: trip_invites — ALTER for single-recipient email invites
-- =====================================================

-- Email address this invite was sent to. NULL = shareable link (existing
-- semantics: anyone with the URL can redeem subject to max_uses).
ALTER TABLE public.trip_invites
    ADD COLUMN IF NOT EXISTS recipient_email TEXT;

-- BCP-47 locale tag (en, es, it, etc.). Determines email language and the
-- invite-acceptance page locale. NULL = inviter's locale or app default.
ALTER TABLE public.trip_invites
    ADD COLUMN IF NOT EXISTS recipient_locale TEXT;

-- Optional personal message from the inviter, rendered inside the email
-- template above the trip summary. Limited to ~500 chars by the API.
ALTER TABLE public.trip_invites
    ADD COLUMN IF NOT EXISTS message TEXT;

COMMENT ON COLUMN public.trip_invites.recipient_email IS
    'Email this invite was sent to. NULL = shareable link (legacy semantics).';
COMMENT ON COLUMN public.trip_invites.recipient_locale IS
    'BCP-47 locale for the invite email + acceptance page. NULL = inviter locale.';
COMMENT ON COLUMN public.trip_invites.message IS
    'Optional personal note from inviter, rendered above the trip summary.';

-- Index for "find an invite by recipient" — useful for the future bounce
-- handler ("which invites need resending after the user verified their
-- email?") and for showing the inviter "you already sent this person an
-- invite" state. Partial so we don't index every shareable-link row.
CREATE INDEX IF NOT EXISTS trip_invites_recipient_email_idx
    ON public.trip_invites (recipient_email)
    WHERE recipient_email IS NOT NULL;
