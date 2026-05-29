# monkeytravel.app — 12-Week Feature Roadmap

## TL;DR
Ship `calendar-export-smart-notifs` FIRST (week 1-2). It is the cheapest, lowest-risk, highest-leverage lever for the save-to-trip-start retention cliff that every other feature on this list assumes already exists. Then layer email parsing, map v2, in-trip concierge, and expense ledger in that order across a 12-week window, with two cross-feature platform investments (Vercel KV + Upstash hardening, OAuth scope review) front-loaded in week 0.

---

## 1. Recommended First Feature: Calendar Export + Smart Notifications

**Why this, not the others:**

- **Lowest engineering cost (2 weeks)** with the least vendor surface. iCal generation is library work (`ics` npm); Google Calendar OAuth reuses the same OAuth client we need for email parsing anyway; notification cascade rides existing `lib/email/send.ts` Resend rails and the existing bell.
- **Highest leverage on the actual retention problem.** The save->trip-start window is where users vanish. A 14d/7d/3d/1d/morning-of cascade plus a live `webcal://` subscription is the most direct attack on that gap. Every other PRD targets a later, narrower moment (in-trip use, post-trip settle-up, day-2 cliff).
- **Force-multiplies every other feature.** A user who sees their trip in Google Calendar week-of is the user who opens the app and gets value from the concierge, the map, the expenses. Without the return trigger, the other four features fight for attention from a user who already churned.
- **Zero new tables in critical path.** Adds `calendar_subscriptions` and reuses `notification_settings` + `notification_jobs`. No PostGIS, no pgsodium token vault, no new vendor contract.
- **Anti-metric is well-understood.** Resend complaint-rate and unsub-rate are monitored daily; the 1-email/trip/24h cap and fail-closed `tripReminders` flag are mechanical. Compare to map v2 where the failure mode (silent transit fallback) is harder to detect.

The only reason to delay would be Resend deliverability risk at scale — mitigated by the cap, suppression list, and a 10% rollout gate before promoting.

---

## 2. Dependency Graph

```
                  [Platform Wk 0]
                  Vercel KV + Upstash
                  OAuth client + CASA
                          |
                          v
        +---------- Calendar Export (F1) ----------+
        |                                          |
        |  reuses OAuth client                     |  reuses notification
        |  reuses notif cascade infra              |  CTR baseline
        v                                          v
   Email Parsing (F2) ---- shared OAuth ---- In-Trip Concierge (F4)
        |                  scope review            |
        |                                          | shares trip-context
        |  auto-attached bookings                  | injection pattern
        |  become rich context for:                |
        +--> Map v2 (F3) <-------------------------+
        |        |
        |        | route_cache + activities_near_point
        |        | benefit from booking lat/lng
        v        v
   Expense Ledger (F5) --- benefits from concierge voice input
                           reuses trip_collaborators RLS
```

**Hard dependencies:**
- F2 (email-parsing) and F4 (concierge) both need the OAuth/consent infra F1 establishes. Building F1 first amortizes Google CASA tier-2 review (filed in parallel during weeks 1-2 so it's cleared before F2 lands).
- F3 (map v2) `route_cache` table and Directions cost-control patterns are reused by F4's `find_nearby_places` tool — building F3 before F4 keeps concierge costs honest.

**Soft dependencies / force-multipliers:**
- F2 auto-attaches bookings with hotel addresses -> F3 polylines have real start/end coordinates for day routing -> F4 concierge has accurate "you're at the Marriott, here's dinner 400m away" context.
- F4 concierge voice/text input is a natural surface for "log €42 dinner" voice-entry into F5 ledger (Phase 3 integration, not MVP).
- F1 notifications cascade gets richer payloads once F2 attaches bookings ("Your 09:15 EZY8341 to Lisbon is tomorrow") — but F1 ships standalone first with trip-level reminders.

---

## 3. 12-Week Sequenced Roadmap

| Week | Workstream | Deliverable | Flag State |
|------|------------|-------------|------------|
| 0 | Platform | Vercel KV provisioned, Upstash REST creds rotated to per-env, OAuth client created in GCP, CASA tier-2 filed | n/a |
| 1-2 | **F1 Calendar Export** | iCal endpoint, Google Calendar OAuth, notification cascade jobs, `calendar_subscriptions` table | `NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED` off in prod, on for `/backpacker` UTM cohort |
| 3 | F1 rollout + F2 prep | F1 -> 25% -> 100% over the week if metrics hold; spike pgsodium token vault + Gmail parsers | F1 100% by Fri |
| 4-5 | **F2 Email Parsing** | Gmail OAuth + parse pipeline (Phase 1 review-queue only), `mailbox_connections`, `inbox_messages`, `parsed_bookings` | `mailbox_integration` on for backpacker cohort |
| 6 | F2 review-queue iteration | Tune Gemini confidence thresholds against real-world inbox data; ship Outlook adapter if Gmail parse rate >=92% | `mailbox_integration` 25% |
| 7-8 | **F3 Map v2** | `route_cache`, `activities_near_point` RPC, polyline rendering, mode toggle, Near-here sheet | `FEATURE_MAP_V2` on for backpacker + active-trip users |
| 9 | F2 Phase 2 + F3 rollout | Enable auto-attach for high-confidence single-candidate matches; F3 -> 50% | `mailbox_integration` Phase 2 25%, `FEATURE_MAP_V2` 50% |
| 10-11 | **F4 In-Trip Concierge** | SSE chat endpoint, `trip_chat_messages`, function-calling tools (find_nearby_places, redo_day, translate, weather), daily turn+token caps | `concierge_chat_v1` on for users with `start_date` within 7d AND backpacker cohort |
| 12 | **F5 Expense Ledger** (MVP) + F4 rollout | `trip_expenses`, `upsert_trip_expense` RPC, offline queue, equal+exact splits, settle-up calc | `expense_ledger` on for collaborated trips only |

**Sequencing rationale:**
- F1 first (retention lever, cheapest).
- F2 second (biggest TAM impact: every user has an inbox; day-7 retention +18pp is the largest projected lift).
- F3 third (in-trip engagement; needs no new vendor; the polyline cache pays back F4).
- F4 fourth (highest cost-tail risk; want F3's caching patterns proven first; want F2's booking data to make context injection richer).
- F5 last (smallest TAM — group trips only; depends on no other feature but the lowest-priority audience).

---

## 4. Cross-Feature Platform Investments (Week 0)

These must land before F1 so we are not paying for them on the critical path:

1. **Vercel KV** for the `route_cache` lookup-aside (F3), Gemini per-user spend counters (F4), and notification-job dedupe keys (F1). Single provisioning + secret wiring.
2. **Upstash Redis** hardening: rotate the production REST token, set per-route `createRateLimiter` defaults for OAuth callback endpoints (F1, F2) and the SSE chat endpoint (F4). The in-memory fallback is fine for dev but unsafe behind Vercel's multi-instance serverless when we ship F4.
3. **Google Cloud OAuth client + CASA tier-2 review filed.** F1 needs `calendar.events` read/write; F2 needs `gmail.readonly` (sensitive, requires CASA). File CASA week 0 -- review takes 4-6 weeks, so it clears just as F2 reaches Phase 2 rollout in week 9.
4. **PostHog feature-flag groups** for `cohort:backpacker_utm` and `cohort:active_trip_window` -- both reused by every flag in the roadmap. Define once in PostHog UI; reference from `lib/posthog/identify.ts`.
5. **Liveblocks evaluation deferred.** Real-time collaborative editing is not in any of the five PRDs; F5 expense ledger uses Supabase realtime + atomic RPC instead. Revisit only if F5 surfaces multi-writer conflicts.

---

## 5. Kill Criteria per Feature

| Feature | Kill Metric | Date | Action |
|---------|-------------|------|--------|
| F1 Calendar Export | Resend complaint-rate >0.08% OR unsub >0.4%/send across any 7-day window | by end of week 4 | Disable cascade, keep iCal export only; investigate per-slot opt-in granularity |
| F2 Email Parsing | Per-sender parse success <85% OR wrong-trip attach rate >2% in Phase 2 | by end of week 9 | Roll Phase 2 back to Phase 1 review-queue; do not auto-attach; revisit confidence thresholds and per-vendor regex pre-pass |
| F3 Map v2 | Google Directions cost >$0.20/trip averaged over 7 days OR polyline render rate <85% | by end of week 9 | Disable mode toggle; serve walking-only polylines from cache; add per-trip Directions quota |
| F4 Concierge | <15% of in-trip-window users send >=1 message within 14 days of launch OR daily Gemini spend exceeds budget circuit-breaker twice in 7 days | by end of week 12 | Pause cohort expansion; tighten daily turn cap from current default to 10/day; investigate whether activation surface (CTA placement) is the blocker before re-launching |
| F5 Expense Ledger | "this is wrong" feedback rate >5% on settle-up OR balance-recompute diff vs. client-side calc >1 cent | within 30 days of MVP ship | Disable settle-up surface, keep ledger-only view; audit integer-cents pipeline and FX snapshot logic |

---

## 6. Phased Rollout Strategy

Every feature follows the same gate sequence to keep blast radius bounded and let kill criteria fire before broad exposure:

1. **Internal dogfood (day 0-2):** Flag on for `@monkeytravel.app` emails only. Smoke + Sentry sweep.
2. **Backpacker UTM cohort (day 2-7):** `cohort:backpacker_utm` PostHog group — these users self-selected via `/backpacker` landing and are tolerant of rough edges. Target population ~500-2000 users; large enough to surface bugs, small enough to roll back without a comms cycle.
3. **10% random + cohort (week 2):** Add a deterministic 10% slice (bucket by `user.id` hash). Compare cohort vs. random; if cohort vastly outperforms random, the feature is niche and stays gated.
4. **50% (week 3):** Promote only if primary metric is at or above the PRD's MVP target AND no kill criterion has fired AND p95 latency on the new endpoints is within +20% of baseline.
5. **100% (week 4):** Default-on. Flag remains in code as a kill switch for one full release cycle (~2 weeks) before deletion.

**Cohort selection rule:** every flag must reference `cohort:backpacker_utm` for the beta phase. This concentrates learning, lets us A/B against the non-cohort population, and gives us a captive audience for PostHog surveys when a feature ships.

**Success threshold before 100% promotion:** primary metric must be tracking to >=70% of the PRD's 90-day target at the 14-day mark (linear projection). If it is not, hold at 50% and run a follow-up sprint instead of promoting and hoping.

---

## References
- `docs/specs/calendar-export-smart-notifs.md` — F1
- `docs/specs/email-parsing-auto-trip.md` — F2
- `docs/specs/map-v2-polylines-near-here.md` — F3
- `docs/specs/in-trip-ai-concierge.md` — F4
- `docs/specs/expense-ledger-split.md` — F5
- `lib/email/send.ts`, `lib/posthog/identify.ts`, `lib/api-gateway/checkApiAccess`, `lib/usage-limits`, `lib/platform/storage` — shared platform primitives reused across the roadmap.
