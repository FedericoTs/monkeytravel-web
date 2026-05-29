# Calendar Export (iCal + Google) + Smart Notifications

## TL;DR
One-click "Add to calendar" turns any saved trip into native calendar events (downloadable .ics, live subscription URL, or direct Google Calendar write via OAuth). Pairs with a zero-config notification cascade (14d/7d/3d/1d/morning-of) so users are reminded to pack, check visas, watch weather, and confirm bookings without opening the app. Closes the loop between planning and executing the trip.

## Problem & User Pain
- **Job-to-be-done:** "Once I've planned the trip, I want it on my real calendar so my family sees I'm out, and so I get pinged for things I'd otherwise forget."
- **Current workaround:** users manually retype activities into Google Calendar, or don't, and the MonkeyTravel itinerary becomes a tab they forget.
- **Quantified pain:** PostHog session paths show ~9% of saved-trip users return in the 14-day pre-trip window (vs. ~62% within the first 24h of saving). Trips with `start_date > 7 days` show sharp drop-off in `result_page_viewed` after day 2 from save. We have no proactive surface to pull them back.
- **Secondary:** collaborators on shared trips ask "what time are we doing the market?" in external chat because the itinerary isn't on their calendar.

## Success Metrics
**Primary:** % of trips with `start_date` in next 30 days that have at least one calendar export action (download, subscribe, or Google connect) within 7 days of save. Target: 35% in 90 days.

**Secondary:**
- Trip-start-day return rate: % of users who open MonkeyTravel on or 1 day before trip start. Baseline ~12%, target 28%.
- Notification CTR: % of pre-trip email/push notifications that result in an app open within 24h. Target 18%.
- Subscription churn: % of generated `/api/calendar/[token].ics` subscription URLs still being polled by a calendar client 30 days after creation (proxy for sustained engagement). Target 70%.

**Anti-metrics (red flags):**
- Email unsubscribe rate per send > 0.4% on any cascade slot.
- Resend complaint rate > 0.08% (Postmaster Tools alarm threshold).
- `calendar_export_failed` rate > 1% of attempts.

## User Flow (happy path)

**Export — one-shot download:**
1. On `/trips/[id]` and `/trips/[id]/edit`, a new "Add to calendar" button sits in the sticky action bar next to "Share".
2. Click opens a sheet with three tabs: **Download .ics** | **Subscribe (live updates)** | **Google Calendar (sync direct)**.
3. **Download .ics:** server streams a generated file `monkeytravel-{slug}.ics` with all activities as VEVENTs. User imports into Apple/Outlook/Fastmail/etc.
4. **Subscribe:** we show a `webcal://monkeytravel.app/api/calendar/{token}.ics` URL + one-tap copy + native iOS deep-link button. Calendars auto-refresh every few hours, so when the user edits an activity in MonkeyTravel it flows through.
5. **Google Calendar:** OAuth popup → `calendar.events` scope → server inserts each activity as an event, stamps `extendedProperties.private.monkeytravel_trip_id` for later reconciliation. On success, a toast: "Synced 14 events to your Google Calendar."

**Notifications — auto-cascade, no setup:**
1. On trip save with future `start_date`, a `scheduled_notifications` row is created per cascade slot (14d, 7d, 3d, 1d, morning-of-each-activity-day).
2. Daily cron at 09:00 UTC selects all rows with `scheduled_for` between now and now+1h, dispatches via `dispatchEmail()` + `enqueueNotification()` (in-app bell), marks `sent_at`.
3. User receives email + bell ping. Both deep-link to `/trips/[id]?focus={slot}` (e.g. visa checker for 7d, weather for 3d).
4. Settings page lets user mute the cascade per-trip (one toggle) or per-slot globally (existing `notification_settings`).

## Edge Cases & Failure Modes

- **No `start_date`:** export still works (floating VEVENTs without DTSTART). Banner: "Set trip dates to enable reminders."
- **Timezones:** each VEVENT uses destination IANA TZID (Google Places `time_zone_id`, fallback UTC offset from coords). `date-fns-tz` formats DTSTART/DTEND. One VTIMEZONE block per unique TZID at top of file.
- **Activity has no time:** default 10:00 local for first activity, stagger 90 min × order. Noted in DESCRIPTION.
- **User edits trip after export:** download is stale until re-download. Subscribe picks up on next calendar poll (15min–24h). Google = incremental sync via `extendedProperties.private.monkeytravel_trip_id` lookup → patch or insert.
- **Google OAuth revocation:** failed sync → email user once, flip `google_calendar_connected=false`, suppress further attempts until reconnect. Sentry tag `calendar.google_auth_revoked`.
- **Subscription URL leaked:** token = `hmac(user_id, SUBSCRIBE_SECRET || token_version)`. Exposes only that user's itineraries. Rate-limit 60 req/hr/token.
- **User unsubscribes:** existing `notification_settings.tripReminders` toggle gates dispatch (fail-closed via `lib/email/send.ts`).
- **Trip starts in past:** skip cascade slots whose `scheduled_for` is past.
- **DST:** date-fns-tz `zonedTimeToUtc`. Property-test the Europe/London March transition.
- **Privacy:** event DESCRIPTION never includes collaborator emails or booking links. Only public name + location + cost + trip URL.

## Technical Architecture

### Data model

New migration `supabase/migrations/20260601_calendar_and_scheduled_notifications.sql`:

```sql
-- Per-user Google Calendar OAuth tokens (pgsodium-encrypted if available).
CREATE TABLE public.user_calendar_connections (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('google')),
  access_token     TEXT NOT NULL,    -- short-lived
  refresh_token    TEXT NOT NULL,    -- long-lived
  scope            TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  google_email     TEXT,
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at   TIMESTAMPTZ,
  last_sync_error  TEXT
);
ALTER TABLE public.user_calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ucc_select_own" ON public.user_calendar_connections
  FOR SELECT USING (auth.uid() = user_id);
-- Writes: service-role only.

-- Reconciliation for Google sync.
CREATE TABLE public.trip_calendar_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  activity_fingerprint TEXT NOT NULL, -- md5(day_idx || act_idx || name)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, provider, external_event_id)
);
CREATE INDEX tce_trip_user_idx ON public.trip_calendar_events (trip_id, user_id);

-- Notification queue. Cron sweeps WHERE scheduled_for <= now() AND sent_at IS NULL.
CREATE TABLE public.scheduled_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id         UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  slot            TEXT NOT NULL CHECK (slot IN
    ('pack_early_14d','visa_check_7d','weather_3d','confirm_1d','morning_of')),
  scheduled_for   TIMESTAMPTZ NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'email',
  sent_at         TIMESTAMPTZ,
  skipped_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sn_due_idx ON public.scheduled_notifications (scheduled_for)
  WHERE sent_at IS NULL AND skipped_reason IS NULL;
ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sn_select_own" ON public.scheduled_notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Atomic RPC — called on trip insert + on start_date PATCH. Wipes future
-- slots for trip and re-inserts based on current start_date.
CREATE OR REPLACE FUNCTION public.schedule_trip_notifications(p_trip_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user UUID; v_start TIMESTAMPTZ; v_count INT := 0;
BEGIN
  SELECT user_id, start_date::timestamptz INTO v_user, v_start
    FROM trips WHERE id = p_trip_id;
  IF v_start IS NULL OR v_start < NOW() THEN RETURN 0; END IF;
  DELETE FROM scheduled_notifications WHERE trip_id = p_trip_id AND sent_at IS NULL;
  INSERT INTO scheduled_notifications (user_id, trip_id, slot, scheduled_for)
  SELECT v_user, p_trip_id, slot, v_start - offset_intv
    FROM (VALUES
      ('pack_early_14d', INTERVAL '14 days'),
      ('visa_check_7d',  INTERVAL '7 days'),
      ('weather_3d',     INTERVAL '3 days'),
      ('confirm_1d',     INTERVAL '1 day')
    ) AS s(slot, offset_intv)
    WHERE v_start - offset_intv > NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_trip_notifications(UUID) TO service_role;

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS reminders_muted BOOLEAN NOT NULL DEFAULT false;
```

### API surface (under `app/api/calendar/`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/calendar/[trip_id]/ics` | GET | session OR `?token=` | Download .ics (one-shot). |
| `/api/calendar/[user_hmac].ics` | GET | HMAC in path | Subscription feed; all user trips concatenated. |
| `/api/calendar/google/connect` | GET | session | Redirect to Google OAuth consent. |
| `/api/calendar/google/callback` | GET | session + state nonce | Exchange code, store tokens, redirect. |
| `/api/calendar/google/sync` | POST `{ trip_id }` | session | Push/patch events to Google. Called on connect + on trip update. |
| `/api/calendar/google/disconnect` | POST | session | Revoke token, delete connection row. |
| `/api/cron/dispatch-scheduled-notifs` | GET | `CRON_SECRET` | Daily sweep — sends due notifications. |

### Key components

- `lib/calendar/ical.ts` — `buildIcs(trip: Trip): string`. Inline RFC 5545 (VCALENDAR > VTIMEZONE > VEVENT × n), ~120 LOC, no npm dep. VEVENT shape: UID `act-{tripId}-{dayIdx}-{actIdx}@monkeytravel.app`, SUMMARY = activity.name, DTSTART/DTEND with TZID, LOCATION = address, GEO if coords, DESCRIPTION = first 500 chars + trip URL, CATEGORIES = activity.type.
- `lib/calendar/google.ts` — `syncTripToGoogle(userId, tripId): Promise<SyncResult>`. `googleapis` SDK for OAuth refresh + `calendar.events.insert`/`patch`. Diff against `trip_calendar_events.activity_fingerprint`.
- `lib/calendar/subscribe.ts` — `mintSubscribeToken(userId)` / `verifySubscribeToken(token)`. `crypto.createHmac('sha256', env.CALENDAR_SUBSCRIBE_SECRET)`, base64url.
- `lib/notifications/scheduling.ts` — `scheduleTripNotifications(tripId)` calls the RPC. Wired into `lib/trips/persistTrip.ts` (post-insert) + `/api/trips/[id]` PATCH (when start_date changes).
- `components/calendar/AddToCalendarSheet.tsx` — bottom sheet on mobile, modal on desktop. Three tabs. Uses `lib/native/external-link` so Capacitor opens .ics in the system browser.
- `app/[locale]/trips/[id]/edit/CalendarReminderToggle.tsx` — per-trip mute toggle PATCHing `trips.reminders_muted`.

### External integrations

- **Google Calendar API:** `googleapis` npm SDK (`googleapis` v144+, tree-shake to `@googleapis/calendar`). Scope `https://www.googleapis.com/auth/calendar.events`. OAuth client configured in Google Cloud Console with redirect `https://monkeytravel.app/api/calendar/google/callback`. Quota: 1M req/day free tier, ~10 req per sync — supports >50K trip-syncs/day at zero cost.
- **iCal RFC 5545:** built inline, no SDK. Tested against Apple Calendar, Google Calendar import, Outlook 365.
- **date-fns-tz** (add to deps): for TZID-aware DTSTART formatting. ~13 KB gzipped, already paired with existing `lib/datetime/format.ts`.
- **Resend:** existing `lib/email/send.ts`. Add 5 new templates under `lib/email/templates/`: `TripReminderPackEarly`, `TripReminderVisa`, `TripReminderWeather`, `TripReminderConfirm`, `TripReminderMorning`. Each ~80 LOC React Email.

### Caching strategy

- `/api/calendar/[trip_id]/ics`: `Cache-Control: private, max-age=300` — short so edits propagate within 5 min, but covers calendar-client retry storms.
- `/api/calendar/[user_hmac].ics`: `Cache-Control: private, max-age=900`. Apple Calendar polls hourly by default; 15-min server cache is fine.
- Google sync: no cache; idempotent via fingerprint diff.
- Timezone lookup: in-memory LRU `Map<lat,lng → tzid>` cap 1000 entries (saves Places `timezone` API calls). Same pattern as `lib/maps-grounding.ts`.

### Observability

- Sentry tags: `feature:calendar`, `op:export_ics`, `op:google_sync`, `op:notif_dispatch`, `slot:<slot>`.
- PostHog events: `calendar_sheet_opened`, `calendar_ics_downloaded`, `calendar_subscribe_copied`, `calendar_google_connected`, `calendar_google_synced { eventCount }`, `notif_scheduled { slotCount }`, `notif_sent { slot }`, `notif_clicked { slot }`, `notif_unsubscribed { slot }`.
- Log shape on cron: `{ stage: "dispatch_scheduled", due: N, sent: M, skipped: K, durationMs }`.

### Security review

- **Auth:** every `/api/calendar/*` (except subscribe + cron) requires a Supabase session via `createClient()` + ownership check on `trip.user_id = auth.uid()` or collaborator membership.
- **RLS:** all new tables RLS-enabled (see migration above). `scheduled_notifications` reads = own only; writes service-role.
- **OAuth state nonce:** generate `crypto.randomUUID()` in `/connect`, store in `httpOnly` cookie, verify in `/callback`. Prevents CSRF on the OAuth handshake.
- **HMAC subscribe URL:** `CALENDAR_SUBSCRIBE_SECRET` env (rotate via re-issuing tokens). Token revocation = bump a per-user `calendar_token_version` we mix into the HMAC.
- **Rate limit:** `createRateLimiter` (Upstash) on `/api/calendar/[token].ics` (60/hr/token), `/api/calendar/google/sync` (30/hr/user).
- **CSRF:** all mutating routes require `X-Requested-With: fetch` header + same-origin check (existing middleware pattern).
- **Token storage:** Google access/refresh tokens stored in `user_calendar_connections`. If pgsodium is enabled on Trawell, wrap inserts in `pgsodium.crypto_aead_det_encrypt`. Otherwise rely on Postgres-at-rest encryption + Supabase row-level access. Document as known-risk in `docs/SECURITY.md`.
- **Scope minimization:** request `calendar.events` (not `calendar` full-access). User can revoke any time via Google account settings; we handle 401s gracefully.

## Implementation Phases

**Phase 1 — MVP (2 weeks, behind `NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED`):**
- Migration + RPC + RLS.
- `buildIcs()` + `/api/calendar/[trip_id]/ics` download route.
- `AddToCalendarSheet` with **Download** tab only.
- `scheduleTripNotifications()` hook on trip save.
- `/api/cron/dispatch-scheduled-notifs` + 4 cascade slots (skip morning-of in MVP).
- One email template (generic "Your trip starts in N days — review").
- en/it/es translations for sheet + email subjects.

**Phase 2 — Polish (1 week):**
- **Subscribe** tab + HMAC token + webcal:// deep link.
- **Google Calendar** OAuth flow + sync.
- 5 specialized email templates per slot + cross-link to in-app focus targets (visa-checker, weather, packing).
- Per-trip mute toggle on `/trips/[id]/edit`.
- E2E in `tests/e2e/calendar.spec.ts`: download flow, mute toggle, cron dispatch dry-run.

**Phase 3 — Optimization (ongoing):**
- Morning-of-each-activity-day notifications (push channel via Capacitor `@capacitor/push-notifications`, web push via `@vercel/functions` + service worker — already deployed).
- A/B variants on cascade copy + send time (09:00 local vs 18:00 local).
- Outlook/Office365 OAuth (parallel to Google).
- Collaborator opt-in: collaborators on a shared trip can export to *their* calendar via the same sheet with the same Google flow.
- Smart slot detection: skip `visa_check_7d` when origin == destination country (use `users.country` + `trips.destination`).

## Effort & Cost

- **Engineering:** Phase 1 = ~10 person-days. Phase 2 = ~6 person-days. Phase 3 = ~8 person-days, batched. Total MVP-to-polished ≈ 3 person-weeks.
- **Infra (Supabase):** scheduled_notifications grows ~4 rows/trip; at 1000 new trips/wk ≈ 200K rows/yr — trivial. trip_calendar_events ~20 rows/trip-Google-synced.
- **Vendor:**
  - Resend: 4–5 emails/trip × current 1K trips/mo = 5K emails/mo. Current Pro plan ($20/mo for 50K) absorbs.
  - Google Calendar API: free at our scale (<<1M req/day quota).
  - iCal: $0.
  - Capacitor Push (if Phase 3): FCM free; APNs requires Apple dev account already in place.
- **Total run-rate cost increase:** ~$0/mo through 10× current scale.

## Risks & Mitigations

1. **Cron drift / missed sends.** Vercel cron is best-effort with no SLA. *Mitigation:* dispatch route is idempotent on (trip_id, slot, `date_trunc('hour')`) — late runs catch up; add Sentry alert if any cascade row is >2h overdue.
2. **Resend complaint rate spike from "too many emails".** *Mitigation:* hard cap = 1 cascade email per trip per 24h; suppress slot if any earlier slot was unsubscribed-from; the existing fail-closed `notification_settings` honor path already covers global mute.
3. **Google OAuth token leakage in logs.** *Mitigation:* explicit log redaction in `lib/calendar/google.ts` (`access_token`, `refresh_token` keys never log); Sentry `beforeSend` scrubs.
4. **TZ off-by-one bugs.** Classic source of 1-star reviews ("my trip was 3am instead of 3pm"). *Mitigation:* property-based test in `lib/calendar/ical.vitest.ts` over 50 (lat,lng,localTime) tuples crossing DST boundaries; tested against Apple Calendar manually.
5. **POST-MORTEM CLASS BUG: scheduling code lives outside `[locale]/`.** Cron route under `/api/cron/` is shared, fine. But `AddToCalendarSheet` strings must be wired through next-intl so /it and /es don't ship English. *Mitigation:* checklist item in PR template; verify-deploy smoke probes `/it/trips/<demo>` and asserts sheet button label is non-English.

## Open Questions

- Single all-trips subscription URL per user, or one per trip? (Lean per-user.)
- Push notifications in Phase 1 or defer? (Defer — email + bell is enough for MVP signal.)
- Charge for Google sync (premium) or keep free? (Recommend free — retention feature.)
- Morning-of: every activity or first-of-day? (First-of-day in Phase 3.)
- Subscription feed: include drafts/archived? (Default no; `?include=` query in Phase 3 if requested.)

## References

- `lib/email/send.ts` — orchestrator (fail-closed idempotency, suppression, opt-out).
- `lib/notifications/service.ts` + `types.ts` — `enqueueNotification()` + discriminated payload.
- `lib/email/templates/Invite.tsx` — React Email skeleton.
- `app/api/cron/refresh-activity-index/route.ts` — cron auth pattern.
- `vercel.json` — existing cron slot.
- `supabase/migrations/20260530_activity_index_mview.sql` — SECURITY DEFINER RPC + `search_path`.
- `supabase/migrations/20260529_atomic_accept_trip_invite.sql` — atomic RPC + RLS pattern.
- `lib/datetime/format.ts` — locale-aware formatter (extend for TZID).
- `lib/native/external-link.ts` — Capacitor-safe external open.
- `lib/security/safe-next.ts` — open-redirect guard for OAuth state.
- `app/[locale]/profile/notifications/NotificationPreferencesClient.tsx` — settings UI pattern.
- `tests/e2e/` — Playwright pattern for `calendar.spec.ts`.
