# Co-Creation Product Plan — August 2026

**Source:** power-user feedback (Ivan T., 2026-08-12) + four deep code investigations + prod data.
**Thesis it serves:** the durable value of MonkeyTravel over "ask Claude for an itinerary" is
co-creation — a plan that multiple people shape and that adapts while the trip runs. Everything
below is ranked by how directly it defends or extends that thesis.

**Prod sizing (2026-08-12):** 302 trips · 51 ever shared (17%) · 30 published · 180 (60%) reach
their start date · 36 multi-city (12%) · anchors used by 0 trips ever.

---

## Priority 1 — Real photos wherever the crew votes  *(protect the existing moat · S-M, ~2 days)*

**User words:** "Images matter more than they seem… I can't vote on a mood board of a random
glazed steak. My friends either form distorted ideas of places or leave MonkeyTravel to research
elsewhere."

**Root cause (investigated):** photo enrichment is bound to *save*, not *share* — and only to the
auto-save arm, which is behind `FLAG_AUTO_SAVE_V1` (default false). The manual Save button, forks,
duplicates, template copies and — critically — the **share and publish routes trigger no
enrichment at all**. On top: the per-call budget is 8 paid lookups while a typical trip has 15–25
unique activities; `refreshItineraryPhotos` (what `/shared` runs) repairs dead refs but never
upgrades curated→real; and there is **zero telemetry** on image realness.

**Design for the best result:**
1. **Trigger on share + publish** (server-side, in those routes, fire-and-forget) — enrich at the
   moment voters start arriving, with `reresolveCurated: true` and a raised budget
   (`SHARE_TIME_PAID_LOOKUPS = 25`) so whole trips convert.
2. **Also call enrich from the manual-save path** (parity with the autosave arm) at the default
   8-lookup budget.
3. **Make repeat calls cheap and safe:** stamp `trip_meta.photos_enriched_at` + skip re-entry
   within 24h (the 8/25-lookup budget currently resets on every POST — a share loop would
   multiply spend).
4. **Metrics or it didn't happen:** fix the `updated` response bug (returns day count), emit
   `photos_enriched {resolved, still_curated, paid_lookups}` to PostHog, and log the curated-vs-real
   ratio per shared trip. Success = **>90% of activities on newly shared trips show a real photo**.
5. **Backfill once:** run enrichment over the 51 ever-shared + 30 published existing trips.

**Cost ceiling:** worst case 25 fresh lookups × $0.022 ≈ **$0.55 per shared trip**, only on ~17%
of trips, amortized by the permanent `places_v2` place-id cache (575 distinct places already
served 760 activities). Monthly worst case at current volume: single-digit dollars. Existing
api-gateway kill switch stays as the circuit breaker.

---

## Priority 2 — Live replanning: the concierge learns "now"  *(build the second moat leg · M, ~4-6 days)*

**User words:** "Monkey, our flight tomorrow got cancelled — what if I stay one extra day here and
one less there?" / "We're 90 minutes behind — check if we're still on track, otherwise propose
alternatives."

**Structural finding:** the in-trip concierge is the **only chat hidden during the trip and the
only one that cannot edit**; the edit-capable assistant is available in-trip but knows nothing
about "today". Meanwhile the hard parts already exist: a confirm-then-apply endpoint with anchor
guards (`/api/ai/assistant/apply`), preview-change UI (`PreviewChangeCard`), an undo endpoint, a
proven `{reply, edit}` JSON contract (assistant-anon), and client-side current-activity/day-progress
computation that is currently dead code.

**Stage A — situational awareness (wiring, ~2 days):**
- Un-hide the concierge during the active phase; add an entry point inside `OngoingTripView`.
- Send what the model is currently starved of: client clock + timezone, per-activity `id`,
  `start_time`, `locked`, and completion state from `activity_timelines`.
- Multi-turn: replay the last N turns from `ai_conversations` into the prompt.
- Unify the three divergent "what day is it" implementations (server UTC vs client local — off-by-one
  in the Americas) into one shared helper.

**Stage B — the edit channel (~2 days):**
- Concierge responds with `{answer, proposal?}` where `proposal` is a today-scoped DayEdit; client
  renders the existing preview card; Apply posts to the **existing** `/api/ai/assistant/apply`
  (anchor guards, single write, `modifiedItinerary` as proof-of-write) with the same
  `claimedButUnverified` honesty guard the result-page assistant has.
- Invalidate the concierge's 60s trip cache on write.
- v1 access: owner applies; collaborators see suggestions read-only (all write paths are owner-scoped
  today — widening that is its own decision).

**Stage C — the cancelled-flight primitive (~1-2 days):**
- New apply change-type `shift_days` (push days N..M by K, recompute dates, update `end_date` the
  way `add_day` already does) — the only scenario in Ivan's examples the current vocabulary cannot
  express.

**Success metric:** weekly in-trip concierge users among active-phase trips, and % of concierge
proposals applied. This is also the WAU-north-star surface — 60% of trips reach their start date.

---

## Priority 3 — Plan quality pair: must-do wishlist + visible feasibility  *(shrink the 30% + kill the "just a list" feel · S+S, ~2-3 days combined)*

### 3a. Must-do wishlist (NOT anchors)
**User words:** "Maybe I want to see Zhangjiajie, climb the Great Wall, and eat Peking duck."
70% of what he wanted appeared; 30% didn't.

**Why not "promote anchors":** anchors are deliberately hidden (documented funnel guardrail after
the 1.5% step-1 crisis — collapsed state must stay near-zero weight) and are **date-pinned by
design**; undated wishes are already routed *away* from anchors. Usage after months: **zero trips**.
The concept doesn't fit the need.

**Design:** a light "Anything you must see, do or eat?" input on **step 2** (vibes step — past the
fragile step-1 gate, zero funnel risk): free-text chips, no dates, no geocoding. Flows into the
generation prompt as prioritized desiderata with the instruction *include each must-do on a
sensible day, or say why not*; persisted to `trip_meta.must_dos` so the assistant/concierge can
honor "add my must-dos" later. Instrument % of generations carrying must-dos + watch step2→generate.

### 3b. Feasibility strip (constraint solving, surfaced)
**User words:** "Constraint solving — you probably have it under the hood but not on the front end."
He's right: per-pair transfer times are computed, cached in `trip_meta.travel_distances`, and
rendered as pills; `DaySummary` already sits in the perfect slot on all four trip views. What's
missing is arithmetic and a verdict:
- Sum `duration_minutes` per day (computed nowhere today) + transfer total → "planned ~7.5h".
- Quantify pace for the first time (it is passed to the LLM as a bare word): relaxed ≈ 3 acts/≤6h,
  moderate ≈ 4/≤8h, active ≈ 5/≤10h — calibrated by our own data (3.99 acts/day, ~127 min each).
- Soft warning chip when planned+transfer exceeds the pace budget ("Day 3 looks packed") that
  deep-links to the assistant with a pre-filled fix prompt; implement the declared-but-unbuilt
  `longGap` suggestion while in there.
- Feed the same pace budgets into the generation prompt (currently "3-5 activities per day" is the
  only pacing rule) — better first drafts, fewer of the 7% "pacing" edit requests.
- Keep it advisory: the estimates are Haversine heuristics; the UI must not promise precision.

---

## Priority 4 — Transport spine, staged  *(answer "otherwise it's just a list of activities" · staged)*

**Reality check from the investigation:** Amadeus flight+hotel search is **fully built and hidden**
(components commented out, three live API routes with zero UI callers); the multi-city merge
inserts **no transfer legs** (explicit v1 non-goal); `JourneyRibbon` has a `transitFromPrev` slot
("TRAIN · 4h 10m") that no code ever fills; affiliate rails (incl. Omio for trains) exist but are
mostly pending approval; parsed flight bookings dissolve into itinerary JSONB.

- **v1 (S-M, do soon):** inter-city transfer legs in multi-city merges — a `transport` activity on
  each leg-boundary morning with an estimated mode+duration (pure code + heuristic, no API), and
  populate `JourneyRibbon.transitFromPrev`; render the ribbon on trip detail (today it only shows
  in wizard + ongoing view). Fix the latent `s*` regex bug in the cities splitter while there.
- **v2 (M):** arrival/departure buffer activities on day 1/N when the trip has a flight anchor or a
  parsed flight booking; iCal TZID fix (exported flight times are currently UTC-wrong).
- **v3 (M, monetization):** surface the already-built FlightSearch on trip detail behind a flag;
  fix `EnhancedBookingPanel` origin wiring (flights section currently always renders its empty
  state); revisit when Travelpayouts partners are approved.

---

## Deliberately NOT now
- Full transit routing (rome2rio-style), train/bus search engines, opening-hours validation
  (Google returns human strings, not intervals — a real project), multi-leg flight parsing,
  bookings table. All real, all after the four priorities prove out.

## Small fixes to fold into whichever workstream touches them first
- "Edit Trip" button is not role-gated → editor collaborators can edit then fail on save.
- Collaborators 404 on concierge-history (`verifyTripOwnership` vs the collaborator-aware check).
- `ActivityDetailSheet` "Booking Required" badge is not i18n'd.
- Dead code: `LiveJourneyHeader` import, unused `canEdit`, unused day-progress computations
  (Stage A of Priority 2 consumes these instead of deleting).

## Sequencing (importance-ranked above; this is the build order)
1. **P1 images** (~2 days) → ship + backfill + measure.
2. **P3a wishlist** (~1 day) and **P3b feasibility** (~1-2 days) — quick wins while P2 Stage A is specced.
3. **P2 live replanning** Stages A→B→C (~4-6 days across a week, each stage shippable alone).
4. **P4 v1 transfer legs** (~2 days), then v2/v3 as separate decisions.

Total to "Ivan's list fully answered at v1 depth": roughly two working weeks.
