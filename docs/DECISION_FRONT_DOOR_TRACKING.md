# Decision-First Front Door — Tracking & Go-Live Runbook

Companion to `docs/DECISION_FRONT_DOOR_PLAN.md`. Everything you need to (1) turn the
experiment on, (2) read it, (3) decide. The code is shipped **dark** (flag `front-door`
defaults to `wizard`); nothing below affects users until you create + flip the flag.

---

## 1. Turn it on (PostHog dashboard — the one manual gate)

The `front-door` flag must **exist** in PostHog before it can be flipped. The code reads it
and safely defaults to `wizard` until then.

1. **Feature flags → New feature flag**
   - Key: **`front-door`** (exact)
   - Type: **Multiple variants (A/B/n)**
   - Variants: `wizard` and `decision`
   - Rollout: start **`wizard` 100 / `decision` 0** (still dark), or go straight to **50 / 50**.
   - Release condition: **`is_identified = false`** (anonymous only — authed users are forced to `wizard` in code anyway, this keeps the sample clean).
   - **Persist flag across authentication: ON** (so an anon → sign-up mid-session keeps its arm).
2. **(Recommended) create an Experiment** on top of the flag: Experiments → New → feature flag `front-door`, control `wizard`, goal = the `first_value` custom event (or `trip_generation_completed`). Gives you significance + a stop recommendation automatically.
3. Flip `decision` to **50%**. The clock starts. **Instant rollback = set `decision` to 0%** (no deploy).

QA before flipping (real browser, not headless — see the tracking gotcha at the bottom):
`https://monkeytravel.app/trips/new?front_door=decision` → prompt → proposals → pick → confirm dates → itinerary → save wall. `?front_door=wizard` = untouched classic wizard.

---

## 2. Read it (Supabase `wizard_step_events` — validated queries)

Every event is tagged `front_door` (`wizard`|`decision`; `NULL` = pre-experiment baseline).
Run these in the Supabase SQL editor (project `sevfbahwmlbdlnbhqwyi`).

### 2a. Primary + guardrail, per arm (THE query)
```sql
with steps as (
  select session_id,
    max(front_door) as arm,
    bool_or(step = 'step_1_destination_dates') as reached_step1,
    bool_or(step = 'first_value')              as reached_first_value,
    bool_or(step = 'saved')                    as reached_saved
  from wizard_step_events
  where front_door is not null
    -- and created_at > now() - interval '21 days'   -- scope to the experiment window
  group by session_id
)
select
  arm,
  count(*) filter (where reached_step1)                         as step1_sessions,
  round(100.0 * count(*) filter (where reached_step1 and reached_first_value)
        / nullif(count(*) filter (where reached_step1),0), 1)   as first_value_survival_pct,  -- PRIMARY
  round(100.0 * count(*) filter (where reached_step1 and reached_saved)
        / nullif(count(*) filter (where reached_step1),0), 1)   as saved_pct                  -- GUARDRAIL (apples-to-apples)
from steps group by arm order by arm;
```
> **Read it right.** `first_value_survival` is NOT the same depth in each arm — decision's
> first-value = *proposals shown* (cheap), wizard's = *itinerary generated* (full flow). That
> gap is the whole thesis (value shown earlier). The honest end-to-end metric is
> **`saved_pct`** (`step_1 → saved`), which IS apples-to-apples. Watch both.

### 2b. Sample-ratio sanity (should be ~50/50 once flipped)
```sql
select max(front_door) as arm, count(*) as sessions
from wizard_step_events
where front_door is not null and step = 'step_1_destination_dates'
group by session_id;  -- wrap in an outer count if you want the raw split
```
A big skew from 50/50 means assignment/exposure is broken — investigate before trusting results.

### 2c. Where the decision arm drops (funnel)
```sql
select
  count(*) filter (where step='step_1_destination_dates') as step1,
  count(*) filter (where step='options_requested')        as requested,
  count(*) filter (where step='options_shown')            as options_shown,
  count(*) filter (where step='generating')               as generating,
  count(*) filter (where step='result')                   as result,
  count(*) filter (where step='saved')                    as saved
from (select distinct session_id, step from wizard_step_events where front_door='decision') d;
```

### 2d. Decide cost (should stay tiny)
```sql
select date_trunc('day', "timestamp") as day, count(*) calls, round(sum(cost_usd),4) usd
from api_request_logs where endpoint = '/api/ai/decide'
group by 1 order by 1 desc;
```

---

## 3. Decide (pre-committed rule — from the plan)

- **Ship to 100%** if decision `first_value_survival` ≥ **1.3×** wizard (e.g. 41%→55%+), sustained ≥ 2 weeks / ≥ ~150 sessions/arm, **AND** `saved_pct` does not fall by more than ~20% relative.
- **Kill** if survival ≤ wizard, OR survival rises but `saved_pct` collapses (cheap tire-kickers).
- **Iterate** (change the decide prompt/UX, not the thesis) in the murky middle.
- At ~25 sessions/day, trust big effects; ignore sub-detectable ones. Power: ~2.5 weeks for a thesis-sized 41%→55% lift.

---

## 4. Known non-blocking notes
- **Locale:** proposals now come back in the user's language (`locale` threaded to `/api/ai/decide`) and the UI is translated (en/it/es/pt) — the arm is fair across locales.
- **Dates:** the model prefers the next ~12 months; any past/invalid date is clamped forward before seeding the picker. The confirm-dates step is the final guard.
- **Consent-rejecters** never load PostHog → always control, excluded from the denominator. Acceptable.
- **HEADLESS QA GOTCHA:** monkeytravel.app blanks any automated/headless browser to `about:blank` after ~25-30s (bot-detection; the classic wizard blanks identically — it's environmental, not app). Use a **real human browser** for full multi-step click-through QA.

---

## 5. Optional future refinements (not needed to run)
- Add a `proposal_picked` event (new step + CHECK + zod) to split "saw proposals, didn't pick" from "picked, didn't confirm dates".
- Bootstrap PostHog with `mt_session_id` to kill the first-paint wizard→decision flicker (plan §8.3).
- Feed the winner into the broader growth funnel (see `docs/MULTI_CITY_PLAN.md`).
