# Decision-First Front Door — Experiment & Build Plan

**Status:** planned, not built. **Author:** cost/strategy session 2026-06-30.
**One-liner:** A/B a new front door where an anonymous user types one open prompt and gets **2–3 destination/trip-shape proposals to choose from** (a *decision*), instead of filling a multi-step form to get an itinerary (a *document*). Test whether repositioning the value moment from "itinerary" to "decision" survives the step-1 cliff.

---

## 0. Why (the bet, from data)

Real 30-day funnel (756 wizard sessions): **step_1 → step_2 loses 54%** — people type a destination and bail before submitting. Only ~41% ever see an itinerary; ~4% save; **7 users in the app's lifetime ever returned to plan again.** The itinerary is a commodity artifact users don't value (2–3 saves/day). The **decision** ("where should I even go?") is the atom AI uniquely 10×'s and no incumbent owns. This experiment tests that thesis at the cheapest possible point: the front door.

**Non-goal:** this is not a rewrite. The wizard stays the control; the result page, generation, save, share, and enrich paths are **reused byte-for-byte**. Flag off = today's product, exactly.

---

## 1. Experiment design

| | |
|---|---|
| **Flag** | `front-door` (PostHog multivariate), variants `wizard` (control) \| `decision`. Default/holdout = `wizard`. |
| **Population** | **Anonymous sessions only.** Authenticated users forced to `wizard`. |
| **Assignment** | PostHog anon `distinct_id` cookie (stable per browser across reloads). "Persist flag across authentication" = ON so an anon→signup mid-experiment keeps its arm. Release condition `is_identified = false`. |
| **Primary metric** | **step_1 → first-value survival.** Wizard first-value = `result`; decision first-value = `options_shown`. (Both fire a shared `first_value` event — see §4.) |
| **Secondary** | result→save rate per arm; `generating`→`result` completion; Concierge/edit engagement; save→return (retention proxy). |
| **Guardrails** | (a) decision arm must **not lower** result→save (risk: more low-intent browsers survive step-1 but don't convert); (b) LLM cost/session (decide adds ~$0.0004); (c) generation error rate; (d) Places cost unchanged (decide makes no Places calls). |

### Power / duration (be honest about the volume)
~25 sessions/day → ~12.5/arm/day. Primary metric base ≈ 41% (high-N).
- Detect 41% → 55% (thesis-sized lift): ~200/arm → **~2.5 weeks**.
- Detect 41% → 48% (small): ~1000/arm → ~3 months (too slow — don't chase).
Bottom-line **save rate (4%) is too low-N to A/B** (5+ weeks for a doubling) — that's why the primary is the high-N top-of-funnel metric, with save as a directional guardrail.

### Pre-committed decision rule (write it down before starting the clock)
- **Ship to 100%** if decision-arm first-value survival ≥ **1.3× wizard** (e.g. 41%→55%+), sustained ≥ 2 weeks / ≥ ~150 sessions/arm, **and** result→save does not fall by more than ~20% relative.
- **Kill** if survival ≤ wizard, or if survival rises but result→save collapses (i.e. we just added cheap tire-kickers).
- **Iterate** (change the decide prompt/UX, not the thesis) if in the murky middle.
- At 25/day, **trust big effects, ignore sub-detectable ones.**

---

## 2. Architecture (the decision flow)

```
[anon /trips/new]
   │  useExperiment("front-door") → arm
   ├── arm = wizard  → <NewTripWizard> (UNCHANGED control)
   └── arm = decision → <DecisionIntake>
         1. one open prompt textarea  ── fire step_1_destination_dates (shared denominator)
         2. submit → POST /api/ai/decide  ── fire options_requested   (~$0.0004, Flash-Lite, ~1–2.5s)
         3. render 2–3 proposal cards    ── fire options_shown = FIRST VALUE
         4. user picks one → confirm dates (reuse <DateRangePicker>)
         5. map proposal → TripCreationParams
         6. setState(destination,dates,vibes,…) then call handleGenerate()  ← REUSE
              → /api/ai/generate/stream (UNCHANGED)  ── generating → result
         7. result view / save / share / enrich       ← ALL REUSED (render at NewTripWizard.tsx:1596)
```

**Seam:** `NewTripWizard.tsx:2372` (immediately before the wizard-form `return`). The two earlier early-returns — `if (generatedItinerary)` (:1596, result) and `if (generating)` (:2360) — are **decoupled from `step`** and are inherited for free by any arm that ends in `setGeneratedItinerary(...)`. So we branch **only the form return**.

**Key reuse fact:** `handleGenerate` (:1027) reads all inputs from component state, not arguments. The decision arm sets the same state the wizard's save path reads (`destination, startDate, endDate, selectedVibes` — confirmed identical set used by `handleSaveTrip`/auto-save), then invokes `handleGenerate()` after a tick (mirror the existing `setTimeout(()=>handleGenerate(),100)` retry pattern at :2318/:2397).

---

## 3. File inventory

### New files
| File | Purpose |
|---|---|
| `lib/ai/decide.ts` | The "propose options" logic. **Clone `lib/ai/packing-list.ts:178-248`** (prompt-embedded JSON shape + `responseMimeType:"application/json"` + defensive parse). |
| `app/api/ai/decide/route.ts` | POST endpoint (thin; validation + rate-limit + call `lib/ai/decide`). |
| `components/wizard/DecisionIntake.tsx` | The decision-arm UI: prompt → proposals → pick → date-confirm → `onPicked`/`onGenerate`. |
| `supabase/migrations/2026XXXX_wizard_event_front_door.sql` | Add `front_door` column + new step enum values + fix CHECK drift (see §4). |

### Touched files
| File | Change |
|---|---|
| `lib/posthog/flags.ts` | Add `FLAG_FRONT_DOOR="front-door"`, `FrontDoorVariant`, `FLAG_DEFAULTS[FLAG_FRONT_DOOR]="wizard"` (near `:206`/`:253`, mirror `FLAG_WIZARD_LAYOUT`). |
| `app/[locale]/trips/new/NewTripWizard.tsx` | Read `useExperiment(FLAG_FRONT_DOOR)`; `const arm = isAuthenticated ? "wizard" : (variant ?? "wizard")` (isAuthenticated at :248); branch at **:2372**; hoist `trackWizardEvent`+`WizardEventStep` to a shared module; `posthog.register({ front_door: arm })` once on mount. |
| `lib/ai/model-router.ts` | Add purpose `"decide" → gemini-2.5-flash-lite` (mirror packing-list/trip-title). |
| `app/api/wizard-event/route.ts` | Add `options_requested`,`options_shown` (+ drifted `save_blocked_anon`,`save_failed`) to zod `STEP_VALUES` (:36-46); add `front_door` to `BodySchema` (:48-55) + `.insert` (:177-186). |
| `lib/gemini.ts` | Export `BLACKLIST`/`DANGEROUS_PATTERNS` (or add `sanitizeFreeText()`) so `/api/ai/decide` reuses the prompt-injection guard from `validateTripParams`. |
| `instrumentation-client.ts` | *(Optional, Phase 3)* add `bootstrap` to `posthog.init` (:246) using `mt_session_id` as `distinctID` to kill first-paint flicker. Respect the ATT guardrail block (:221-245) — add nothing else. |

---

## 4. Instrumentation (same yardstick for both arms)

**DB fix first (blocks clean analysis):** `wizard_step_events` CHECK constraint (`...20260531_wizard_step_events.sql:55-63`) lists only 7 steps — it's **missing `save_blocked_anon` and `save_failed`** that the route/client already fire (they currently 500 → PostHog-only). The migration must:
1. Add `options_requested`, `options_shown`, `save_blocked_anon`, `save_failed` to the CHECK.
2. Add `front_door TEXT CHECK (front_door IN ('wizard','decision'))` nullable column.
3. Keep the three "lockstep" locations in sync: DB CHECK, `route.ts` zod `STEP_VALUES`, client `WizardEventStep` union (`NewTripWizard.tsx:165-174`).

**New events (decision arm):**
- `step_1_destination_dates` — **reused** (shared denominator), fire on intake mount (once-guard like `:351-354`).
- `options_requested` — **new**, on decide-call dispatch (≈ wizard's `generating`).
- `options_shown` — **new = FIRST VALUE**, when proposals render (≈ wizard's `result`).
- `first_value` — **new shared** event both arms fire (wizard alongside `result`, decision alongside `options_shown`) → clean cross-arm numerator with no CASE. *(Decision to confirm: shared `first_value` vs. arm-CASE. Recommend shared.)*
- pick → **reuse** `generating` → `result` → `save_*` (all shared post-pick).

**Arm tagging:** Supabase = `front_door` column passed in every `trackWizardEvent(step,{front_door})`. PostHog = `posthog.register({ front_door })` once (rides on every capture + `$pageview`, zero per-call edits). Exposure = automatic `$feature_flag_called` from `useExperiment`.

**Survival SQL (both arms):** denominator = sessions with `step='step_1_destination_dates'`; numerator = same session has `step='first_value'`; split by `front_door` (taken from the session's `step_1` row).

**PostHog experiment:** create on flag `front-door`, control=`wizard`, primary = funnel `$feature_flag_called(front-door)` → `first_value` (or `trip_generation_completed`), release condition `is_identified=false`, persist-across-auth ON.

---

## 5. `/api/ai/decide` spec

- **Input:** `{ prompt: string(3–500), month?, nights?, budgetHint?, travelStyle?, origin? }`. Run `prompt` through the existing `BLACKLIST`/`DANGEROUS_PATTERNS` scan before the model.
- **Output:** `{ proposals: [{ id, destination(allowlist-safe), trip_shape{days,pace,theme}, why, tradeoff, budget_fit{tier,rough_total_usd,note}, suggested_dates{start,end}, vibes[1–3 from valid set], interests[] }], meta }` — 2–3 items.
- **Model:** `getModelForPurpose("decide")` → `gemini-2.5-flash-lite`, `temperature 0.7, responseMimeType "application/json", maxOutputTokens 1024, thinkingBudget 0`. Clone `packing-list.ts`. **~$0.0004/call, ~1–2.5s.**
- **Defensive parse:** clamp to 2–3; drop proposals whose `destination` fails `DESTINATION_ALLOWLIST` or `vibes` not in the valid set; backfill `vibes=["cultural"]` if empty (so the later `validateTripParams` can't 500).
- **Rate limit (do NOT touch the 2/day generation quota):** `createRateLimiter("anon-decide", 60, 24h)` per-IP fail-open + `createRateLimiter("anon-decide-burst", 10, 60s)` keyed on session (customKey). Reuse `checkApiAccess("gemini")` kill-switch. Log `logApiCall({apiName:"gemini", endpoint:"/api/ai/decide", costUsd:0.0004})`.
- **Pick → params mapping:** `destination←proposal.destination`, `startDate/endDate←suggested_dates` **(user confirms via DateRangePicker — the one genuine must-ask; guards validateTripParams date rules)**, `budgetTier←budget_fit.tier`, `vibes←proposal.vibes`, `interests←proposal.interests`, `pace←trip_shape.pace`, `requirements←original prompt`, `travelStyle←echo`. Everything else defaults. Then the **unchanged** generator runs.

---

## 6. Build phases (each ships dark & reversible; flag default `wizard` = zero behavior change until we flip it)

**Phase 0 — Scaffolding (no user-visible change).** Flag def in `flags.ts`; migration (front_door column + step enum + CHECK-drift fix) applied; hoist `trackWizardEvent`; `posthog.register({front_door})`. Verify: tsc, migration applied, wizard funnel still records. *Reversible: nothing branches yet.*

**Phase 1 — `/api/ai/decide` (backend only).** `lib/ai/decide.ts` + route + model-router `"decide"` + rate limiters. Verify by **curl on prod** (local Gemini key is banned — same constraint as the cost work): `POST /api/ai/decide {"prompt":"relaxed food trip in Portugal, ~$1500, late July, 5 nights"}` → 2–3 valid proposals, cost logged in `api_request_logs` as `/api/ai/decide`. *Reversible: endpoint exists but nothing calls it.*

**Phase 2 — `DecisionIntake` UI + seam (behind flag, still default `wizard`).** Build the component (prompt → proposals → pick → date-confirm), wire the seam at `:2372`, fire the new events, map pick → `handleGenerate`. Verify on prod by forcing the flag for your own session (PostHog override / `?ph_front-door=decision`): full flow prompt → options → pick → itinerary → save, images clean, events land in `wizard_step_events` with `front_door='decision'`. *Reversible: flag still default wizard for everyone else.*

**Phase 3 — QA + turn on.** Cross-browser/mobile pass; empty/garbage-prompt handling; decide-failure fallback (→ show a graceful retry or drop the user into the wizard). *(Optional: bootstrap for flicker.)* Then flip PostHog experiment to **50/50 anon**. Start the clock. *Reversible: flag → 0% instantly reverts.*

**Phase 4 — Read & decide.** ~2–3 weeks; apply the §1 decision rule. Ship-100 / kill / iterate.

---

## 7. Guardrails, rollback, risks

- **Instant rollback:** set flag to 0% `decision` → everyone on the wizard, no deploy. The control path is literally untouched code.
- **Cost:** decide is Flash-Lite + tiny output + its own rate limiter; makes **zero Places calls** (inherits the June-2026 cost fix — Places only on save). Worst case ~$0.0004 per bounced session.
- **The real risk isn't technical — it's proposal quality.** If the 2–3 proposals are generic/wrong, the whole thesis fails on execution, not principle. The decide **prompt** is the make-or-break; budget real iteration there (few-shot examples, force distinct/non-obvious options, respect budget+origin realism). QA the proposals like a product, not a JSON blob.
- **Survival-without-conversion trap:** decision arm could lift step-1 survival by attracting low-intent browsers who never save. That's why result→save is a hard guardrail, not a nice-to-have.
- **Date hallucination:** the confirm-dates step is mandatory (not optional) to stop `validateTripParams` 500s on stale/invalid model dates.
- **Consent-rejecters** never load PostHog → always control, excluded from the experiment denominator. Acceptable; just know it.

## 8. Open decisions to lock before building
1. Shared `first_value` event vs. arm-CASE numerator → **recommend shared**.
2. Decision arm: keep it **minimal** (prompt only) or carry solo/group + backpacker + multi-city? → **recommend minimal for v1** (fewest atoms; the whole point is subtraction). Add back only if data demands.
3. Bootstrap for flicker now (Phase 0) or accept the wizard→decision flip on first paint and gate on `variant==="decision"` only? → **recommend accept flicker for v1**, add bootstrap only if it reads as janky.
4. Where the prompt lives: replace step 1 in-place on `/trips/new`, or a distinct surface? → **recommend in-place** (same URL, same entry points, same flag surface).
