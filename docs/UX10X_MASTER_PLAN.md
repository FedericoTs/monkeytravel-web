# MonkeyTravel — UX 10X Master Plan

**Date:** 2026-07-03 · **Status:** ACTIVE — this is the single operating plan
**Inputs:** production Supabase forensics (2026-07-03), full UX surface inventory, live competitor teardown (2026-07-02), reconciled funnel history (docs + memory), power analysis for low-volume experimentation.

---

## 0. Operating principles (read first)

1. **One loop, everything serves it.** Every workstream below either feeds the core loop or gets cut/parked. The loop:
   *Generate anonymously in ~30s → one link into the group chat → friends vote with zero signup → itinerary reshapes → every voter is one tap from planning their own.*
2. **Phases are strictly ordered.** Each phase has entry criteria (previous phase's exit gate) and its own exit gate. Do not parallelize phases; do parallelize workstreams inside a phase.
3. **Low-volume measurement doctrine.** At ~50 anon sessions/day, classical A/B significance takes 3–4 weeks (step1→2) to ~9 months (result→save). Therefore: pre-registered before/after windows + absolute guardrails + weekly replay review. A/B flags are used for *instant rollback*, not for significance testing. The only "experiment" evaluated as an experiment is a 7-day sanity window on the front door (breakage check, not stats).
4. **Perfect = self-correcting, not omniscient.** Every phase carries explicit kill/pivot criteria. The plan is final in its *sequence and thesis*; the copy, thresholds and micro-UX inside each phase adapt to what the guardrails show.
5. **Live-test everything via UI** before calling it done (founder's standing rule). Every phase lists its Playwright specs and its manual prod verification.

---

## 1. Diagnosis — the numbers that decide everything

### Acquisition: growing, not the constraint
- Anon step-1 sessions: **~12/day (June wk1) → ~52/day (June wk4)**, peak 71. ~4× in a month. SEO/content is working. Signups: 86 since 06-01 (208 all-time).

### Activation: two specific, measured leaks
- **Step-1 abandonment = 58%** (463/799 anon sessions since 06-01 never pass step 1). Forensics: **90.7% of abandoners never touch the destination field**; 82% leave in <10s. This is a *landing bounce* — they arrive expecting value and meet a form — not form friction.
- **Locale gap:** abandonment is **en 52.6% · es 67.1% · it 74.6% · pt 80%**. Non-English visitors bounce far harder (it/es samples are large enough to trust).
- **Result→save:** readers who reach an itinerary and never click Save engage for a **median 3.1 minutes** (74% >1 min) where dwell is measurable. They read the whole thing and leave. Motivation/ownership problem, not content.
- End-to-end anon→saved: **2.9%**. Saves: ~2–3/day.

### Virality: zero. Literally.
- Of **115** saved user trips ever: **1** was ever touched by a second human.
- Email invites: 4 ever sent (all by one user), **0 accepted**. Referrals: 6 codes, 4 clicks, **0 conversions**. Organic votes: **0** (all 41 votes were the 05-31 QA burst). Explore: **0** likes, **0** saves, **0** forks, `trip_views` never wired.
- Share-link creation: 10.4% of trips all-time, **falling** (6.1% since June).
- **The homepage promise ("Plan Trips With Friends") has never once happened organically in production.**

### Reliability: core solid, new front door sick
- Trip generation: **0.46% failure, p50 24s, p95 40s** — fine.
- **`/api/ai/decide` fails 25%** (flash-lite 500/503) — the built-but-dark decision front door is DOA if flipped today.
- `/api/ai/regenerate-day` 3/3 failures; `/api/tools/packing-list` 58% failure. The flash-lite tier needs a fallback chain.

### Surface: an inverted iceberg
- **23 PostHog flags + ~20 env flags; the majority of built features are at 0% rollout** (concierge, expense ledger, calendar export, email-parse, notifications, route optimization, enhanced booking, premium templates, wizard-ux-v2, multi-city…).
- Trip detail = heaviest surface (8+ lazy modules, 9 gates) seen by ~2–3 people/day. The `/shared` anonymous engagement system — the actual virality engine — is sophisticated and **invisible** (reachable only if someone happens to receive a link).
- Retention of savers: 26% create a second trip; ~27–40% show any pulse after week 1. Decent for stage; not the bottleneck.

### Competitive whitespace (live teardown, 2026-07-02)
| | Input | Auth wall | Groups | Verdict |
|---|---|---|---|---|
| **Layla** (+dead Roam Around) | multi-turn chat (slow) | harshest: detail behind trial, PDF behind $49.99 | none in-product ("share a PDF") | cautionary tale; its churned free-tool audience is claimable |
| **Mindtrip** ($22.5M) | chat+map, anon chat OK | signup to save/collab | best-in-class but **every participant needs an account**; no voting | the real threat; could copy us in a quarter |
| **Wanderlog** (incumbent) | manual builder (slow) | account to create/edit | real-time co-editing, expense split — **no voting** | 7-yr app+SEO moat; don't fight it on its turf |
| **Wonderplan** | 7-field form | anon generate | none | feature benchmark only |
| **Google AI Canvas** | free, instant, solo | none | **none** | out-*group* it; can't out-data it |

**The unclaimed intersection is exactly our claim:** AI drafts in 30 seconds, the group decides via a link, and nobody but the organizer ever sees a signup form. Nobody has it. It's cheap to defend because every competitor's business model pushes them toward *more* auth, not less.

**Table stakes we must match:** full itinerary free before signup ✅ (have) · public OG-rich trip URL ✅ (have, invisible) · post-gen editing that works ✅ (assistant) · free PDF + Maps export (make explicit) · **mobile-web excellence — the vote link opens inside WhatsApp's in-app browser**.

**Clutter to skip (permanently):** in-product booking engine · native-app push (Wanderlog's 33K-rating moat; our users arrive via chat links — PWA wins) · real-time co-editing (solves the wrong problem; one person plans, N people have opinions → async voting fits reality) · creator/guide marketplace · chat-as-the-only-input (Layla's follow-up questions are the anti-pattern for a 30-second promise).

---

## 2. Thesis & North Star

**Thesis.** MonkeyTravel wins by being the only planner where *the group participates without accounts*. The product is not "an AI that writes itineraries" (Google gives that away). The product is **the fastest path from "we should do a trip" in a group chat to a decided plan** — and every shared trip is simultaneously content (OG/SEO), a decision tool (utility), and an acquisition surface (each voter is a warm lead).

**North-star metric: Weekly Active Crews** — distinct trips where ≥2 distinct humans (cookie or account) each performed ≥1 engagement event (view >30s, vote, edit, save) within 7 days. Today: **0**.

**Supporting metrics (the loop, in order):**
1. Step-1 abandon % (today 58%; it 74.6%)
2. Shares created / generated trip (today ~6%)
3. Share-link visits / share created (today unmeasured — instrument)
4. Votes cast / share visit (today 0)
5. Voter → "plan your own" click-through (today unmeasured)
6. Saves/week (today ~15–20)

**60-day success targets (honest, absolute):** step-1 abandon <40% and it/es converging toward en · share rate >25% of generated trips · **first 10 organic crews** · first organic votes (the zero-to-one bar) · saves/week 2× baseline.

**Positioning line (use everywhere):** *"The AI plans it in 30 seconds. Your crew decides — no app, no signups."*

---

## 3. The Cut List (decided; execute in Phase 4 unless noted)

| # | Cut | Evidence | Action |
|---|---|---|---|
| C1 | **Email-invite UI** | 4 sent ever, 0 accepted | Remove invite tab from share modal; the share link IS the invite. Keep collaborator backend. |
| C2 | **Bananas/XP visible gamification** (~600 LOC UI) | 0 referral conversions; 20 grants ever | Hide all UI (XP bar, level badges). Keep tables. Revisit post-PMF. |
| C3 | **"Who's coming?" step-1 toggle** | measurement-only, no function | Remove (Phase 1). Crew intent is captured at the share moment instead. |
| C4 | **Backpacker toggle on step-1** | partner wedge, niche | Remove from wizard (Phase 1); lives only on /backpacker landing (which stays — Hostelworld). |
| C5 | **Start-Anywhere card** | big surface, niche use | Collapse to a one-line link under the destination input (Phase 1). |
| C6 | **Multi-city toggle** | env-dark already, niche | Stays dark. /multi-city landing stays for SEO. |
| C7 | **Templates page** | orphaned, premium flag off | Fold best templates into /explore as a curated row; 301 /templates → /explore. |
| C8 | **Notifications bell** | 0% rollout | Stays hidden EXCEPT the crew-vote email (Phase 3) — notifications return only as crew notifications. |
| C9 | **Dead flags** | share-modal-delay (deprecated), wizard-perf-v2/ux-v2 (0%, superseded by this plan), pricing/trial experiments | Delete flag code paths in Phase 4; document the pricing flags as intentionally parked. |
| C10 | **Route optimization, email-parse, expense ledger, enhanced booking, premium templates** | all 0% rollout | Stay dark, NOT deleted — they are post-PMF retention/monetization chips. No new investment until crews exist. |
| — | **Never build:** booking engine, native-app push, real-time co-editing, creator marketplace, multi-turn-chat entry | competitor teardown | Standing decision. |

**Keeps (explicitly):** blog + destinations + tools (SEO feeders, they created the 4× traffic growth) · /backpacker (partner) · AI assistant as the single editing interface · /explore as a browse surface (fed by genuinely shared trips; no new investment yet) · Capacitor app track stays **paused**.

---

## 4. The Phases

### Phase 0 — Solid ground (Days 1–3) — *nothing user-visible*

The plan's hard dependencies. Skipping this makes Phase 1 ship a broken front door.

| # | Workstream | Detail | Done when |
|---|---|---|---|
| 0.1 | **Fix `/api/ai/decide`** (25% fail) | Retry w/ backoff + model fallback chain flash-lite → flash; 8s timeout; Sentry breadcrumbs | <2% failure over 48h of synthetic probes (cron hitting it 4×/h) |
| 0.2 | **Fix `regenerate-day` (3/3) + `packing-list` (58%)** | Same fallback-chain treatment | Same probe gate |
| 0.3 | **Instrumentation gaps** | (a) step-1 heartbeat event every 10s (56% of abandoner sessions are single-event → dwell currently unmeasurable); (b) wire `trip_views`; (c) new events: `share_link_created`, `share_link_visited`, `vote_cast`, `plan_own_clicked` — server-side, same table pattern as wizard_step_events | e2e run shows every event landing in DB |
| 0.4 | **Local dev restored** | Fix local `/trips/new`→home bounce ("config is not valid"); provision fresh local Gemini key | Full anon flow runs on localhost |
| 0.5 | **Baseline dashboard** | One SQL view + admin card: daily step-1, abandon %, shares created, share visits, votes, crews, saves. Freeze 06-01→07-02 as the pre-plan baseline | Dashboard live; baselines written into this doc's appendix |
| 0.6 | **Founder replay hour** | Watch 20 replays: filter A (`save_blocked_anon` AND NOT `saved`), filter B (`result` AND NOT `save_clicked`), prioritizing it/es sessions | Notes appended to this doc |

**Shipped 2026-07-03:** 0.1/0.2 (PR #32), 0.4 affiliate gate (PR #34), 0.3a step-1 heartbeat (PR #35), 0.3c server events `share_link_created`/`share_link_visited`/`vote_cast` (PR #36) + `plan_own_clicked` (PR #37), **0.5 baseline dashboard (PR #38)** — `vw_ux10x_daily_baseline` view + `get_ux10x_rates(lo,hi)` RPC + `/api/admin/ux10x-baseline` + `Ux10xBaselineCard` on /admin (load-on-click, top of Analytics tab). **Crews caveat:** the RPC's `weekly_active_crews` currently counts a 2nd human *voting or joining as collaborator* — it does NOT yet count the ">30s view" engagement in the North-Star definition because `trip_views` is still unwired (0.3b, deferred). Same answer today (0); widen once `trip_views` lands. Still open in Phase 0: 0.3b `trip_views`, 0.4 local Gemini key + bounce (founder), 0.6 replay hour (founder), 48h decide probe cron.

**Tests:** synthetic endpoint probes wired into CI/cron · Playwright @prod smoke stays green · event-landing assertions.
**Exit gate:** 0.1 probe gate passed (hard blocker for Phase 1) + dashboard live.

---

### Phase 1 — Entry: value before questions (Week 1)

Kills the 58% landing bounce. People must *see the machine work* before being asked anything.

| # | Workstream | Detail |
|---|---|---|
| 1.1 | **Front-door flip** *(founder action)* | PostHog flag `front-door` → decision=50% anon for a 7-day **sanity** window (guardrails: decide failure <2%, JS error rate flat, step-1→proposal ≥ wizard's step1→2). Then **100%**. Classic wizard remains at `?classic=1` + as automatic fallback on decide failure. |
| 1.2 | **One-input entry** | Homepage hero input submits *directly into* the decision flow (no intermediate hop). Placeholder: "Tokyo in May… or 'somewhere warm, 4 days, with friends'". Proposals stream <5s (decide p50 is 3.6s). |
| 1.3 | **Wizard diet** (fallback path) | Step-1 = Destination + Dates + flexible-dates ONLY. Execute cuts C3/C4/C5. Dates never gate: flexible-dates is the pre-filled default, editing is optional. |
| 1.4 | **it/es/pt bounce fix** | Audit the localized SEO-landing→entry expectation gap end-to-end (copy tone, EUR pricing, blog-CTA promise vs form reality). Ship copy parity. This is a *diagnose-then-fix* slot — the 22pp it-vs-en gap is too big to be cosmetic. |
| 1.5 | **Speed as copy** | Show elapsed-time counter during generation; "planned in 27s" stamp on the result + OG card. The 30-second claim becomes a measured, visible number (Layla takes minutes of chat — make the contrast felt). |

**Tests:** Playwright e2e both arms (decision + classic fallback + decide-failure fallback) · decide contract test · i18n snapshot on entry ×4 locales · perf budget: entry interactive <2s on mid-mobile.
**Measure (before/after, 2-week window):** step-1 abandon 58%→<45%; it/es delta vs en shrinking; proposal→generation rate.
**Rollback:** flag to 0% (instant, no deploy).
**Kill/pivot:** if decision arm's step-1→generation underperforms wizard by >20% relative after the sanity week → keep wizard as default, keep one-input as homepage-only, investigate proposals quality.

---

### Phase 2 — The trip is the object: anonymous persistence + share-first (Week 2)

Readers engage 3+ minutes and leave because the page is a dead end — no ownership, no next action that matters. Every generated trip becomes a durable, shareable object with zero auth.

| # | Workstream | Detail |
|---|---|---|
| 2.1 | **Anonymous persistence** | On generation complete: server persists trip (`user_id NULL`) + server-issued `claim_token` in an **httpOnly cookie** (never client-supplied session_id — forgeable) + `share_token`. RLS: zero anon table reads; access only via token-checked RPC. Abuse: per-IP rate limit (existing KV limiter), payload cap 200KB, 30-day TTL cleanup cron, env kill-switch. Supersedes `auto-save-v1` (one persistence path — retire the flag). |
| 2.2 | **Result action model** | ONE primary cluster, sticky on both breakpoints: **[Send to your crew]** + **[Save — free]**. Share = native share sheet + explicit WhatsApp deep link (`wa.me`) with the /shared URL. Save = *claim*: inline email → magic link (flow exists) → `claim_trip(claim_token)` RPC binds `user_id` (idempotent; reuse the trip-id emit guard so `trip_created` doesn't re-inflate). |
| 2.3 | **Result diet** | Export menu → post-save only. Booking links → below the days. Assistant stays prominent (it IS the editor). Free PDF + Google Maps export stay free forever (review-visible differentiator vs Layla/Wanderlog Pro-gating). |
| 2.4 | **/shared = the product's front line** | Optimize for WhatsApp/Instagram in-app browsers: LCP <2.5s on mid-mobile, OG card with cover + "planned in 27s" + activity count, vote affordance visible above the fold. |

**Tests:** e2e anon→generate→persist→share→open in second browser context · claim-via-magic-link e2e · abuse: 429 on rate-limit, 413 on payload, TTL cleanup unit test · OG scrape assertion · funnel events for every hop.
**Measure:** share-creation 6% → >20% of generated trips; `share_link_visited` > 0.5 per share; claim conversion vs old save wall (baseline 25.9% of wall-hitters).
**Rollback:** env kill-switch reverts to block-only save.
**Kill/pivot:** if share rate stays <10% after 2 weeks with the new CTA → the *object* is wrong, not the button: test sharing the **decision** ("help us pick between these") rather than the finished itinerary.

---

### Phase 3 — The crew loop: make the promise real (Week 3)

From 1-of-115 to a repeatable loop. All infrastructure exists (voting, shared view, emails) — it has simply never been assembled into a flow anyone encounters.

| # | Workstream | Detail |
|---|---|---|
| 3.1 | **Post-generation crew prompt** | After the itinerary streams in: contextual, dismissible "Get your crew's take — send one link, they vote, no accounts." If the entry prompt implied a group ("with friends", "famiglia"…) this becomes the PRIMARY CTA above Save. |
| 3.2 | **Voting v1 for anon friends** | /shared: tap-to-vote per activity (infra exists, organically unused), running tally, "3 of your friends voted", first-visit onboarding hint. Zero accounts, cookie identity, existing rate limiter. |
| 3.3 | **The return loop** | Owner email: "3 votes on your Rome trip — see what your crew picked" (Resend infra exists; enable notifications env flag for THIS only). Trip page: tally view + one-tap **"Apply crew favorites"** (assistant applies top-voted alternates — reuses confirm-first apply path). |
| 3.4 | **Voter conversion** | Post-vote: "Done — want one for your own trip?" → decision entry with `?ref` attribution (already on planOwnHref). This is the K-loop's second wing. |
| 3.5 | **Execute C1** | Remove email-invite UI; share link is the invite. |

**Tests:** two-context Playwright e2e (owner generates+shares ⇄ anon friend votes ⇄ owner sees tally + applies) · email loop e2e (Resend test mode) · vote rate-limit regression · K-chain event assertions (share→visit→vote→plan_own each logged).
**Measure:** **first organic votes** (zero-to-one), crews/week ≥3 by end of month, voter→entry CTR.
**Kill/pivot:** votes stay 0 despite >20% share rate and measured share visits → friends open but don't vote → the vote UI or its value proposition fails; pivot to a lighter unit (single tap "🔥/😐 the whole plan" instead of per-activity) before abandoning the thesis.

---

### Phase 4 — Focus: cuts + polish (Week 4)

| # | Workstream | Detail |
|---|---|---|
| 4.1 | **Execute remaining cuts** | C2 (bananas UI), C7 (templates→explore + 301), C8, C9 (dead flags deleted). |
| 4.2 | **Trip detail diet** | Action bar → **Share / Edit with AI / More** (export, calendar, publish, advisories inside More). The page's job: reflect crew votes + enable edits. |
| 4.3 | **Console-zero + perf** | Zero console errors on the 4 core surfaces (entry, result, /shared, trip detail); Lighthouse CI budgets: entry & /shared LCP <2.5s mid-mobile; bundle budget asserts (result view is the known balloon). |
| 4.4 | **Copy pass** | Positioning line everywhere ("…no app, no signups"); landing pages (/group-trip-planner etc.) rewritten around the crew loop; it/es/pt native-quality review. |

**Tests:** visual regression on 4 core surfaces · Lighthouse CI in pipeline · full e2e regression green · 404/redirect checks for /templates.
**Exit gate:** cut list executed, budgets green, zero-console verified on prod.

---

### Phase 5 — Compound (Week 5 → ongoing)

- **Weekly 30-min ritual (founder + agent):** dashboard review → 20 replays → one explicit kill/keep/double-down decision, appended to this doc. The plan self-corrects here, nowhere else.
- **SEO keeps compounding** (blog/destinations untouched). Each genuinely-shared trip is OG content; **revisit /shared `noindex`** only after crews are real (indexed shared trips = Wanderlog-style moat, but only with real content — a founder decision, listed below).
- **/explore** gets investment only once shared-trip volume exists to feed it.
- **Monetization stays parked** (pricing/trial flags off) until Weekly Active Crews is reliably >10; then the Layla-resentment positioning ("everything free until you book") frames affiliate-first monetization.
- **Mindtrip-copies-us defense:** speed + own the phrase. "No-signup group voting" goes in title tags, OG descriptions, comparison pages *now* — make the category ours before their quarter of catch-up work starts.

---

## 5. Measurement doctrine (why not A/B everything)

- Power math at current volume: 20% relative lift on step1→2 ≈ 3–4 weeks to significance; on result→save ≈ 9 months. **Pretending to run experiments would be theater.**
- Therefore: **pre-registered before/after** (baseline frozen in Phase 0.5) + **absolute guardrails** (e.g., saves/day <1 for 3 consecutive days = investigate; decide failure >5% = auto-fallback + alert) + **replay-based qualitative** weekly.
- Flags = rollback switches, not stats engines. The one sanity A/B (front door, 7 days) checks *breakage*, not significance.
- Zero-to-one metrics (first organic vote, first crew) are real milestones at this scale — treat them as such.

## 6. Decisions reserved for Federico

1. **Flip `front-door`** in PostHog after Phase 0.1's probe gate passes (50% → 7 days → 100%). Only you have dashboard access.
2. **Confirm C2** (hide bananas/XP UI) and **C7** (fold templates into /explore).
3. **Replay hour** (Phase 0.6) — only you can watch them. Filters are in the appendix.
4. **/shared noindex revisit** — Phase 5, only after crews exist.
5. **Monetization stays parked** — confirm.

## 7. Risks & kill criteria (top level)

| Risk | Trigger | Response |
|---|---|---|
| Decision front door degrades funnel | step-1→generation −20% rel. vs wizard in sanity week | Flag to 0% (instant); keep one-input on homepage only |
| Anon-persist abuse | storage/insert spike | Rate limits + TTL + kill-switch already in design; monitor in dashboard |
| Share rate doesn't move | <10% after Phase 2 + 2 weeks | The shared object is wrong → test sharing the *decision*, not the itinerary |
| Friends visit but don't vote | visits >0, votes 0 | Lighter vote unit (whole-plan 🔥) before abandoning thesis |
| Mindtrip copies | any groups+guest announcement | Already-shipped speed + category language; accelerate Phase 5 SEO of "no-signup group voting" |
| Founder bandwidth | phases slip | Sequence is priority order — cutting from the bottom (Phase 4 polish) is acceptable; cutting Phase 0 is not |

---

## Appendix

**A. Baseline (2026-06-01 → 2026-07-02, frozen):** anon step-1/day ~38 median (last wk ~52) · step-1 abandon 58% (en 52.6 / es 67.1 / it 74.6 / pt 80) · step1→2 ~45% · result-reader no-save median dwell 3.1 min · anon→saved 2.9% · saves/day 2–3 · share rate 6.1% (June) · crews: 0 · organic votes: 0 · invites accepted: 0 · referral conversions: 0 · gen p50 24s, fail 0.46% · decide fail 25% · Weekly Active Crews: **0**.

**B. PostHog replay filters:**
- A (auth-wall leak): event `save_blocked_anon` performed AND `saved` NOT performed, anon, last 14d, sort duration desc.
- B (reader no-save): `result` performed AND `save_clicked` NOT performed, anon, last 14d — prioritize it/es sessions.

**C. Event schema additions (Phase 0.3):** `step1_heartbeat` (10s), `share_link_created`, `share_link_visited` (+referrer bucket), `vote_cast`, `plan_own_clicked`, `trip_claimed`. Server-side, dedup-safe, same hygiene rules (dedup by session, exclude QA fixtures).

**D. Sources:** Supabase forensics run 2026-07-03 01:00Z (wizard_step_events, trips, trip_invites, trip_collaborators, anonymous_activity_votes, trip_likes/saves/views, referral_*, api_request_logs) · UX surface inventory 2026-07-03 · live competitor teardown 2026-07-02 (layla.ai, mindtrip.ai, wonderplan.ai, roamaround.io→301, wanderlog.com, app stores, press) · power analysis + funnel reconciliation docs from 2026-07-02 session.
