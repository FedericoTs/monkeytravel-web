# Constraint-Aware Planning — Master Plan

**Status:** PROPOSED — awaiting Federico's go/no-go per phase. No code written.
**Date:** 2026-08-01
**Origin:** Founder dogfooding (Italy trip with Alyssa, Sep 9–15). Three failures identified in real use.

---

## 1. The Problem (founder-sourced, verbatim intent)

1. **"What's around me right now"** — mid-trip, off-schedule, the app can't help. It doesn't know where you are and can't replan from your position.
2. **"So many constraints that the app just offers its own trip"** — land Venice Sep 9 (Alyssa arrives), night of Sep 11 must be Trieste, Sep 12 wedding, Sep 13 family day, one culture day + one wine/food day somewhere, Sep 14 Venice sleeping near transport/parking, Sep 15 fly out. Zero of this is expressible today.
3. **"I already have a partial plan"** — no way to hand the app existing decisions and have it fill gaps / reorganize intelligently.

### Unifying diagnosis

All three are one missing primitive: **the app cannot accept user-owned state.** Every flow is blank-slate → AI authors everything → user tweaks. Real trips arrive with state: a position (case 1), immovable commitments (case 2), a partial plan (case 3). With no vocabulary for that state, the generator does the only thing it can — offer its own trip.

**MonkeyTravel today is a generator. This plan makes it a planner's assistant.**

---

## 2. Importance Validation (why this is the right bet)

| Evidence | Source | Implication |
|---|---|---|
| **74% of successful generations are never saved** (26% save rate) | PostHog 30d funnel, measured 2026-07-20 | Generic plans aren't worth keeping. A plan built around YOUR wedding/flight is. Anchors attack the #1 measured leak, not just UX polish. |
| 33% week-1 multi-city adoption; 326 cap-pinned sessions pre-launch | Multi-city wedge results | Users already push toward structural complexity. Anchors are the next step on the same demand axis. |
| ~8% of trips span multiple cities; avg ~6 nights; 50% are 4–7 night "long weeks" | Live trips DB (226 trips, queried 2026-08-01) | Real trips are constraint-shaped (arrivals, departures, mid-trip obligations). |
| Competitor scan 2026-07-27: Mindtrip/Layla = generation-first; Wanderlog = manual-first (AI paywalled at $39.99/yr) | This session's live research | **Nobody owns "I have constraints and a partial plan — help me finish."** Open lane; genuine moat vs. easily-copied prompt features. |
| Concierge/assistant already does day-scoped edits users accept | Session replays; assistant-anon is highest-traffic AI surface | Users trust bounded AI edits more than full regeneration — anchors formalize the boundary. |

**Ranking:** F1 (anchors) = highest business importance (attacks 74% leak + moat). F2 (import) = acquisition play against Wanderlog/Notes users, rides on F1. F3 (rescue) = retention/mobile differentiator, cheapest, but serves the smallest cohort today (in-trip usage is still tiny at 226 total trips).

---

## 3. Architecture: Anchors → Segments → Gap-Solving

**Core rule: the LLM never does global constraint satisfaction.** LLMs are unreliable at it and it's unverifiable. Deterministic TypeScript owns the constraints; the LLM only fills bounded, well-specified gaps.

```
anchors[] ──(deterministic segmentation)──► segments[] ──(per-segment LLM, parallel)──► merged itinerary
                                                                                          │
                                              deterministic validation ◄─────────────────┘
                                              (anchors intact, geography sane, dates exact)
```

This generalizes machinery that already exists and is proven in prod:
- `CityLeg { city, nights }` → generalizes to `Segment { from, to, dates, endConstraint }`
- `generateMultiCityItinerary` (per-leg parallel generation) → per-segment generation
- `mergeCityItineraries` + `addDaysISO` (just hardened, `b9e3ab6`) → merge
- `normalizeDraftDays` / day-scoped edit (assistant structural) → locked-day treatment & swaps

### 3.1 Data model (no migration needed)

```ts
// types/index.ts — follows the `destinations?` multi-city precedent exactly
export interface TripAnchor {
  id: string;                       // client-generated nanoid
  date: string;                     // YYYY-MM-DD — strict ISO (validation shipped b9e3ab6)
  time_slot?: "morning" | "afternoon" | "evening" | "all_day";
  start_time?: string;              // optional HH:MM
  type: "transport" | "event" | "lodging" | "meetup" | "custom";
  title: string;                    // "Wedding", "Land at VCE", "Night in Trieste"
  location?: string;                // free text: "Trieste"
  place?: { lat: number; lng: number; place_id?: string }; // optional geocode
  notes?: string;                   // "sleep near parking/transport"
}

// TripCreationParams gains:
anchors?: TripAnchor[];             // max 10; all dates within [startDate, endDate]
```

Persistence: `trip_meta.anchors` (JSONB — same pattern as `trip_meta.cities`). Zero migration. A dedicated column can come later if we query on it.

```ts
// lib/ai/anchors-core.ts — PURE, vitest-covered (mirror of multi-city-core.ts)
export interface TripSegment {
  startDate: string; endDate: string;          // inclusive free days
  startNear?: string;                          // location of previous anchor
  mustEndNear?: string;                        // location of NEXT anchor (hard constraint)
  partialDays: { date: string; freeSlots: TimeSlot[] }[]; // days shared with an anchor
  preferences?: string;                        // gap-level asks ("one wine/food day")
}
export function segmentTrip(params, anchors): { segments: TripSegment[]; anchorDays: AnchorDay[] }
export function validateAnchors(anchors, startDate, endDate): void  // throws typed errors
export function validateMergedItinerary(days, anchors): ValidationIssue[]
```

### 3.2 Generation flow changes

`/api/ai/generate` (+ stream): new branch beside `isMultiCity`:
1. `validateAnchors` (strict ISO dates, within range, ≤10, no two all-day anchors same day).
2. `segmentTrip` → segments + anchor days.
3. Per-segment generation in parallel (reuse multi-city executor). Segment prompt additions:
   - "The traveller starts this segment near **{startNear}**."
   - "**HARD CONSTRAINT:** the final day must end within easy evening reach of **{mustEndNear}** — they have *{next anchor title}* there the next {slot}."
   - Segment-scoped preferences ("dedicate one day to wine & food culture").
4. Anchor days: render the anchor as a **locked activity** (new `locked: true` field on Activity, additive/optional — old clients ignore it); LLM fills only the remaining free slots of that day ("light morning before the wedding"), via the existing day-scoped generation shape.
5. Deterministic merge (generalized `mergeCityItineraries`) → dates from `addDaysISO`.
6. `validateMergedItinerary`: every anchor present & untouched; last-day-of-segment activities within distance budget of `mustEndNear` (existing `/api/travel/distance` infra / haversine on activity coords). One retry with corrective feedback on violation; if still violated → flag day in UI ("check this day"), never silently ship a broken plan.

Cost: 2–4 segments ≈ multi-city cost today (~$0.003–0.01/trip). Anchored trips **skip the cross-user cache** (they're personal by definition) — correct, not a regression; cache exists for generic trips.

### 3.3 Wizard UX (protecting the funnel)

Step-1→2 conversion is a historically fragile metric (launch-blocker #371). Therefore:
- **Progressive disclosure**: one quiet link under dates in step 1 — "➕ I have fixed plans (flights, events, bookings)". Collapsed by default. Default flow pixel-identical.
- Anchor editor: date picker (bounded to trip range) + type chips + title + optional place (reuse `DestinationAutocomplete`) + optional note. List of added anchors as removable chips.
- **Phase B — natural language**: textarea "describe your constraints in your own words" → Gemini structurizes → **user confirms parsed anchor chips before generation** (human-in-the-loop; trust + correctness). The Italy paragraph above becomes 6 confirmed chips.
- Result view: anchor days pinned (lock icon, distinct card treatment); "Regenerate day" on an anchor day becomes "Regenerate around your {title}"; editing/removing an anchor re-solves only affected segments.

### 3.4 Feasibility evidence (verified in code this session)

| Claim | Evidence |
|---|---|
| Params extension has exact precedent | `TripCreationParams.destinations?` — same optional-array wedge, types/index.ts:366 |
| Per-leg parallel generation + merge exists | `lib/ai/multi-city.ts`, `multi-city-core.ts` (`mergeCityItineraries`, 15 passing tests) |
| Strict date validation at boundary | Shipped `b9e3ab6` + regression tests (proven failing pre-fix) |
| Day-scoped LLM edits proven in prod | `lib/ai/assistant-anon.ts` (single-day revise), `assistant/structural.ts` (`normalizeDraftDays`) |
| Locked-day UI has precedent | Per-day regenerate button + EditableActivityCard already per-day scoped |
| JSONB persistence without migration | `trip_meta.cities` precedent |

**Feasibility: HIGH.** Main net-new code: `anchors-core.ts` (pure, testable), segment prompt variant, wizard panel.

### 3.5 Effort & phases

| Phase | Scope | Effort |
|---|---|---|
| **F1-A** | Structured anchor editor + segmentation + generation + locked result view | **5–7 dev-days** |
| **F1-B** | NL constraint parsing → confirmed chips | +1–2 days |

Risks & mitigations:
- *LLM ignores end-near constraint* → deterministic validation + 1 corrective retry + UI flag (never silent).
- *Wizard complexity hurts funnel* → collapsed-by-default; guardrail metric: step-1→2 conversion must not move.
- *Geocoding cost* → `place` optional; reuse rate-limited autocomplete; validation degrades to city-name string match when no coords.

---

## 4. F2 — Import & Improve ("Finish my plan")

An imported plan is just **anchors + known activities + preferences** → same gap-solver. F2 is a front-end to F1.

- **Phase A — paste text** (2–3 days after F1): "Already have a plan?" entry on `/trips/new` + the assistant (`detectDraftPaste()` already exists in `assistant/structural.ts`). Extraction prompt (precedents: `lib/email-parse/extract.ts`, `lib/gemini-vision.ts`) → `{ anchors[], plannedActivities[], preferences }` → confirmation screen (same chip UI as F1-B) → gap-solve.
- **Phase B — photo/screenshot** (+1 day): `gemini-vision.ts` already does image→trip for Start Anywhere; point it at the new extraction schema.
- **Phase C — reorganize an existing saved trip** (+2 days): "Fill gaps / optimize" on trip detail. Current itinerary in, proposals out as **confirm-first diff cards** (exact concierge pattern already shipped). Never auto-mutates.

Feasibility: MEDIUM-HIGH (all extraction machinery exists; depends on F1's model). Acquisition angle: directly targets the Wanderlog/spreadsheet/Notes audience — the manual-planner segment that today has no reason to switch.

---

## 5. F3 — Rescue Mode ("What's around me right now")

- **Client geolocation**: `navigator.geolocation` (web) + `@capacitor/geolocation` (**not yet installed** — verified). Permission requested only on explicit tap, never ambient.
- **New endpoint** `POST /api/nearby/suggestions`: `{ lat, lng, tripId, remainingSlots }` → Places Nearby Search filtered by trip vibes + open-now + time-of-day → ranked 5–8 suggestions.
  **Cost controls (non-negotiable — Places is the #1 cost line):** per-user cap ~10/day (Upstash, proven pattern), coarse-geohash + category cache 24h, explicit-tap-only.
- **UI**: "📍 Right now" in `OngoingTripView` (exists; already computes `currentDayNumber`, has complete/skip actions) → bottom sheet → one-tap "swap into today" via the day-edit apply machinery.
- **The differentiator vs Google Maps**: schedule-awareness — "you can still make your 19:00 dinner if you stay within 15 min of here" (existing `travel_distances` infra). Maps knows what's near you; we know what's near you *and what you're supposed to do next*.

Effort: **3–4 days**. Feasibility: HIGH technically; MEDIUM on cost (managed by caps). Best surface for the mobile app launch; weakest near-term reach (in-trip users are few today).

---

## 6. Places / Maps API Cost Design (BINDING — Places is the #1 expense)

### 6.0 Invariants already in prod (verified in code 2026-08-01 — must NOT regress)

| Invariant | Where |
|---|---|
| Trip **generation costs $0 in Google calls** — `maxPaidLookups: 0` | `app/api/ai/generate/route.ts:358`, `stream/route.ts:379` |
| Paid photo lookups only at **save**, capped at **8/trip** (+2 refresh) | `SAVE_TIME_PAID_LOOKUPS = 8`, `PHOTO_REFRESH_PER_TRIP = 2` (lib/images/activity.ts) |
| 21-day photo-ref freshness guard; place_id-keyed cache; `PLACES_ACTIVITY_PHOTOS_ENABLED` kill switch | lib/images/activity.ts |
| Autocomplete + hotels/places already rate-limited (per-IP / 60/24h) | existing limiters |

### 6.1 Hard rules for the new features

**F1 Anchors — budget: $0.00 in new Google calls.**
- Segment generation reuses the existing generation path → inherits `maxPaidLookups: 0` automatically.
- Geometry validation (activity near `mustEndNear`?) uses **haversine on Gemini-provided activity coords** — free. **Distance Matrix / Routes calls are banned inside the solver.** Fallback when no coords: city-name string match.
- Anchor geocoding is **optional**: the `place` field fills only if the user actively picks from the existing rate-limited, cached autocomplete (a session they'd already be paying for by typing). Result stored on the anchor — never re-looked-up. Free-text `location` is the default and fully sufficient for the solver.

**F2 Import — budget: $0.00 at import time.**
- Extraction is Gemini-only. Imported activities render with curated type-based thumbnails (existing system). Real photos resolve only through the **existing** save-time enrich-photos budget (8/trip) — no new budget line created.

**F3 Rescue Mode — the ONLY feature allowed to spend, inside a sealed envelope:**
1. **Explicit tap only.** No ambient location polling, no prefetch, no on-page-load calls. Ever.
2. **Exactly one Nearby Search (New) call per tap**, `maxResultCount: 10`, wide `includedTypes` in that single call — never one call per category. Ranking/filtering (vibes, open-now, time-of-day) happens in our code on the one response.
3. **Field mask pinned to the cheapest SKU tier** (`places.id, places.displayName, places.location, places.types, places.primaryType`). Adding fields silently escalates the SKU — any field-mask change requires re-verifying the SKU in Cloud Console (same protocol as the 2-call SKU split, task #368/#370).
4. **No Places photos in the rescue sheet.** Curated type-based thumbnails only. (Photos were 71% of all Places spend historically — this is the single biggest guard.)
5. **Per-user cap: 10 taps/day** (Upstash limiter, proven pattern) + **geohash(≈150 m) × category × 3h-time-bucket cache, 24h TTL** in the existing places cache table — repeat taps in the same area cost $0.
6. Schedule feasibility ("you can still make your 19:00 dinner") = **haversine + speed heuristic, $0**. A real Routes call happens only *after* the user taps one specific suggestion (cost deferred to intent) — and even that is Phase-2 optional.
7. **Observability from day 1:** log as `apiName: "places_nearby"` in api_request_logs so it appears in the admin cost dashboard; alert if daily nearby spend exceeds **$2/day** (kill switch env var `NEARBY_SUGGESTIONS_ENABLED`, mirroring `PLACES_ACTIVITY_PHOTOS_ENABLED`).

**Worst case F3 spend:** 10 taps × ~$0.032 = **$0.32/user/day**; with the geohash cache and realistic usage, pennies. Global ceiling enforced by the $2/day alert + kill switch.

### 6.2 Net cost impact of the whole plan

| Feature | New Google spend |
|---|---|
| F1 Anchors (all phases) | **$0** |
| F2 Import (A/B/C) | **$0** at import; save-time photos inside the existing 8/trip budget |
| F3 Rescue | Capped, cached, observable, kill-switchable; ~pennies/day realistic |

## 7. Sequencing, Metrics, Open Decisions

**Recommended order:** F1-A → F2-A → F3 → F1-B → F2-B/C. ≈ 2.5–3 weeks of focused work, each phase independently shippable. (Swap F3 earlier only if app-store launch timing demands a demo-able mobile feature.)

**Success metrics:**
- F1: save-rate of anchored trips vs 26% baseline (target ≥ 2×); % of new trips using ≥1 anchor; **guardrail: step-1→2 conversion unchanged**.
- F2: imports started/completed; save-rate of imported trips.
- F3: rescue opens per active trip; swap-acceptance rate; app D7 retention.

**Open decisions for Federico:**
1. Anchors free for everyone, or a future premium hook? (Recommend: free — it's the moat and the save-rate fix; monetize later.)
2. Rescue Mode Places budget: is ~10 nearby-searches/user/day (≈ $0.32/user/day worst case, realistically pennies) acceptable?
3. F1-A UI ships behind a flag (`NEXT_PUBLIC_ANCHORS_ENABLED`) for a soft launch, or straight on?

**Dogfood acceptance test:** the Italy trip. F1-A is done when Federico can enter the six anchors, ask for one culture day + one wine/food day, and get a plan that puts him in Trieste on the night of the 11th and near Venice transport on the 14th — without fighting the app.
