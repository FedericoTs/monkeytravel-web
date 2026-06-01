# Wizard ghost-user investigation — 30 May 2026

## TL;DR

**72% of all signups (87 of 121) never created a trip.** 80 of those 87
reached `/trips/new` — they're not lazy signups, they actively tried to
use the product and bailed mid-wizard.

A Chrome MCP live-test **reproduced a renderer freeze** when selecting a
destination from the autocomplete dropdown, matching a `496 rapid-reload`
signal in production page_views. Cause unconfirmed — `buildSeasonalContext`
in `lib/seasonal/index.ts` is the leading suspect but the data is too
sparse to call definitively.

The **definitive answer requires server-side step-funnel instrumentation**
that mirrors PostHog's `captureTripWizardAbandoned` events into a Supabase
`wizard_events` table. Build, ship, wait 7 days, get the answer with no
PostHog API key required. Scope below.

---

## Data signals

### 1. Funnel reality
| Cohort | Count | % |
|---|---|---|
| Total signups | 121 | 100% |
| Ever created a trip | 34 | 28% |
| **Ghosts (no trip)** | **87** | **72%** |
| Ghosts who reached `/trips/new` | 80 | 92% of ghosts |
| Ghosts who called `/api/ai/generate` | 0 | 0% |
| Ghosts who touched destination autocomplete | 7 | 8% of ghosts (only) |
| Ghosts gone 30+ days | 56 | 64% |

### 2. Auth provider has nothing to do with it
| Provider | Ghost rate |
|---|---|
| Google OAuth | 59/82 = 72% |
| Email signup | 28/39 = 72% |

Identical drop rate. **Friction at the wall, not at the door.**

### 3. Where ghosts go AFTER reaching /trips/new
| Exit destination | Visits | Unique ghosts |
|---|---|---|
| **`/trips/new` (loop)** | **222** | **39** |
| `/trips` (dashboard — looking for the missing trip) | 109 | 53 |
| `/profile` | 53 | 23 |
| `/it/trips/new` + `/es/trips/new` (locale switch) | 100 | 14 |
| `/` (homepage) | 33 | 17 |
| **(no next page — tab closed)** | **20** | **20** |
| `/trips/template/b1a2c3d4-…` (curated escape) | 14 | 11 |

39 ghosts hit `/trips/new` an average of 5.7 times each. Strong signal of
either freeze-and-reload OR navigation thrash.

### 4. Time between consecutive /trips/new views (the smoking gun)
| Gap bucket | Visits | Implication |
|---|---|---|
| First visit | 80 | (matches 80 unique ghosts) |
| **Under 5s (rapid reload)** | **496** | Either freeze + reload OR page_view double-fire |
| 5-30s (quick retry) | 29 | |
| 30s-2m (thinking) | 17 | |
| 2-10m (actively using) | 23 | |
| 10m-1h (came back) | 10 | |
| Under 24h (next session) | 12 | |
| Over 24h (returning) | 10 | |

**496 rapid-reload views is anomalously high.** Production middleware
fires `page_views` only on real HTTP navigations, not on SPA route
changes — so this represents 496 actual server hits to `/trips/new`
within 5 seconds of the previous one, by ghost users.

### 5. Chrome MCP live-test
- Navigated to `/it/trips/new` (browser locale forced redirect to /it)
- Typed "Lisbon" → autocomplete dropdown appeared correctly
- Clicked "Lisbon, Portugal" suggestion
- Console logged:
  - `[Autocomplete] Using local coordinates - $0 cost`
  - `[Autocomplete] Skipping search - just selected`
- Then page froze. Screenshot tool timed out after 30s. 8s wait did not
  recover. Tab had to be discarded.

Console showed autocomplete handlers completed; freeze is downstream.

---

## Leading hypotheses

### H1 — Heavy synchronous effect cascades on destination state change (most likely)

`NewTripWizard.tsx` is 2,549 lines. When `setDestination(...)` +
`setDestinationCoords(...)` fire from `handleDestinationSelect`, React
re-renders the entire wizard. Multiple `useEffect` hooks depend on
`destination` or `destinationCoords` and run synchronously in the same
render pass. Candidates:

- `useEffect` at line 475 — `buildSeasonalContext()` (516-line module,
  no async/IO but Object.entries + map + filter over the HOLIDAYS table)
- Field-interaction tracking
- Draft save side effects
- Internal autocomplete state propagation

Plus React 19's concurrent rendering may queue too many state updates
in a single tick, blocking the main thread.

### H2 — Image fetch / hero update cascade

When destination changes, downstream components (e.g. a hero preview)
may eagerly fetch a Pexels image. We've fixed similar races before
(SeasonalContextCard had an AbortController bug — task #144).

### H3 — Autocomplete debounce / cleanup race

The console did show `[Autocomplete] Skipping search - just selected`,
which is the debounce-guard logic working. But if subsequent keystrokes
or re-focuses re-trigger the search before the cleanup runs, that could
flood requests.

### H4 — React Suspense + dynamic-import boundary loads heavy chunk

Many wizard subcomponents are `next/dynamic`. The first destination
selection may trigger lazy-loading of a hidden component (vibes
selector, date picker, seasonal card) — first-paint hit.

---

## What we cannot get from current data

- **PostHog event-level data** (we don't have a PostHog Personal API
  Key, only the public write key). PostHog already captures
  `trip_wizard_abandoned` with `last_step_completed`, `last_step_name`,
  `total_time_seconds`, `had_destination`, etc. That data exists — we
  just can't query it programmatically without a PAT.
- **Sentry session replays** for the ghost users (would need to
  navigate the dashboard manually).
- **Performance traces** (long-task observer / FCP-on-each-step).

---

## Recommended next steps, ranked

### 1. 🎯 Server-side step funnel (task #293) — DEFINITIVE, ships in 1-2 hours

Add a `wizard_events` table + `POST /api/wizard/step` endpoint. Mirror
the existing PostHog `captureWizardStepX`/`captureTripWizardAbandoned`
hookpoints to also POST here. Within 7 days of new traffic, we have
clean Supabase data showing the exact drop point per user.

Schema:
```sql
CREATE TABLE wizard_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NULL REFERENCES auth.users(id),
  session_id      text NULL,           -- our mt_session_id cookie
  event_type      text NOT NULL,       -- step_viewed | step_completed | abandoned | generated
  step_n          int NULL,            -- 1 or 2
  step_name       text NULL,
  had_destination boolean NULL,
  had_dates       boolean NULL,
  had_vibes       boolean NULL,
  destination     text NULL,           -- redacted prefix only, GDPR-safe
  time_since_mount_ms int NULL,
  user_agent_class text NULL,          -- "mobile" | "desktop" | "tablet" — coarse
  locale          text NULL,
  created_at      timestamptz DEFAULT now()
);
```

### 2. Performance instrumentation (lighter task #294)

Add `PerformanceObserver({ type: 'longtask' })` to the wizard, fire-and-
forget POST to `/api/wizard/perf` when a long-task > 500ms is detected.
Catches freezes in production from real users.

### 3. Local repro + profile

Run the wizard locally with React DevTools Profiler open. Step through:
type destination → select → measure each commit. If `buildSeasonalContext`
or another effect dominates, the fix is to defer/throttle.

### 4. UX fix regardless: confirm + persist destination immediately

Even if the freeze IS resolvable, the architecture invites it: every
keystroke and selection trigger 5+ effects. Refactor: derive
`seasonalContext` only when the user clicks "Continua" rather than on
every state change.

---

## Bonus: 11 ghosts went to template pages

`/trips/template/b1a2c3d4-…` got 14 visits from 11 unique ghosts. They
tried templates as an alternative path. None of them resulted in a
saved trip either. Worth investigating template-to-save flow as a
secondary leak.

---

## Source data

- Supabase project: `sevfbahwmlbdlnbhqwyi` (Trawell)
- Queries used live in this doc (see Sections 1-4 above)
- GSC data: `.audit/gsc-manual/2026-05-30/`
- Chrome MCP session: 30 May 2026 ~22:35 UTC
