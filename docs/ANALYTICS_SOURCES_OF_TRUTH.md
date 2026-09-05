# Analytics — sources of truth, and how to read a traffic alarm

**Date:** 2026-09-05 · **Status:** binding for every traffic number quoted in a plan, a PR, a dashboard or a conversation. Phase 0.5 of `LIVE_TRIP_MASTER_PLAN.md`.

This exists because of one week in which three different instruments told three different stories about the same traffic, and the loudest one was wrong. Read it before interpreting any change in visitors, sessions or page views.

---

## 1. The instruments, and what each one is for

| Instrument | What it measures | Use it for | Never use it for |
|---|---|---|---|
| **`page_views_human`** (view) → `page_view_rollup` → the admin RPCs | Every request the middleware saw, minus self-declared crawlers (`is_bot`), minus sessions labelled as automation (`page_view_session_labels`) | **Traffic. Visitors. Engagement. The only source for "how many people".** | — |
| `page_views` (raw table) | Everything, including crawlers and automation | The denominator of the automation-share guardrail; forensics on a specific session | Any headline number. It is inflated by ~10–40% depending on the day |
| `page_view_session_labels` | One row per (session, day) judged automation, with the reason | Explaining *why* a day looks odd; auditing the labelling rules | — |
| `session_engagement` | Sessions that fired the 4-second engagement beacon (since 2026-09-02) | The "is this a person" signal behind the labelling rules; engaged-session counts | Anything before 2026-09-02 |
| `trip_views` | One row per (trip, session, UTC day) open, from 2026-09-05 | **The North Star (TODT).** Whether a trip is opened while it happens | Volume — it counts opens of trips, not visits to the site |
| `wizard_step_events` | Wizard funnel steps per session | Activation: step-1 → step-2 → result → saved | — |
| **Google Search Console** (`scripts/gsc-daily.mts`) | Clicks and impressions from Google search, on Google's own pipeline | **The independent check.** If organic clicks are flat, real search traffic did not move, whatever anything else says | Non-search traffic; anything more recent than 2 days ago (it lags) |
| **GA4** | Sessions from visitors who **accepted cookies**, processed by Google | Behaviour of consented users; anything that needs GA4's own reports | **Traffic volume, ever.** See §2 |
| `get_live_trip_baseline()` / `scripts/baseline-snapshot.mts` | All of the above, in one reproducible block over the last N full UTC days | The plan's baseline and the weekly ritual | Hand-edited numbers |

Two rules follow from the table:

1. **A traffic number that did not come from `page_views_human` (or the rollup and RPCs built on it) is not a traffic number.** It is a lead to investigate.
2. **GSC is the tie-breaker.** It shares no code, no cookie and no pipeline with anything we run.

---

## 2. Why GA4 cannot measure our traffic

GA4 is loaded only after the visitor accepts cookies (`components/consent/*`; the consent fix of 2026-08 gates the *mount*, not just Consent Mode). Most visitors never accept, so GA4 sees a **minority sample** whose size depends on the consent rate that day, the locale mix and the device mix. Its absolute numbers are small and its day-to-day swings are dominated by who happened to click "Accept".

On top of that, GA4's standard reports had a **platform-wide processing bug from 2026-09-01** that showed sharply reduced or zero traffic while collection continued (acknowledged by Google; Realtime kept working). So on the one day it mattered, GA4 was both structurally partial and actually broken.

GA4 is fine for what it is: the behaviour of consented users inside Google's tooling. It is not, and by construction cannot be, the count of people who came. `docs/GA4_SETUP_GUIDE.md` covers its configuration; nothing in it changes this.

---

## 3. The worked example: 1–2 September 2026

**What GA4 said:** total users fell from 486 on Sept 1 to 75 on Sept 2, **−84.57%**, "almost certainly a widespread GA4 data processing issue rather than an actual loss of traffic".

That conclusion was right; its reasoning was not usable, because GA4 explaining a GA4 drop is not evidence. Two instruments that share nothing with GA4 settled it:

**Search Console** (organic clicks, Google's pipeline): Sept 1 = **187**, against a 28-day median of **188**. Flat to within one click. Real search traffic did not move.

**First-party `page_views`**, before labelling: Sept 1 was not a normal day — it was **inflated**. 20,600 raw views against a ~9,000 baseline, and the excess traced to one place: Cittadella, Italy, **612 sessions, one Chrome user-agent, 6,865 views, ~62 sessions per hour for seven hours, 0.0% engaged**. A scheduler, not people. Sept 2 (9,204 raw) was inside the previous week's normal range.

So "−84.57%" compared a bot-inflated day to a normal one, in an instrument that was also broken. The corrected week, from the rollup after labelling (Phase 0.2):

| Day | raw `all` | human `total` | **human visitors** | labelled | reason |
|---|---|---|---|---|---|
| Aug 29 | 8,771 | 6,503 | 1,380 | 0 | — |
| Aug 30 | 10,294 | 8,336 | 1,423 | 0 | — |
| Aug 31 | 10,177 | 7,976 | 1,252 | 0 | — |
| **Sep 1** | **20,600** | 10,003 | **1,456** | **6,759** (605 sessions) | `legacy_sweep` |
| Sep 2 | 9,204 | 6,209 | 1,182 | 1,003 (12) | `heavy_unengaged` |
| Sep 3 | 8,122 | 5,915 | 1,119 | 264 (3) | `heavy_unengaged` |
| Sep 4 | 8,917 | 7,062 | 1,266 | 0 | — |

Human visitors Sept 1 → Sept 2: **1,456 → 1,182, −19%**, inside the week's own range of 1,119–1,456. Nothing happened. (Sept 1's human *views* still sit ~25% above their neighbours: the rule for days before engagement data exists is deliberately strict and catches only the single-user-agent sweep. That residue is documented, not hidden.)

One more thing the raw data revealed: the sweep came from **Cittadella**, and so did an earlier `MonkeyTravelAudit/1.0` run. Cittadella is the founder's own town. The "best day in the site's history" was most likely our own QA tooling. It is labelled either way: automation is automation.

---

## 4. How to read the next alarm — in this order

1. **Search Console first.** `npx tsx scripts/gsc-daily.mts`. If organic clicks are flat, real search traffic did not move. Stop treating it as a traffic loss.
2. **Human view by day.** `select day, views, unique_visitors from page_view_rollup where dimension = 'total' order by day desc limit 14`. Compare the alarming day to the *previous week's range*, not to the day before it.
3. **Was the reference day inflated?** `select reason, count(*), sum(views) from page_view_session_labels where day = '<day>' group by 1`. A big `legacy_sweep` or `ua_city_sweep` on the day *before* the drop means the drop is the sweep ending.
4. **Raw vs human on that day.** `page_view_rollup` dimension `all` vs `total`. A gap far above the usual 10–25% is automation, labelled or not yet labelled.
5. **Device and country split** of the suspicious sessions. Real consumer traffic on a travel site is mobile-heavy and spread across plausible markets; desktop-skewed, single-city, zero-engagement traffic is a script.
6. **Only then GA4**, and only for consented-user behaviour. Never to size the change.
7. **Do not change tracking, tags or middleware in response to a number** until steps 1–5 are done. And **never block traffic** (standing rule): label it.

---

## 5. Things that will mislead you, and have

- **`is_bot` only knows self-declared crawlers**, on purpose (`lib/analytics/bot-detection.ts` explains why). A script presenting Chrome is invisible to it. The label table is the second layer; its rules are in migration `20260905090000`.
- **"≥ N views in a day = bot" is a wrong rule.** Engagement *rises* with view count (0.4% of 1–2-view sessions fire the beacon; 33.9% of 50+). The heaviest sessions are disproportionately real, engaged people. The automation tell is the *group* (one city × one user-agent × many sessions × no engagement), not the individual session.
- **`ua_city_sweep` has not fired yet** (as of 2026-09-05). Its first real test is the next sweep. If a day looks inflated and no label appears, check the rule before trusting the number.
- **`session_engagement` starts 2026-09-02.** "Never engaged" means nothing before that date.
- **Local dev records no `page_views`** (and therefore sets no `mt_session_id` cookie). Verify tracking behaviour with production data or the probes, never with the local pane.
- **React StrictMode double-fires mount beacons in dev.** Two POSTs 72 ms apart are not a bug; the database dedupes.
- **PostgREST RPCs time out at 8 seconds.** A query that runs in a direct session proves nothing about a script. `page_views` heap is scattered (a 315k-row backfill), so window scans must go through `idx_page_views_human_cover` (index-only) or they cost ~4 s each.
- **`trip_views` counts opens of a trip, per visitor, per day** — the same person opening `/trip/x` and then `/shared/x` on the same day is one row. That is the intended meaning of "open".
- **Consent means GA4 and PostHog are both partial.** PostHog's signup tracking, for example, once captured 2.7% of signups for an unrelated reason; the point is the same — read activation from the database (`/admin`'s DB panel), not from a consent-gated tool.

---

## 6. Where the pieces live

| | |
|---|---|
| Human view + labels + nightly job | `supabase/migrations/20260905090000_page_views_automation_labels.sql`; pg_cron `label-automation-sessions` 02:20 UTC, `refresh-page-view-rollup` 02:40 |
| Covering index for window reads | `supabase/migrations/20260905160000_page_views_covering_index.sql` |
| UA-level bot detection | `lib/analytics/bot-detection.ts` |
| Page-view tracking + session cookie | `lib/supabase/middleware.ts` (`trackPageView`, `mt_session_id`), `middleware.ts` (public-only branch) |
| Engagement beacon | `app/api/page-engaged/route.ts` → `session_engagement` |
| Trip opens | `app/api/trips/[id]/view/route.ts`, `lib/analytics/trip-view.ts` |
| Baseline | `supabase/migrations/20260905160200_live_trip_baseline_retention_window.sql` (current body), `scripts/baseline-snapshot.mts` |
| Independent check | `scripts/gsc-daily.mts` |
| Label integrity probe | `scripts/automation-labels-probe.mts` |
| Admin dashboard reads | `app/api/admin/stats/route.ts` → `get_page_views_*` (rollup), `get_engagement_metrics`, `get_referrer_breakdown` (view) |
| GA4 configuration | `docs/GA4_SETUP_GUIDE.md` |
