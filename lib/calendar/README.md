# lib/calendar — calendar export + subscribe

Pure-function utilities for the calendar-export feature
(see `docs/specs/calendar-export-smart-notifs.md`).

## Modules

| File | Purpose |
|---|---|
| `ical.ts` | RFC 5545 generator. Pure: `buildIcal(events, opts) → string`. No npm dep. (Phase 1A) |
| `ical.vitest.ts` | Property + round-trip tests for `ical.ts`. (Phase 1A) |
| `feed.ts` | HMAC mint/verify + service-role trip lookup for the subscription feed. (Phase 1B) |
| `trip-to-events.ts` | Adapter: `Trip` JSONB → `IcalEvent[]`. (Phase 1B) |

The HTTP route lives separately at
`app/api/calendar/[user_hmac]/route.ts`.

## Environment variables

Set in the Vercel project (and locally in `.env.local` for dev):

### `CALENDAR_HMAC_SECRET` *(required for Phase 1B)*

Long random string (>= 32 chars recommended) used to mint each user's
opaque subscription URL via `HMAC-SHA256(user_id, secret)`.

Generate:

```bash
openssl rand -hex 32
```

Then set it in **Vercel → Project Settings → Environment Variables**
(Production + Preview + Development) as `CALENDAR_HMAC_SECRET`.

Without this env var, requests to `/api/calendar/[user_hmac].ics`
return `500` and the operator should see the
`CALENDAR_HMAC_SECRET is not set` error in Sentry.

#### Rotation

1. Generate a new value in Vercel.
2. Null out the column for all users so the next mint regenerates it
   under the new key (otherwise feeds keep working under the old HMAC
   until someone re-mints):
   ```sql
   UPDATE public.users SET calendar_hmac = NULL;
   ```
3. Every user's existing subscription URL becomes a 404. They need to
   re-copy the new URL from the AddToCalendar sheet (Phase 2 UI).

Rotation is therefore disruptive — only do it if the secret leaked.

### `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` *(required for Phase 2)*

Google Cloud Console → APIs & Services → Credentials → OAuth 2.0
client ID (web application). Authorized redirect URI must include:

- `https://monkeytravel.app/api/calendar/google/callback`
- `http://localhost:3000/api/calendar/google/callback` (dev)

Required scope: `https://www.googleapis.com/auth/calendar.events`
(write-only — narrower than the broader `calendar` scope).

Without either env var, `/api/calendar/google/connect` returns 503 with
`{ error: "Calendar sync not configured" }`. The .ics download +
subscription feed still work — Phase 2 is purely additive.

### `GOOGLE_OAUTH_REDIRECT_URI` *(optional, Phase 2)*

Overrides the default `https://monkeytravel.app/api/calendar/google/callback`.
Set this in dev `.env.local` to `http://localhost:3000/api/calendar/google/callback`.

### `CALENDAR_OAUTH_STATE_SECRET` *(required for Phase 2)*

HMAC key for the OAuth `state` param that binds tripId + userId
together across the Google redirect. Generate with
`openssl rand -hex 32`. Rotating this only invalidates in-flight
OAuth flows (max 10 minutes old) — already-connected users are
unaffected.

### `CALENDAR_TOKEN_ENC_KEY` *(required for Phase 2)*

64-hex-char (32 bytes / 256 bits) symmetric key used by
`lib/calendar/token-encryption.ts` to AES-256-GCM-encrypt the
user's Google access_token + refresh_token before persisting to
`public.user_calendar_connections`. Generate with
`openssl rand -hex 32`.

KNOWN-RISK / FUTURE-WORK: pgsodium isn't installed on Trawell so
we encrypt at the app layer instead. If pgsodium ever lands,
migrate via a one-time decrypt → re-encrypt-with-pgsodium pass.

Rotation = clear all tokens + ask users to reconnect:
```sql
DELETE FROM public.user_calendar_connections;
```

### `NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED` *(feature gate, Phase 1+)*

Defaults to `"false"` in code so a PR merge doesn't go live. Set to
`"true"` in Vercel to expose the Add-to-Calendar UI to all users.
The subscription-feed *route itself* ignores this flag (see the
route's header comment for why) — flipping the flag off only hides
the UI, it doesn't break already-subscribed calendars.

## Database

Migration `supabase/migrations/20260601_calendar_user_hmac.sql` adds
`users.calendar_hmac TEXT` with a partial UNIQUE index. Population
is lazy via `getOrCreateUserHmac()` — the column stays NULL until
the user opens the AddToCalendar "Subscribe" tab (Phase 2 hookup).

## Causality / consumers

- `app/robots.ts` disallows `/api/calendar/` so crawlers never
  index a leaked feed URL.
- `app/api/calendar/[user_hmac]/route.ts` is the only HTTP consumer
  of `feed.ts` today; Phase 2 will add a Subscribe-tab in
  `components/calendar/AddToCalendarSheet.tsx` that calls
  `getOrCreateUserHmac()` server-side and shows the URL to copy.
