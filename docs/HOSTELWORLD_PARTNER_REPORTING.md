# Hostelworld partnership — reporting cheatsheet

Last updated: 2026-05-29 (Phase A+B ship).

## What we measure

| Signal | Source | What it answers |
|---|---|---|
| **Clicks** to Hostelworld | `public.hostelworld_clicks` | "How much traffic did we send you?" |
| **Trips with hostel intent** | `COUNT(DISTINCT trip_id)` | "How many distinct itineraries triggered a click?" |
| **Unique travellers** | `COUNT(DISTINCT user OR cookie)` | "How many people, not how many clicks?" |
| **Signups from your landing page** | `users.acquisition_source = 'hostelworld'` | "How many users came specifically from the partnership wedge?" |

The first three already render live on `/backpacker` (social proof block,
30-day window, refreshes hourly). The fourth is below — ad-hoc SQL for
the monthly partner sync.

## Live counter — already on the page

`/backpacker` → social proof section ("Backpackers using MonkeyTravel —
last 30 days") fetches `/api/affiliates/hostelworld/stats` which calls
the `hostelworld_stats_30d` RPC. Edge-cached for 1h.

The block only renders when ≥10 clicks exist in the 30-day window —
"0 backpackers found hostels" hurts the partnership narrative more
than the absent block would.

## Ad-hoc queries (run via Supabase SQL editor)

### How many users came from the Hostelworld landing page?

```sql
SELECT COUNT(*) AS signups_from_hostelworld,
       COUNT(*) FILTER (WHERE created_at > now() - interval '30 days') AS last_30d,
       COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') AS last_7d
FROM public.users
WHERE acquisition_source = 'hostelworld';
```

### How active are those users? (engagement metric)

```sql
SELECT
  COUNT(DISTINCT u.id)                              AS hostelworld_signups,
  COUNT(DISTINCT t.id)                              AS trips_created,
  COUNT(DISTINCT t.id) FILTER (WHERE t.visibility='public') AS trips_published,
  COUNT(DISTINCT c.id)                              AS hostel_clicks
FROM public.users u
LEFT JOIN public.trips             t ON t.user_id = u.id
LEFT JOIN public.hostelworld_clicks c ON c.user_id = u.id
WHERE u.acquisition_source = 'hostelworld';
```

### Daily click + signup trend (last 30 days)

```sql
WITH days AS (
  SELECT generate_series(
    date_trunc('day', now() - interval '30 days'),
    date_trunc('day', now()),
    interval '1 day'
  )::date AS d
)
SELECT
  d,
  COALESCE(c.clicks,   0) AS hostel_clicks,
  COALESCE(s.signups,  0) AS hostelworld_signups
FROM days
LEFT JOIN (
  SELECT date_trunc('day', created_at)::date AS d, COUNT(*) AS clicks
  FROM public.hostelworld_clicks
  WHERE created_at > now() - interval '30 days'
  GROUP BY 1
) c ON c.d = days.d
LEFT JOIN (
  SELECT date_trunc('day', created_at)::date AS d, COUNT(*) AS signups
  FROM public.users
  WHERE acquisition_source = 'hostelworld'
    AND created_at > now() - interval '30 days'
  GROUP BY 1
) s ON s.d = days.d
ORDER BY d;
```

### Click → signup conversion proxy

Not a true funnel (clicks happen post-signup, not pre-) but a useful
proxy for the partnership narrative:

```sql
SELECT
  (SELECT COUNT(*) FROM public.users WHERE acquisition_source='hostelworld'
    AND created_at > now() - interval '30 days') AS signups_30d,
  (SELECT COUNT(*) FROM public.hostelworld_clicks
    WHERE created_at > now() - interval '30 days') AS clicks_30d,
  ROUND(
    100.0 * (SELECT COUNT(*) FROM public.hostelworld_clicks
      WHERE created_at > now() - interval '30 days')
    / NULLIF(
      (SELECT COUNT(*) FROM public.users WHERE acquisition_source='hostelworld'
        AND created_at > now() - interval '30 days'), 0),
    1
  ) AS clicks_per_hostelworld_signup_pct;
```

## How attribution works (so you can debug)

1. User clicks a CTA on `/backpacker` (or any URL we share with
   Hostelworld). All CTAs include
   `?utm_source=hostelworld&utm_medium=backpacker_landing`.
2. **Middleware** sees `utm_source` in the query → writes a
   `mt_utm_source=hostelworld` cookie, 60-day TTL, first-touch (never
   overwritten by subsequent UTM-tagged hits).
3. User browses the site, eventually signs up (email/password OR Google
   OAuth).
4. **Signup handler** (either `app/[locale]/auth/signup/page.tsx` for
   email or `app/auth/callback/route.ts` for OAuth) reads the cookie
   and stamps `users.acquisition_source = 'hostelworld'` during
   profile create.
5. Cookie persists for 60 days so multi-session "consider then sign up"
   journeys still get credited.

The `acquisition_source` column is indexed (partial — only non-null
values) so the partner-reporting queries above stay fast even as user
count grows.

## Sanity-check queries

```sql
-- Is anyone getting the cookie + signing up?
SELECT acquisition_source, COUNT(*)
FROM public.users
WHERE acquisition_source IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;

-- Is the click table receiving rows?
SELECT date_trunc('day', created_at)::date AS d, COUNT(*) AS rows
FROM public.hostelworld_clicks
GROUP BY 1 ORDER BY 1 DESC LIMIT 14;
```

If `acquisition_source` shows zero rows after a week of Hostelworld
traffic, check (in order):
1. CTAs on `/backpacker` still have `?utm_source=hostelworld` in their
   href (search the file for `utm_source=hostelworld`).
2. Middleware is matched on the path the user enters (Edge log of
   `[Middleware] cookie set` if we add one, or inspect `mt_utm_source`
   in DevTools after visiting `/backpacker`).
3. Signup handler is reading the right cookie name. Should be
   `mt_utm_source` everywhere.

## What's NOT measured (gaps to know about)

- **Pre-Phase-B users**: anyone who signed up before this feature
  shipped won't have `acquisition_source` set — they're forever NULL.
  We can't backfill organic UTM data after the fact.
- **Last-touch attribution**: by design we use first-touch. If a user
  hits `/backpacker` once, then signs up via a different surface 50
  days later, they still count as Hostelworld. Defensible — the
  partnership wedge was the surface that captured them.
- **Anonymous-only flows**: a user who clicks the Hostelworld CTA from
  `/backpacker` but never signs up is tracked in `hostelworld_clicks`
  (anon row with `visitor_cookie`), but won't appear in the
  `acquisition_source` users count.
