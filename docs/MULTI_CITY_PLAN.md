# Multi-City Trips — Engineering Scope (narrow slice)

**Status:** Planning · **Date:** 2026-06-30 · **Owner:** Federico
**Source:** Growth office-hours session. Wedge #1 of the 1→2→3 funnel
(multi-city+group → tighten viral loop → evolve /explore). This doc scopes the
*narrowest real* multi-city build, deliberately deferring the heavy parts.

---

## 0. Why (one paragraph)

Multi-destination trip requests are up (real demand), and the `/backpacker`
marketing copy already *implies* multi-city is supported — but **it isn't built**.
Today a trip is single-destination end to end. Multi-city trips are also where
group travel lives, so this wedge serves both the demand signal and the
collaboration/virality goal. **Decision needed in parallel:** either build this
soon or fix the `/backpacker` copy so we stop promising what we don't ship.

## 1. Ground truth (verified in code)

| Layer | Today | File / symbol |
|---|---|---|
| Wizard input | ONE destination string | `app/[locale]/trips/new/NewTripWizard.tsx` — single `DestinationAutocomplete`, `const [destination, setDestination] = useState("")` |
| Gen params | `destination: string` (singular) | `types/index.ts` → `TripCreationParams.destination` |
| Prompt | "Plan a N-day trip to {destination}" | `lib/gemini.ts` `generateItinerary` (~L623) |
| Output | single `destination` object | `types/index.ts` → `GeneratedItinerary.destination` (~L130–137) |
| Day model | **no** per-day city | `types/index.ts` → `ItineraryDay` (~L77–85); `Activity.location` is a neighborhood string, not a city |
| Vestige | `Trip.destination_ids?: string[]` exists but is **never populated/used** (~L58) |
| Backpacker | only a *soft text hint* to the AI ("if 5+ days, consider mentioning splitting cities") | `lib/gemini.ts` (~L577–600) |
| Invites | join a co-traveler to ONE trip | `trip_invites` / `trip_collaborators` (already works) |

> Build-time TODO: re-verify these line numbers before editing — they drift.

**Reality check vs prod data (Trawell, 2026-06-30):** users *already* create multi-city
trips (e.g. "Barcelona & Madrid Trip", "Vienna, Prague, and Germany Trip", "London &
Edinburgh Trip") — by **typing a multi-city string into the single destination field**.
Evidence: `destination_ids = []` (the structured column is unused), day objects have **no
`city`** key, `trip_meta` has no `destinations`, and these are `travel_style = classic`
(not backpacker). The AI produces ONE unstructured itinerary that splits cities only in
prose/`theme`. So: **structured** multi-city doesn't exist, but the free-text hack does —
which (a) is strong demand validation (classic mode, repeated over months) and (b) proves
this build is a **backward-compatible additive upgrade**: existing trips just lack the new
`city` field and render unchanged. The narrow slice = the *structured* version of the hack.

## 2. Goal & non-goals

**Goal:** a user can plan a trip across **2–3 cities** (each with N nights) in one
itinerary, with each day attributed to its city, and can invite a co-traveler
into that trip (existing flow). Single-city remains the default and is unchanged.

**Non-goals (explicitly deferred — do NOT build in v1):**
- ❌ `trip_legs` table / relational multi-destination schema
- ❌ Cross-city route map / inter-city polylines / transit booking
- ❌ Backfilling the dead `destination_ids` field
- ❌ Per-city cover images / multi-hero (use first city's photo for v1)
- ❌ Reordering cities by drag, optimal-route solving
- ❌ Collaborator changes (existing invite is sufficient for v1)

## 2.5 UX signature — the "Journey ribbon" (locked 2026-06-30)

Multi-city trips get a distinct **identity** so the feature is memorable + shareable
(not just "a second city box"):
- **Route ribbon (hero):** the trip's cities on a connected line — teal route, coral
  ordered city nodes (1→N), each with a nights pill. This becomes the hero for
  multi-city trips (replaces the single cover photo as the lead visual).
- **City chapters:** the itinerary reads as acts — each city a section with its own
  header, driven by `ItineraryDay.city`.
- **Transit pills between cities:** "TRAIN · 4h 10m" on the line. The inter-city time
  is the ONLY element needing data beyond the narrow model — AI-estimate it, or ship
  v1 as "→ to {city}" with no time.
- **Crew avatars + "Share your route":** group framing is the default; the ribbon
  doubles as a **share-card** — the artifact that hands Wedge #1 → Wedge #2 (virality).

Maps **1:1 to the data model** — needs only `destinations[{city,nights}]` +
`ItineraryDay.city` (already in scope below). Map-first and passport/stamps motifs
were considered and deferred. (Mock shown in chat, 2026-06-30.)

## 3. Design (minimal-footprint)

**3.1 Data model — avoid a migration by using JSONB we already have**
- Add optional `city?: string` to `ItineraryDay` (it lives inside the `itinerary`
  JSONB column — **no DB migration**). Generation tags each day; render groups by it.
- Store the ordered route in `trip_meta` (existing JSONB):
  `trip_meta.destinations = [{ city, country?, nights }]`. **No new column.**
- Keep `trips.destination` (the existing string col) as the **headline/display**
  value = a label like `"Rome, Florence & Venice"` (and use the **first city**
  for cover-image / SEO / share-card lookups, which all key off `destination`).
- `TripCreationParams`: add `destinations?: { city: string; nights: number }[]`.
  When absent, fall back to the existing singular `destination` (full back-compat).

**3.2 Wizard UX**
- Single-city stays the default (one `DestinationAutocomplete` row).
- "Add another city" → repeatable rows (city + nights), **max 3 for v1**.
- Nights per city must sum to the trip length (derive from the date range, or
  let nights drive duration — pick one; see Open Decisions).
- Validation: ≥1 city, no empty rows, sum-of-nights == trip length.

**3.3 Generation prompt**
- Rewrite `generateItinerary` to accept `destinations[]`. When `length === 1`,
  emit the **exact current prompt** (zero regression on the single-city happy path).
- For `length > 1`: request a city-sequenced itinerary ("Days 1–3 in {A}, days
  4–7 in {B}…"), and require each output day to carry its `city`. Add one transit
  day/activity between cities where the gap warrants it.
- Output schema: add `city` per day; the top-level `destination` object becomes
  the first city (or a synthesized label) for back-compat.

**3.4 Render**
- Trip detail (`TripDetailClient`) + shared view: insert a **city section header**
  when `day.city` changes between day-groups. Undefined `city` → no header
  (existing single-city trips render identically).
- Map: leave as-is for v1 (per-day pins). No cross-city routing.

**3.5 Collaboration (no new code)**
- Existing `ShareAndInviteModal` + `trip_invites` already invite a co-traveler to
  the (now multi-city) trip. v1 ships as-is; just instrument it.

## 4. Backward compatibility & rollout

- All existing trips: `city` undefined, `destinations` absent → render + regenerate
  exactly as today. The unified **AI Assistant** (agent) reads the itinerary as-is,
  so it keeps working; a later enhancement can teach it city-aware edits.
- Gate the multi-city **wizard entry** behind `NEXT_PUBLIC_MULTI_CITY_ENABLED`
  (default off) → canary on, watch generation quality + the metric, then default on.
- Server accepts `destinations[]` whenever sent; no flag needed server-side.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Multi-city generation quality (hallucinated transit, lopsided days) | Keep single-city prompt byte-identical; test multi-city on 5–10 real routes before flag-on |
| Nights/date math across cities | Single date range + per-city nights summing to length; validate client + server |
| Cover image / SEO / share-card key off `destination` string | Use first city for those in v1; label is display-only |
| `/explore` + TripCard rendering a multi-city trip | Verify card uses `destination` label; no structural assumption broken |
| Over-promising copy persists | Decide copy fix vs build timing (Open Decisions) |

## 6. Instrumentation (north-star)

- **Metric:** % of new trips that are multi-city **AND** have ≥1 invited collaborator.
- Events: `trip_created` with `{ city_count }`; `collaborator_invited`;
  `shared_link_viewed → make_your_own → signup` (this also seeds Wedge #2's
  viral-loop funnel — build the events now, reuse later).

## 7. Task breakdown (rough)

1. **Types + params** — `ItineraryDay.city`, `TripCreationParams.destinations[]`,
   `trip_meta.destinations` shape. (S)
2. **Wizard** — repeatable city+nights rows, validation, flag gate. (M)
3. **Prompt + output** — `generateItinerary` multi-city branch + city-tagged
   schema; keep single-city path identical. (M)
4. **Render** — city section headers in trip detail + shared view. (S)
5. **Headline/label + cover** — destination label = "A, B & C"; cover = first city. (S)
6. **Instrumentation** — city_count + collaborator + viral-loop funnel events. (S)
7. **QA** — single-city regression + multi-city happy path + collaborator invite
   on a multi-city trip + `/explore` card + share view. (M)

Rough order-of-magnitude: ~1 focused week. No DB migration.

## 8. Open decisions (founder)

1. **Max cities v1** — recommend **3** (cap complexity + generation quality).
2. **Duration source** — nights-per-city **drive** trip length, or date-range
   drives and nights must sum to it? Recommend **date-range drives** (fewer wizard
   changes; matches today).
3. **Cover/headline** — first-city photo + "A, B & C" label (recommend), vs a
   later multi-hero.
4. **`/backpacker` copy** — fix the multi-city claim **now** (build is ~1wk out),
   or leave until ship? Recommend a quick copy audit now to avoid over-promising.
5. **Rollout** — flag → canary (recommend), vs ship to all once QA passes.

## 9. Eng review findings (2026-06-30, verified in code)

**Verdict: GO with corrections.** Spine is sound; the flat-`city`-per-day design is
the right one (preserves the streaming day-parser — a nested `cities[{days}]` would
break it). Risk is concentrated in generation + the regenerate/agent plumbing.

**Confirmed safe:** `ItineraryDay.city` is additive (`sanitizeItinerary` spreads
unknown fields; no strict validator); rendering/`/explore`/share/map/SEO don't break;
wizard already accepts free-text.

**Must-fix (added to scope):**
- **A · Data model + latent bug.** No `trips.destination` column; canonical is
  `trip_meta.destination` — but `lib/trips/persistTrip.ts buildTripRow` **never writes
  it** (a comment in `lib/trips/destination.ts` wrongly claims it does), so
  `getTripDestination()` falls back to title-strip. Build must: write
  `trip_meta.destination` (+ `destinations[]`), generate title "A, B & C Trip", and
  parse FIRST city for the cover-image (Pexels) lookup. (Writing `trip_meta.destination`
  also fixes a pre-existing SEO/filter accuracy gap.)
- **B · Silent-wrong-city in regenerate/agent paths.** `/api/ai/regenerate-day`,
  `/api/ai/regenerate-activity`, and `lib/ai/trip-actions.ts`
  `proposeRegenerateDay/proposeReplaceActivity/proposeAddActivity` pass ONE trip-level
  destination → on a multi-city trip they generate the WRONG city's content silently.
  Plumb `day.city` through (~5 call sites; the gemini fns already accept `destination`).
  Either ship this in v1 OR gate per-day/activity edits on multi-city trips for v1.
- **C · Generation hardening.** Raise `maxOutputTokens` 8000→12000 (multi-city truncates
  today); add `city` to prompt + responseSchema + post-parse validation (missing-city /
  night-allocation); per-CITY coordinate fallback (today all days inherit city #1's
  coords; Places API was removed); cache-key fix (multi-city collides with single-city).

**Architecture — LOCKED 2026-06-30: per-city parallel generation + merge** (reliability-
first, chosen over one-big-prompt). Each city is generated independently (scoped to its
nights), then merged into one sequential day-numbered itinerary with `city` tags +
transition handling. Smaller per-city prompts ⇒ far less truncation risk, faster (parallel),
per-city coords for free. Build order is reliability-first, then the complete UI.

### Build roadmap (LOCKED: Phase 1 → Phase 2)

**Phase 1 — Generation engine (no UI, fully testable):**
1. ✅ **DONE (7ebf24e)** Types + `trip_meta.destination` persist-fix (was a latent bug
   affecting SEO/filtering) + `ItineraryDay.city`. (`trip_meta.destinations[]` plumbing
   lands with the route wiring in Phase 2.)
2. ✅ **DONE (94dbf3f)** Per-city **parallel** generator + merge:
   `generateMultiCityItinerary(base, legs[{city,nights}], tripStart)` in `lib/ai/multi-city.ts`
   runs `generateItinerary` per city concurrently; the PURE merge in `lib/ai/multi-city-core.ts`
   concatenates days, renumbers `day_number` globally, re-assigns contiguous dates from the
   trip start, and `city`-tags each day. (No explicit transition day in v1 — legs tile the
   trip gap-free; a travel-day insert can come later if needed.)
3. ✅ **MOSTLY DONE (94dbf3f)** Hardening (finding C): per-city coords ✅ (each city is its own
   single-city gen, so coords are native — no fallback); token budget ✅ (per-city prompts are
   small); post-merge validation ✅ (`validateLegs` + day-count/city-count warnings); cache-key ✅
   (per-city `generateItinerary` dedup). Remaining: a multi-city-level result cache if we want one.
4. ⏳ **NEXT** Test the engine on real routes (2–4 cities, 6–10 days) — needs either a thin
   harness/script calling `generateMultiCityItinerary`, OR the Phase-2 `/api/ai/generate`
   wiring (step 5) to drive it. The pure merge is already covered by 15 unit tests.

**Phase 2 — Complete UI + edits:**
5. Wizard route-builder (city + nights rows, reorder, validation) behind
   `NEXT_PUBLIC_MULTI_CITY_ENABLED`.
6. City-chapter render + the **Journey ribbon** signature (§2.5) + share-card.
7. **Per-day-city edit plumbing (finding B)** — thread `day.city` through the ~5
   regenerate/agent call sites so the AI Assistant fully edits multi-city from day one.
8. Title "A, B & C Trip" + first-city cover + `trip_meta.destinations` wiring.
9. Flag → canary → default-on.

**Effort:** ~2–2.5 weeks. No DB migration. Phase 1 ships independently testable; the
`trip_meta.destination` persist-fix (1) is a standalone bug-fix worth doing immediately.

---

*Progress (2026-06-30, branch `feat/multi-city`, all LOCAL/unpushed):*
- *Phase 1 (steps 1–3) ✅ engine — types, persist-fix, per-city parallel generator + pure merge, 15 unit tests (7ebf24e, 94dbf3f).*
- *Step 5 ✅ route wiring — `/api/ai/generate` branches to `generateMultiCityItinerary` on `destinations[{city,nights}]`; **live-verified end-to-end** (Rome+Paris, real Gemini, 19.5s) + a preview surface at `app/[locale]/multi-city/page.tsx` (533e29f).*
- *Step 6 (partial) ✅ Journey ribbon — `components/trips/JourneyRibbon.tsx`, the §2.5 signature hero; **live-verified** (3-city Rome→Florence→Venice render). City chapters done. Share-card + crew avatars pending (91629dc).*
- ***NEXT: wire into the real wizard*** — multi-city mode toggle + city/nights rows on `NewTripWizard` step 1 behind `NEXT_PUBLIC_MULTI_CITY_ENABLED`, route the multi-city request through the JSON path, reuse `JourneyRibbon` on the wizard result + trip-detail. Then per-day-city edit plumbing (finding B) + `trip_meta.destinations` save wiring (step 8).*
- *Blocker fixed mid-session: local `.env.local` Gemini key was banned; replaced.*
