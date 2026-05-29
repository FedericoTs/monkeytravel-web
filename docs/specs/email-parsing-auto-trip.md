# Email Parsing — Auto-Add Booking Confirmations (Gmail + Outlook)

## TL;DR
Let users connect Gmail or Outlook (read-only, scoped to confirmation-shaped messages) so monkeytravel.app automatically extracts hotel/flight/Airbnb/tour bookings and attaches them to the matching trip — or creates the trip when one doesn't exist. This is the moat: every booking the user already has becomes trip state without lifting a finger, so monkeytravel becomes the single canvas for travel instead of a planner they abandon after booking elsewhere.

## Problem & User Pain
- **Job-to-be-done:** "I booked five things across four sites for my Lisbon trip. I want one place that shows what I actually booked — without copy-pasting from six emails."
- **Current workaround:** Users screenshot confirmations into Notes, forward them to a Google Doc, or bounce — they generate a free itinerary, then never return because their *real* bookings live in their inbox. PostHog funnel (task #1) shows 78% of saved trips never see a second session.
- **Quantified pain:** Average leisure traveler receives 8–15 confirmation emails per trip. Today monkeytravel sees none, so the trip view is stale within 24h of save — explaining the day-2 retention cliff. Without this, monkeytravel is a brochure generator; with it, it's the only place a user's actual itinerary lives, which unlocks #220/#221/#222.

## Success Metrics
- **Primary:** % of saved trips with ≥1 auto-attached booking within 7 days of save. Target 35% (matches Tripit's parse-hit rate; we accept lower at MVP because we only parse 6 senders).
- **Secondary:**
  - Day-7 retention for users who connect mailbox: target +18pp vs unconnected (Tripit benchmark).
  - Median time from confirmation-email-receipt to booking-row-created: <15 minutes.
  - Auto-trip-create rate: % of incoming confirmations that land on a *new* trip (no match) vs an existing trip. Calibration signal — too high (>40%) means trip-matching is broken.
  - Parse success rate per sender: ≥92% of detected confirmations produce a `booking` row (rest become `parse_failed` for triage).
- **Anti-metrics (would hate to see):**
  - Wrong-trip attachments >2% (worse than no parse — destroys trust).
  - Mailbox-disconnect rate within 7 days of connect >15% (means we're noisy or creepy).
  - Sentry `email_parser.permission_revoked` spikes (signals privacy panic).
  - LLM cost per active connected user >$0.50/month.

## User Flow (happy path)
1. **Discovery** — On `/trips/[id]` and `/profile`, a card: "Auto-import your bookings — connect Gmail." Click reveals the privacy preamble.
2. **Privacy preamble (required modal)** — Plain copy: "monkeytravel will scan your inbox **only** for confirmations from Booking.com, Expedia, Airbnb, Hostelworld, GetYourGuide, and major airlines. We never read personal emails or store full email bodies. Disconnect anytime; we delete everything within 24 hours." Buttons: Connect Gmail / Connect Outlook / Maybe later. Required pre-OAuth; copy translated en/it/es.
3. **OAuth consent** — Google/Microsoft consent screen (narrowest scope, see Technical). Redirect to `/profile/integrations?status=connected`.
4. **Initial backfill** — Toast "Scanning your last 90 days…" — background job runs. Completion via in-app bell + transactional email (`lib/email/send.ts` template `mailbox_backfill_complete`): "We found 12 bookings across 3 trips."
5. **Confirmation review** — `/profile/integrations/inbox` lists detected bookings: auto-attached (green check + trip), suggested new trip (amber + "Create trip"), needs review (gray). User can override any auto-attachment.
6. **Ongoing** — New confirmations processed via Gmail push (`watch`) or Outlook webhooks within ~5 min of arrival. On match, in-app notification + badge on trip card.
7. **Disconnect** — `/profile/integrations` → confirmation → tokens revoked at provider, row hard-deleted, `raw_extracted_data` purged. Booking rows remain — user owns them.

## Edge Cases & Failure Modes
- **No matching trip:** Lands in "needs review" with "Create trip from this booking" CTA pre-filling `/trips/new`.
- **Multiple matching trips:** Start-date proximity wins (booking date inside trip range). If still ambiguous, surface in review queue.
- **Language variants:** Per-sender parsers handle `en/it/es/fr` template variants; fallback to LLM if regex confidence <0.8.
- **OAuth revoked at provider:** Watch fires 410 → mark `status='revoked'`, send transactional re-connect email, stop polling.
- **Gmail quota exceeded:** Exponential backoff; `createRateLimiter(\`gmail-api-${user_id}\`, 250, 1_000)` (Gmail's per-user limit). Sentry tag `source=email_parser, limit=gmail_per_user`.
- **LLM hallucination:** Cross-check extracted date against email `Date:` header — delta >365 days → `parse_failed`, never auto-attach.
- **Power traveler with 2,000 emails:** Cap backfill at 500 most recent confirmation-shaped messages.
- **Shared inbox:** Privacy preamble warns "Connect only an inbox you control" — can't prevent technically.
- **Phishing pretending to be Booking.com:** Validate DKIM/SPF via Gmail's `Authentication-Results` header; reject if not aligned. Never trust `From:` alone.
- **Cancellation emails:** Detect "cancelled / annullato / cancelado / annulé" → flip existing row's status, never delete.

## Technical Architecture

### Data model — new tables (`supabase/migrations/20260601_mailbox_integration.sql`)

```sql
CREATE TABLE public.mailbox_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail','outlook')),
  email_address TEXT NOT NULL,
  access_token TEXT NOT NULL,            -- pgsodium-encrypted
  refresh_token TEXT NOT NULL,           -- pgsodium-encrypted
  token_expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT[] NOT NULL,
  history_id TEXT,                       -- Gmail historyId / Graph deltaToken
  watch_expires_at TIMESTAMPTZ,          -- Gmail watch resub deadline
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked','error')),
  last_synced_at TIMESTAMPTZ, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, email_address)
);
ALTER TABLE public.mailbox_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY mb_self_read   ON public.mailbox_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY mb_self_delete ON public.mailbox_connections FOR DELETE USING (auth.uid() = user_id);
-- INSERT/UPDATE: service_role only.

CREATE TABLE public.trip_external_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  mailbox_connection_id UUID REFERENCES public.mailbox_connections(id) ON DELETE SET NULL,
  source TEXT NOT NULL,                  -- 'booking.com','airbnb','airline:ITA',...
  source_message_id TEXT NOT NULL,       -- dedupe key
  booking_type TEXT NOT NULL CHECK (booking_type IN ('lodging','flight','activity','transport','car','other')),
  booking_reference TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','pending_review','parse_failed')),
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
  destination_city TEXT, destination_country TEXT, destination_lat DOUBLE PRECISION, destination_lng DOUBLE PRECISION,
  title TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_extracted_data JSONB,              -- purged on disconnect
  email_subject TEXT, email_received_at TIMESTAMPTZ NOT NULL,
  auto_attached BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_message_id)
);
CREATE INDEX idx_teb_user_trip ON public.trip_external_bookings(user_id, trip_id, starts_at);
CREATE INDEX idx_teb_unattached ON public.trip_external_bookings(user_id, status)
  WHERE trip_id IS NULL AND status IN ('confirmed','pending_review');
ALTER TABLE public.trip_external_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY teb_self_all ON public.trip_external_bookings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Plus an atomic `attach_booking_to_trip(p_booking_id, p_trip_id, p_user_id)` RPC mirroring the explore-feed pattern in `supabase/migrations/20260525_explore_ugc_feed.sql` (SECURITY DEFINER, single UPDATE guarded by `WHERE trip_id IS NULL`). Tokens encrypted at rest with `pgsodium` (Supabase Vault); plaintext only in parser-worker memory.

### API surface
- `GET  /api/integrations/mailbox/connect?provider=gmail|outlook` — builds OAuth URL with PKCE, sets state cookie, redirects.
- `GET  /api/integrations/mailbox/callback` — exchanges code, encrypts+stores tokens, registers Gmail `watch` / Graph subscription, enqueues backfill job, redirects to `/profile/integrations?status=connected`.
- `POST /api/integrations/mailbox/disconnect` — revokes at provider, deletes row + `raw_extracted_data` purge.
- `POST /api/webhooks/gmail` — receives Pub/Sub push (Gmail's only push transport); validates Google-signed JWT in `Authorization` header; enqueues delta sync.
- `POST /api/webhooks/outlook` — receives Graph change notification, validates `validationToken` handshake, enqueues delta sync.
- `POST /api/cron/mailbox-sync` — Vercel Cron, every 15 min: refreshes tokens nearing expiry, re-subscribes Gmail watches (Gmail watch expires after 7 days), retries `status='error'` rows.
- `GET  /api/integrations/mailbox/bookings` — paginated list for `/profile/integrations/inbox` review UI.
- `POST /api/integrations/mailbox/bookings/[id]/attach` — body `{ tripId }` → calls `attach_booking_to_trip` RPC.
- `POST /api/integrations/mailbox/bookings/[id]/dismiss` → soft-discards.

Request/response shapes follow `lib/api/response-wrapper.ts` `apiSuccess` / `errors.*`.

### Key components (file paths)
- `app/[locale]/profile/integrations/page.tsx` — server component; lists `mailbox_connections` via `getAuthenticatedUser()`.
- `app/[locale]/profile/integrations/inbox/page.tsx` — review queue.
- `components/integrations/MailboxConnectCard.tsx` — props `{ provider: 'gmail'|'outlook'; connected: boolean; emailAddress?: string; onDisconnect: () => void; locale: string }`. OAuth start goes through `lib/native/external-link.openExternal()` so Capacitor doesn't trap it in WebView (task #172).
- `components/integrations/PrivacyPreambleModal.tsx` — on `BaseModal`. Copy in new `messages/{en,it,es}/integrations.json` namespace.
- `components/integrations/BookingReviewList.tsx` — props `{ bookings: ExternalBooking[]; userTrips: TripSummary[]; onAttach, onCreateTrip, onDismiss }`.
- `lib/integrations/mailbox/{gmail,outlook}/client.ts` — thin `fetch` wrappers (no `googleapis` SDK — 6 MB+ for 3 endpoints).
- `lib/integrations/mailbox/parsers/index.ts` — sender → parser registry; `lib/integrations/mailbox/parsers/llm-fallback.ts` — Gemini structured-output extractor.
- `lib/integrations/mailbox/match.ts` — trip-match algorithm (destination + date overlap).

### External integrations (specific SDK choices)
- **Gmail API:** Plain `fetch` to `gmail.googleapis.com/gmail/v1/users/me/...`. Refresh via `google-auth-library` (lightweight).
- **Microsoft Graph:** Plain `fetch` to `graph.microsoft.com/v1.0/me/messages`.
- **Gmail push:** Google Pub/Sub topic → push subscription to `/api/webhooks/gmail`. Validated via signed JWT (`OAuth2Client.verifyIdToken`).
- **Outlook push:** Graph subscription renewed <3-day expiry via cron.
- **LLM fallback:** Gemini 2.0 Flash via existing `lib/gemini.ts` with `responseMimeType: 'application/json'` + `responseSchema` (mirrors `lib/gemini-vision.ts`). Flash chosen for cost + structured output.
- **Job queue:** Postgres-backed `mailbox_sync_jobs` table + Vercel Cron polling every minute. Avoids QStash/Inngest at MVP.

### OAuth scopes (critical)
- **Gmail:** `gmail.metadata` returns headers only (no body) — insufficient for PNR/date extraction. Request **`gmail.readonly`**, but ALL API calls are scoped with `q="from:(booking.com OR expedia.com OR airbnb.com OR hostelworld.com OR getyourguide.com OR @ita-airways.com OR @united.com OR @aa.com OR @ryanair.com OR @easyjet.com) newer_than:90d"`. Triggers CASA tier-2 verification (~2-week lead time) — file early.
- **Outlook:** `Mail.Read` (delegated, per-user). `Mail.ReadBasic` returns metadata only — insufficient.

### Parsing strategy — recommendation
**Hybrid (regex-first per sender, LLM fallback).** Pure LLM costs more and hallucinates dates 3–5% (unacceptable). Pure regex breaks on sender A/B tests. Hybrid: regex covers ~85% of volume at $0 marginal cost; Gemini Flash handles the rest at ~$0.0002/email.

Per-sender regex targets sender-specific signals (Booking.com `Confirmation number: (\d+)` + `Check-in:`; Expedia `Itinerary number:`; Airbnb subject `Reservation confirmed for {city}` + body `arrive:`/`depart:`; GetYourGuide iCal attachment; Hostelworld order ID; airlines PNR `[A-Z0-9]{6}` + flight `[A-Z]{2}\d{2,4}`). Each parser returns `{ confidence, normalized, raw }`. Confidence <0.8 → LLM fallback with `responseSchema` mirroring `details_json`, validated by `zod` before insert. Cancellation keywords (`cancelled|annullato|cancelado|annulé`) flip the existing referenced row's status — never create a new one.

### Caching strategy
- Per-message dedupe via schema `UNIQUE (user_id, source_message_id)`.
- Per-user Gmail historyId on `mailbox_connections.history_id` → delta sync only.
- Sender-template-hash cache (`mailbox_parser_cache`) so parser changes re-parse only affected emails.

### Observability
- Sentry: tags `source=email_parser, provider, sender, stage` (fetch|parse|match|attach). Mirrors `lib/email/send.ts` `captureToSentry`.
- PostHog events: `mailbox_connect_initiated/completed`, `mailbox_backfill_completed { scanned, extracted, matched, suggested }`, `booking_auto_attached { source, booking_type }`, `booking_attachment_overridden { source }` (anti-metric), `mailbox_disconnected`.
- Structured logs: `{ ts, user_id, mailbox_connection_id, message_id, sender, stage, duration_ms, outcome }`. Never log body or PII.

### Security review
- **Auth:** all API routes use `getAuthenticatedUser()`; webhook routes validate provider-signed JWT/token pre-work.
- **RLS:** all new tables `auth.uid() = user_id`; service_role only for token writes.
- **Rate limits:** `createRateLimiter("mailbox-connect", 5, 60_000)` per IP; `gmail-api-${user_id}` 250/sec (Gmail quota).
- **CSRF:** OAuth state cookie HttpOnly+SameSite=Lax verified on callback.
- **CSP:** add `accounts.google.com` + `login.microsoftonline.com` to `connect-src` in `lib/security/csp.ts`.
- **PII minimization:** never store email body. `raw_extracted_data` holds only parsed fields; purged on disconnect.
- **Token storage:** pgsodium symmetric encryption, key in Vault. Plaintext only in parser worker memory.
- **Disconnect = real revoke:** `oauth2.googleapis.com/revoke` + Graph `DELETE /me/messageSubscriptions/{id}`.

## Implementation Phases

**Phase 1 — MVP (2 weeks, behind `mailbox_integration` PostHog flag, internal/beta only):** Gmail only; 3 senders (Booking.com, Airbnb, Expedia); regex parsers; backfill 90d/cap 500; daily cron pull (no push); review-queue only, no auto-attach. Migrations applied; Google OAuth client in Testing mode (≤100 users).

**Phase 2 — Polish (1 week):** Gmail push (Pub/Sub + watch, ~5-min freshness); Outlook OAuth + Graph subscriptions; LLM fallback for confidence <0.8; auto-attach when single candidate trip with date+destination overlap; +3 senders (Hostelworld, GetYourGuide, 3 airlines); translations en/it/es; E2E `tests/e2e/integrations-mailbox.spec.ts` with mocked Gmail; run `scripts/verify-deploy-smoke.sh`.

**Phase 3 — Optimization (ongoing):** Complete CASA verification → out of Testing mode; calibrate auto-attach via `booking_attachment_overridden`; senders 7–15 (Trip.com, VRBO, Klook, Viator, airlines); cancellation → trip notification; surface bookings inline on `/trips/[id]` day view; A/B test connect CTA placement.

## Effort & Cost
- **Eng effort:** Phase 1 = 8 person-days. Phase 2 = 5 person-days. Phase 3 = 3 person-days/sprint ongoing. CASA tier-2 verification = ~1 day of evidence + 2-week calendar wait.
- **Infra:** 1k users × 30 bookings/yr = 30k rows/yr (<10 MB). Vercel invocations ~25k/month (push + cron) — within plan. Postgres negligible.
- **Vendors (1k active connected users):** Gmail API $0 (per-user 250/sec is the real constraint); Graph $0 (130 RPS per app); Google Pub/Sub $0 (~20k msgs/month vs 1M free); Gemini 2.0 Flash ~15% × 20 emails × 1k users = 3M calls/yr × ~$0.0002 = **~$600/yr**. Scales linearly: ~$6k/yr at 10k users.

## Risks & Mitigations
1. **Wrong-trip attachment destroys trust.** Mitigation: Phase 1 ships review-queue-only (no auto-attach); auto-attach gated on confidence >0.9 and only one candidate trip. Track `booking_attachment_overridden` PostHog event as kill-switch.
2. **Google CASA verification rejected or delayed.** Mitigation: keep Phase 1 in Testing mode (100 internal/beta users) for 6+ weeks of data before applying. Have Outlook as parallel path so we're not single-vendor blocked.
3. **Sender template change silently breaks regex.** Mitigation: per-sender `parse_failed` rate dashboard; alert via Sentry when any sender drops below 90% success over 24h; LLM fallback masks the break until manual parser fix.
4. **Privacy backlash / press hit ("monkeytravel reads your email").** Mitigation: Privacy preamble is non-skippable; copy reviewed by us first, considered for legal review. Public blog post pre-launch ("How monkeytravel reads — and doesn't read — your inbox"). Never store body. Disconnect = real revoke.
5. **Token leak via Supabase backup.** Mitigation: pgsodium encrypt at rest, key in Vault not exported in pg_dump. Quarterly rotation cron documented.

## Open Questions
- Do we surface email-source bookings inside `/trips/[id]` activity timeline at Phase 2, or stay in a separate "Booked" section to keep the "AI planned" vs "you booked" distinction clear? (Recommend separate at Phase 2, integrated at Phase 3 with provenance icons.)
- Outlook free-tier users (`outlook.com`) vs work/school accounts: same `Mail.Read` scope but admin consent may be required for work tenants. Do we accept that work-account connects may fail silently and surface a "Ask your admin" copy?
- Do we want a "Forward to bookings@monkeytravel.app" alternative for users who refuse OAuth? (Defer to post-Phase-3; adds inbound email infra — Resend doesn't do inbound; would need SendGrid Inbound Parse or Postmark.)

## References
- Atomic counter RPC pattern: `supabase/migrations/20260525_explore_ugc_feed.sql`, `20260524_atomic_counters.sql`, `20260529_atomic_accept_trip_invite.sql`.
- Email orchestrator + fail-closed: `lib/email/send.ts` (`captureToSentry`).
- Rate limiter (Upstash + fallback): `lib/api/rate-limit.ts`.
- Lazy SDK loading: `lib/posthog/identify.ts` (`getPosthog`).
- Capacitor-aware OAuth start: `lib/native/external-link.ts`, `capacitor.config.ts` `server.allowNavigation` (task #172).
- Auth + access: `lib/api/auth.ts` `getAuthenticatedUser` / `verifyTripAccess`.
- Gemini structured output: `lib/gemini-vision.ts`, `lib/ai/packing-list.ts`.
- Translation namespaces: `messages/{en,it,es}/*.json` (add `integrations.json`).
- Post-mortem rule (task #211): MailboxConnectCard sits in `[locale]/profile/integrations`, safely scoped.
- Deploy verification: `scripts/verify-deploy-smoke.sh`.
