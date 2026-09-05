# MonkeyTravel — Live Trip Master Plan

**Date:** 2026-09-04 · **Status:** ACTIVE — this is the single operating plan. Supersedes `UX10X_MASTER_PLAN.md` (2026-07-03) in thesis and sequence; carries over its operating principles, cut list, measurement doctrine and live-test rule.
**Inputs:** production Supabase forensics (2026-09-04), Search Console (28d to 2026-09-01), first-party `page_views` audit, live dogfood of `/`, `/trips/new`, `/trip/[slug]`, `/explore` at 1280×800 and 390×844, competitor read (Mindtrip, Wanderlog, Layla, Gemini) on 2026-09-04.
**Scope exclusion:** monetization is out of scope for this plan and stays parked. Nothing below depends on it.

---

## 0. Why this plan exists: the previous thesis fired its own kill criterion

UX10X's loop was: *generate → one link into the group chat → friends vote with zero signup → itinerary reshapes → every voter is one tap from planning their own.* Its Phase 3 kill criterion read: "votes stay 0 despite >20% share rate and measured share visits → friends open but don't vote → the vote UI or its value proposition fails; pivot."

Eight weeks later, measured:

| Loop stage | UX10X assumption | Measured 2026-09-04 |
|---|---|---|
| Share rate | >20% | **30%** (80 of 269 users' trips shared, lifetime) — this stage works |
| Friends open the link | yes | **~600–900 human recipient sessions / month** — this stage works |
| Friends vote | the loop's engine | **53 anonymous votes lifetime. 0 authenticated votes. Ever.** |
| Voters become planners | K-loop | **2 signups via invite + 1 referred, lifetime. K ≈ 0.011** |
| Crews form | north star = Weekly Active Crews | **3 collaborators, 6 invites, lifetime. WAC ≈ 0** |

Friends open and do not vote. The criterion fired. The vote-before thesis is retired.

The deeper finding is what recipients *do* instead: **37.8% of human recipient sessions go on to `/trips/new`**. Intent is real. But the page's only offered action is "make your own copy", which turns a fellow traveller into a separate solo planner. The group fragments into N solo trips.

And the finding underneath that one: **of 171 trips that actually travelled since May, 9 were edited during the trip, 0 used the checklist, 3 logged an expense, 0 synced a calendar.** The product is never open while the trip it planned is happening. Retention (7.4% ever return) and virality (K ≈ 0.011) are the same problem seen from two sides: the trip stops existing the moment it is generated.

---

## 1. Thesis and North Star

**Thesis.** The trip is the group's live object — the thing every traveller opens *during* the trip. Not "invite friends to vote before you go" (built, dead). *This is where the trip lives while it happens.*

Why this is the one thing, not one of many:

- **Retention becomes mechanical.** A live trip is opened on each of its ~7.8 days by N people, instead of once by one person.
- **Virality becomes necessity, not nudge.** If tonight's dinner and tomorrow's tickets live in the app, every co-traveller must open it. A share stops being a favour and becomes how you know where to be. The weakest K stage (recipient → anything: 0.4%) is exactly the stage this changes.
- **It is the part Gemini cannot copy.** Gemini generates an itinerary free. It cannot be the surface with live state — who's in, what changed, what's done, what we spent.

**North Star: Trips Opened During Travel (TODT).** A trip counts when at least one human opens it on at least one calendar day inside `[start_date, end_date]`. Reported weekly as a rate over trips whose `end_date` fell in the week.

**Baseline:** *edited* during travel = **9/171 = 5.3%**. *Opened* during travel = **unknown**, because `trip_views` has never received a row. Phase 0 exists to make the North Star measurable before anything is built on it.

**Secondary metrics (in order):**
1. **Participants per shared trip** — people who tapped "I'm going". Baseline **0**.
2. **Recipient → participant rate** — taps ÷ human recipient sessions. Baseline **0**.
3. **Return after trip** — owner or participant opens the app in the 7 days after `end_date`. Baseline ≈ 7.4% (ever-return proxy).
4. **K components** — share rate (30%), recipients/share (~9), recipient→participant (0), participant→own trip.

**Addressable cohort today:** every trip carries dates (459/459). **22 trips are in progress right now, 80 start within 30 days, 121 within 60, and 40 upcoming trips are already shared.** The first measurable TODT cohort is trips starting 26 Sep – 26 Oct.

---

## 2. Operating principles

Carried from UX10X, still binding:
1. One loop, everything serves it. Workstreams that don't feed the live trip get cut or parked.
2. Phases are strictly ordered by entry/exit gates. Parallelise *inside* a phase, not across.
3. Low-volume measurement: pre-registered before/after against frozen baselines, absolute guardrails, zero-to-one milestones. Flags are rollback switches, not stats engines.
4. Every phase carries an explicit kill/pivot criterion.
5. **Live-test everything via the real UI before calling it done** (founder's standing rule).

Added, from this summer's incidents:
6. **Never block bot traffic. Label only.** No robots/WAF/rate-limit/middleware blocking. (Standing rule since 2026-09-03.)
7. **All four locales, always** (en/es/it/pt). A change that ships in one locale is not shipped.
8. **Read engagement numbers only from the human view** (Phase 0.2), never from raw `page_views`. Raw is inflated ~40% by unlabelled automation; GA4 is consent-gated and is not a traffic source of truth.
9. Content: fetch every URL before citing it; sources that 403/402 a fetch are not cited.
10. Engineering hygiene that has bitten us: byte-splice CRLF files; run `tsc` unpiped and check `$?`; IndexNow on the apex host; `rls:check` after any policy change; `npm run flags:review` before flipping flags.

---

## 3. Diagnosis — the numbers that decide everything (2026-09-04)

### Acquisition — flat, and not the constraint
- New users/week, last 8 weeks: **35, 33, 35, 34, 34, 29, 34, 30**. Flat.
- Organic search: ~188 clicks/day, flat (GSC). The Sept 1–2 "collapse" was a GA4 reporting bug plus a one-day bot sweep from Cittadella, IT (6,759 views, ~62 sessions/hour, flat cadence). No real traffic moved.
- Product-intent cluster (`trip planner`, `ai trip planner`, `ai travel planner`, `ai vacation planner`, `best ai for travel planning`): **~22,000 impressions/28d at positions 9–17.** The one cluster with purchase intent, unaddressed.

### Activation — fixed
- **187 of 269** new users (70%) created a trip in 8 weeks. Trips/week rose 32 → 55 on flat signups. Summer's activation work landed. Not a priority now.

### Retention — the constraint
- **20 of 269** (7.4%) new users logged in twice. **8** (3%) three times.
- **171 travelled trips since May: 9 edited during, 0 checklist, 3 expenses, 0 calendar.**
- 39% of trips are planned within 7 days of departure (avg lead 18.3 days). The product is a "week-before" tool.

### Virality — the other face of the constraint
- **K ≈ 0.011.** 80 shares lifetime · ~9 human recipients/share · 0.4% recipient→signup.
- Recipients are real and interested: 37.8% → wizard, 9.7% → auth. They leak at "make your own copy".
- Referral: 43 clicks → 1 signup in 28 days.

### Product surfaces — what a first-time visitor meets
- **Homepage:** polished, one job, converts. But its middle third sells "Democratic Trip Planning / Everyone gets a vote / Real-time sync" to a userbase with 3 collaborators, and it says both "no paywall, actually free" and "invite friends and earn free premium features". Promise/reality gap plus a contradiction.
- **Wizard:** clean. Cookie banner covers *Travel dates* and *Continue* at 1280×800; on 390×844 it covers dates and the floating help button overlaps *Continue*. Two overlays on the conversion step, every session.
- **Recipient page (`/trip/[slug]`, `/shared/[token]`, same renderer):** visually the best screen in the product. Behaviourally empty for a non-owner: Like 0 / Save 0 / Fork 0 (zeros read as a dead room), the one coral CTA above the fold is *Hide Map*, "You've been invited to vote" precedes map chrome and a full-width *Save to My Trips* before any activity. **17,012px tall on mobile — twenty screens.** Nothing says *I'm going*, shows who else is, or lets you add a place.
- **Quality bug:** `lisbon-trip-0af8e266` has Day 5 in Italian, Days 1–4 and 6 in English, on an indexable public page. Agent edits inherit the editor's locale.
- **Explore:** first screen at 1280×800 is 100% hero, zero trips; duplicates below (two identical Calabria, two Costa Rica); "$$" placeholders. Its 7,869 sessions are **12.5% mobile** — mostly crawler. Not a growth surface.

### Instrumentation — cannot measure the loop we intend to build
- `trip_views`: **0 rows, ever.** The writer `app/api/trips/[id]/view/route.ts` exists; nothing calls it.
- `trips.collaborator_ids`: **0 references** in app/lib/components; populated on 0 trips while `trip_collaborators` has 3 rows. Dead column.
- `page_views`: **~5% of sessions produce ~40% of "human" views** every day (58 sessions of 1,122 = 42.1% on Sept 3). `is_bot` is deliberately UA-only and says so; the query-time heuristic was never built.

### Competitive position (2026-09-04)
- **Mindtrip:** planning + booking (Viator activities; Mindtrip Flights since May 2026), free planning, commission model. Group/sharing limited.
- **Wanderlog:** best maps, drag-drop, route optimisation, collaboration; Free / $39.99 yr; a UGC-SEO machine (~7.9M visits/mo).
- **Layla:** GPT redesign; gates the full itinerary behind subscription.
- **Gemini:** free; where most people first meet AI trip planning. Generation is now the floor.
- **MonkeyTravel:** better generation than Gemini, better output page than most, real group *infrastructure*, no booking, no mobile app, no live-trip surface. Generation alone is no longer a reason to return, invite, or (later) pay.

---

## 4. The Phases — execution order

Each phase lists **entry gate → workstreams (numbered, in build order) → tests → measure → exit gate → kill/pivot**. Dates assume a start on Fri 2026-09-04 and one builder plus the agent; slip is acceptable from the bottom of the list, never from Phase 0.

### Phase 0 — Measurement floor (Sep 4–8) — *nothing user-visible*

**Entry:** now. **Why first:** the North Star cannot be computed on today's instrumentation, and the previous plan's numbers were read off inflated tables.

| # | Workstream | Detail |
|---|---|---|
| 0.1 | **Make `trip_views` real** | Call `POST /api/trips/[id]/view` from all three renderers on mount: `SharedTripView.tsx` (covers `/shared/[token]` and `/trip/[slug]`, which imports it) and `TripDetailClient.tsx`. Payload: `source ∈ {shared, public, owner}`, `session_id` (existing cookie), `viewer_id` (null when anon). Dedupe one row per session per trip per day server-side. Verify rows land from all three surfaces in production before closing. |
| 0.2 | **Human view over `page_views`** — *SHIPPED 2026-09-05* | Do **not** widen `bot-detection.ts` (it is correctly UA-only and documents why). `page_views_human` already existed (`is_bot = false`) and the rollup already read it; it now also excludes sessions in a new label table `page_view_session_labels`, rebuilt nightly by `label_automation_sessions()` (pg_cron 02:20, ahead of the 02:40 rollup). Rules were **measured before being written**, and the plan's original thresholds were wrong: engagement *rises* with view count (0.4% of 1–2-view sessions engaged vs 33.9% of 50+), so a per-session volume rule would mislabel real heavy users. Shipped rules: `heavy_unengaged` (≥50 views, never fired the engagement beacon), `ua_city_sweep` (a day×city×UA group with ≥15 sessions, ≥100 views, ≤3% engaged — only its unengaged members), `legacy_sweep` (days before `session_engagement` existed, 2026-09-02: ≥100 sessions in one group at ≥5 views each). **An engaged session is never labelled.** No country lists. Labelling only — no request is ever refused. No dashboard code changed: everything reads the view or the rollup. Measured effect: 13.5% of `is_bot=false` views over 7 days; Sept 1 human total 20,600 → 10,003. |
| 0.3 | **Retire `collaborator_ids`** — *SHIPPED 2026-09-05* | Measured before dropping: **0** references in code, generated types, scripts or migrations; **0** in RLS policies, functions, views, triggers or indexes; populated on **0** trips. Every `trips` policy already grants collaborator access through `trip_collaborators` (`user_is_trip_owner` / `user_is_trip_collaborator`), so that table was the source of truth all along. Dropped in migration `20260905120000` rather than deferred to Phase 2 as first written: with zero references there was nothing to bundle, and a dead column that looks like a source of truth is worse than none. The RLS baseline was refreshed in the same PR (it had drifted since `session_engagement` landed on 2026-09-02, and again with 0.2's label table). |
| 0.4 | **Freeze baselines** — *SHIPPED 2026-09-05* | The baseline is a function, not a paste: `get_live_trip_baseline(p_days)` (migration `20260905150000`, service-role only, every figure from labelled human data, definitions shared with `get_ux10x_rates`) and `scripts/baseline-snapshot.mts`, which prints the block and `--append`s it above the decisions log. The frozen block is below, dated 2026-09-05 (the plan said 09-08; Phase 0 finished early). **TODT reads 0.0% with measurement starting 2026-09-05** — every trip that completed in the window ended before `trip_views` existed, so the first clean TODT read is due 2026-10-03. Re-run the same command for the weekly ritual; never hand-edit the numbers. |
| 0.5 | **Correct the analytics narrative** — *SHIPPED 2026-09-05* | `docs/ANALYTICS_SOURCES_OF_TRUTH.md`: the instruments and what each is for (`page_views_human` → rollup → RPCs for traffic; GSC as the independent tie-breaker; `trip_views` for the North Star; GA4 for consented-user behaviour only, never volume), why GA4 cannot measure traffic (consent-gated mount + the 2026-09-01 processing bug), the Sept 1–2 case worked through with the corrected week (human visitors 1,456 → 1,182, −19%, inside the week's own range, against GA4's −84.57%), a seven-step order for reading the next alarm, and the traps. Referenced from the repo `CLAUDE.md` as a MANDATORY discipline so every session loads it. |

**Tests:** vitest for the dedupe rule; a `scripts/trip-views-probe.mts` that hits all three surfaces and asserts rows.
**Exit gate:** `trip_views` receiving rows from all three surfaces in prod; `page_views_human` live and used by the admin dashboard; baseline block written.
**Kill:** none — this phase is not optional.

### Phase 1 — Stop the bleeding on the conversion surfaces (Sep 8–12)

**Entry:** Phase 0 exit. **Why now:** cheap, certain, independent of the thesis, and every later phase inherits these screens.

| # | Workstream | Detail |
|---|---|---|
| 1.1 | **Cookie banner off the CTA** — *SHIPPED 2026-09-05* | `components/consent/CookieConsentBanner.tsx`: on `/trips/new`, `/shared/*`, `/trip/*` render as a compact single-row bottom bar (≤ 72px), `z-index` below the wizard footer, auto-minimise to a pill after the first scroll or first interaction. "Essential only" stays one tap (privacy rule: most privacy-preserving choice remains equally easy). Verify at 1280×800 and 390×844: **zero overlap with any primary CTA**. |
| 1.2 | **Wizard mobile overlap** — *SHIPPED 2026-09-05* | Floating help button hidden on wizard steps, or docked top-right; *Continue* fully visible at 390×844 with the keyboard closed. |
| 1.3 | **Locale-consistent itineraries** | Store `trip_meta.locale` at creation (from the generating locale). Every agent edit and regeneration passes it, so a Day 5 edited from `/it` on an English trip stays English. Backfill: script that detects mixed-language days on the 55 public trips (language-detect per activity description) and flags them in admin for one-click regenerate-in-trip-locale. Target: **0 mixed-language public trips.** |
| 1.4 | **Explore hygiene** | Hero ≤ 240px; trips above the fold at 1280×800; dedupe by `parent_trip_id` and `(title, user_id, duration)`; hide "$$" when budget tier is unknown. Hygiene, not growth — Explore's traffic is mostly automation. |
| 1.5 | **Homepage contradiction** — *SHIPPED 2026-09-05* | Remove "invite friends and earn free premium features". Keep "no paywall". No other homepage change yet (Phase 5 does the rewrite once there is data to write from). |

**Tests:** Playwright viewport specs asserting no element overlaps `[data-testid=wizard-continue]` at both viewports; language-detect unit test on the backfill script.
**Exit gate:** screenshots of the four core surfaces at both viewports attached to the PR with zero overlap; mixed-language public trips = 0; homepage contradiction gone in all four locales.
**Kill:** none.

### Phase 2 — Recipient → participant (Sep 14–25) — *the loop change*

**Entry:** Phase 0 exit (must be measurable). **Why now:** ~600–900 human recipients a month are the highest-intent people in the funnel and the page currently offers them nothing to be.

| # | Workstream | Detail |
|---|---|---|
| 2.1 | **"I'm going"** | New table `trip_participants (id, trip_id, participant_cookie_id, user_id null, display_name null, email null, joined_at, source ∈ {shared, public, crew_ask}, left_at null)`. Unique on `(trip_id, participant_cookie_id)`. Written by a new `POST /api/shared/[token]/join` (and the public-slug equivalent) using the service role like `/vote` does; RLS: no anon SELECT/INSERT on the table (run `rls:check`). Reuse `voter_cookie_id` as `participant_cookie_id` so a participant's later votes are attributed. |
| 2.2 | **Header rework in `SharedTripView.tsx`** | Above the fold, in this order: title · dates · **"N going" avatars** · **[I'm going]** (primary, coral) · [Share] · [More ▾: Fork, Save for later, Export]. Remove the Like/Save/Fork trio and its zeros. Tapping *I'm going* → optimistic add → inline "You're in. Name? (optional)" → then "Get tomorrow's plan by email? (optional)". Email is captured for trip notifications only; purpose stated in the field; feeds Phase 4. |
| 2.3 | **Page order for a recipient** | title/dates/going → *today or next* if the trip is live (Phase 3 fills this; until then, Day 1) → activities with the existing inline 👍/👎 → "Plan your own trip" **at the very bottom only**. Delete the mid-page *Save to My Trips* hero (`share.savedHero.*`) for non-owners; keep the owner-claim path (`share.ownerClaim.*`) untouched. Mobile target: **≤ 6 screens to the first activity** (from ~20). |
| 2.4 | **Owner sees who's going** | `TripDetailClient.tsx`: a "Who's going" card (count, names, join times) near the top; the share CTA copy becomes "Send it to the people coming" (not "get votes"). Owner can remove a participant. |
| 2.5 | **Crew-ask link reuse** | `?vote=1` links (`crewAsk`) show the same header; the vote banner becomes secondary copy under *I'm going*. The `?ref` attribution on `planOwnHref` stays. |
| 2.6 | **Four locales** | New strings in `messages/{en,es,it,pt}` for join/going/name/email. No English fallbacks in production. |

**Tests:** two-context Playwright e2e (owner shares ⇄ anon recipient taps *I'm going* ⇄ owner sees the participant) · RLS test that anon cannot read `trip_participants` · rate limit on `/join` (per cookie, per trip).
**Measure:** recipient→participant tap rate on human recipient sessions (baseline 0); participants per shared trip; email capture rate; participant→own-trip rate (the K stage).
**Exit gate:** tap rate reported weekly from `page_views_human` + `trip_participants`; two consecutive weeks of data.
**Kill/pivot:** tap rate **< 5% after 4 weeks with ≥ 300 human recipient sessions** → recipients are browsing, not travelling on this trip → keep *I'm going* only on `?vote=1` crew-ask links and return the public page to a browse layout.

### Phase 3 — Today mode (Sep 21 – Oct 9) — *the daily open*

**Entry:** 2.1–2.3 shipped (participants exist to open it). **Why now:** this is the North Star's mechanism. Overlaps Phase 2's measurement window by design; it does not depend on Phase 2's result.

| # | Workstream | Detail |
|---|---|---|
| 3.1 | **Live-trip detection** | `is_live = start_date ≤ today_in_trip_tz ≤ end_date`. Trip timezone from the destination's coordinates (destination cache already carries lat/lng) stored as `trip_meta.timezone` at creation; one-off backfill for the 216 upcoming trips. Default when unknown: the owner's browser tz, flagged. |
| 3.2 | **Today view** | For owner *and* participants, a live trip opens on **Today**: date header · weather (existing) · **the current/next activity** with time, walking time, address, Maps/Website/Booking · the rest of today · tomorrow preview · yesterday collapsed. Reuse `TripDetailClient`'s renderers; add a `mode=today` entry state rather than a new page. Same view on `/shared` and `/trip` for participants. |
| 3.3 | **Four in-trip chips** | Above today's list: **Running late · Skip this · Swap nearby · Done for today**. Each sends a structured message to the existing AI agent with trip + day context; the result is applied to today for everyone via the existing real-time sync, with a one-tap undo. This is the 3,121-line editor's four-button front door. Participants can use them; changes carry the participant's name. |
| 3.4 | **Checklist and expenses inside Today** | They exist and are used by 0 and 3 trips because they live in a pre-trip UI. "Packed?" (`trip_checklists`) shows on the day before and day 1, then collapses. "Who paid?" quick-add on each activity in Today writes `trip_expenses` (+ `trip_expense_splits` across participants). No new tables. |
| 3.5 | **Activity feed** | "Marco marked lunch done · Anna swapped dinner": a small feed on Today built from `activity_status` + the chip actions. This is what makes N people open it. |
| 3.6 | **Four locales** | Today strings and chip labels in all four. |

**Tests:** timezone unit tests (DST edge, date-line trips) · e2e: participant opens a live trip → lands on Today → taps *Skip this* → owner sees the change · chip actions idempotent under double-tap.
**Measure:** **TODT** (North Star) · opens per live trip-day · chip actions per live trip · checklist/expense use on live trips (baseline 0/3).
**Exit gate:** TODT computed weekly from `trip_views` for the Sep 26 – Oct 26 cohort; first zero-to-one milestone logged (first participant-initiated in-trip change).
**Kill/pivot:** **TODT < 10% after 60 days across ≥ 100 travelled trips** → people do not want a live plan → fall back to the day-before digest only (Phase 4.1) and stop investing in in-trip actions.

### Phase 4 — Trip-time notifications (Oct 5–16)

**Entry:** Today mode live; participant email capture (2.2) exists. **Why now:** the re-open trigger for the ~7.8 days of a trip; without it Today mode relies on memory.

| # | Workstream | Detail |
|---|---|---|
| 4.1 | **In-trip slots** | Extend the 5-slot pre-trip cascade (`enqueue_trip_notifications` RPC, `scheduled_notifications`, `lib/notifications/scheduling.ts`, `TripReminder.tsx`) with one **evening-before digest per trip day** at 19:00 trip-local: "Tomorrow: Day 3 — Alfama. Lunch 13:00 at Claras em Castelo." Deep link to Today. Morning-of nudge exists as a slot but ships **off**. Idempotent re-enqueue on every save, like the existing cascade. |
| 4.2 | **Recipients** | Owner + participants who gave an email. Respect `notification_settings`, the suppression rules (never re-suppress to pause; use `SEND_CAP`), and the Resend guardrails already in place. |
| 4.3 | **Post-trip return hook** | Day after `end_date`: "How was Lisbon?" → existing feedback surface + "Plan the next one" → wizard prefilled with the same crew. This is the D+7 return metric's lever. |
| 4.4 | **Four locales** | Templates in all four; reuse the `TripReminder` layout. |

**Tests:** scheduling unit tests for local-time slots across tz · Resend test-mode e2e · unsubscribe honoured within one run.
**Measure:** digest open rate · click → Today · return at D+7 post-trip (baseline ≈ 7.4% ever-return).
**Kill/pivot:** complaint/unsubscribe spike per existing guardrails → keep evening-before only, drop everything else.

### Phase 5 — Positioning truth and the product-query cluster (Oct 12–16)

**Entry:** Phases 2–3 have two weeks of data. **Why now:** copy should describe what is measured, and the one purchase-intent SEO cluster is still unaddressed.

| # | Workstream | Detail |
|---|---|---|
| 5.1 | **Homepage middle third** | Rewrite around the live trip ("the plan that's with you on the trip"); demote "Democratic trip planning" until participants/trip > 1 is common. Same for `/group-trip-planner` and siblings, in it/es/pt with native-quality copy. |
| 5.2 | **The link sells participation** | `/api/og/trip` image shows "N going" and today's plan when live. The shared link becomes the invitation. |
| 5.3 | **Comparison content** | Refresh `best-ai-trip-planners-2026-compared` (four locales) with fetched-and-verified competitor facts only (Mindtrip Flights May 2026; Wanderlog $39.99/yr; Layla gating; Gemini free) and honest MonkeyTravel positioning (live trip, no signup, no booking yet). Target the ~22k-impression cluster at positions 9–17. Retarget `blog.json` titles to the searched phrasing. IndexNow on the apex after deploy. |
| 5.4 | **Trip detail diet (UX10X 4.2, carried)** | Owner action bar → Share / Edit with AI / More. |

**Tests:** visual regression on the four core surfaces; link check 0 broken / 0 redirected on the comparison post.
**Exit gate:** every homepage claim maps to a measured number; comparison post live in four locales and submitted.
**Kill:** none.

### Phase 6 — Mobile presence without an app store (Oct 19–30)

**Entry:** Today mode has one measured cohort. **Why now:** the moment of use is a phone in a foreign city, and the product is a web tab.

| # | Workstream | Detail |
|---|---|---|
| 6.1 | **PWA** | Manifest + service worker. Install prompt shown **on Today mode only** ("Add to home screen for the trip"). Offline cache of the live trip: the trip JSON, today's and tomorrow's images, the map tiles already requested. The abroad-with-no-data case. |
| 6.2 | **Replace the waitlist** | "Mobile coming soon / Join waitlist" → "Add to home screen". Native apps stay parked; do not promise them. |

**Tests:** Lighthouse PWA audit green; offline e2e (network off → Today renders from cache).
**Measure:** installs per live trip; offline opens.
**Kill/pivot:** installs < 5% of live trips after 30 days → keep offline cache, drop the prompt.

### Phase 7 — Compound (Nov → ongoing)

- **Weekly 30-minute ritual:** dashboard (TODT, participants/trip, K components, all from the human view) → 20 session replays → one explicit kill/keep/double-down decision appended to this doc.
- **SEO cadence continues:** month posts done through March; Christmas markets done; NYE/ski/northern-lights only when demand is measured on our own pages (`gsc-theme-gaps`, `gsc-page-vs-query`), never on slug guesses.
- **`/shared` noindex revisit** only when participants/trip > 1 is common — indexable shared trips carrying "N going" are UGC with social proof.
- **Explore** gets investment only when trip volume feeds it.
- **Booking** (Mindtrip's moat) is the first candidate for the plan *after* this one, once TODT proves people are in the app at the moment of decision. Out of scope here.

---

## 5. Measurement doctrine

- **Volume:** ~30 signups/week, ~150–250 human recipient sessions/week. Classical A/B is theatre at this scale; use frozen baselines, before/after, absolute guardrails, zero-to-one milestones.
- **Sources of truth:** `trip_views` (Phase 0.1), `trip_participants`, `page_views_human`, `wizard_step_events`, GSC. **Not** raw `page_views`, **not** GA4.
- **Guardrails (investigate on breach):** saves/day < 1 for 3 days; human recipient sessions/week < 100; wizard step-1→2 falls > 20% relative vs the frozen baseline; Resend complaint rate per existing rule.
- **Flags** (`lib/posthog/flags.ts`): `live_trip_participants`, `today_mode`, `in_trip_digest`, `pwa_install_prompt`. Rollback switches, reviewed with `npm run flags:review`. Arms must fail closed, not open.

---

## 6. Decisions reserved for Federico

1. **Retire the vote-before thesis** (UX10X Phase 3) in favour of the live trip. This plan assumes yes.
2. **Participant email consent wording** (Phase 2.2): purpose-limited to trip notifications; confirm the copy in four languages.
3. **Trip timezone default** when a destination has no coordinates (Phase 3.1).
4. **PWA instead of the native promise** (Phase 6). The homepage currently promises iOS/Android.
5. **Homepage copy sign-off** (Phase 5.1).
6. **Flag flips** in PostHog after each phase's probe — only you have dashboard access.

---

## 7. Risks and kill criteria (top level)

| Risk | Trigger | Response |
|---|---|---|
| Recipients browse, don't travel | Phase 2 tap rate < 5% at n ≥ 300 | Restrict *I'm going* to crew-ask links; public page returns to browse layout |
| Nobody opens the live trip | TODT < 10% at 60 days, n ≥ 100 | Keep evening-before digest only; stop in-trip actions |
| Agent chips produce bad edits | undo rate > 30% on chip actions | Chips propose, owner confirms; keep undo |
| Notification fatigue | complaint/unsub spike per Resend guardrail | Evening-before only |
| Measurement drifts back to raw tables | any dashboard reading `page_views` directly | CI check: admin queries must reference `page_views_human` |
| Locale regressions | a string ships in one locale | CI: no untranslated keys in es/it/pt for touched namespaces |
| Founder bandwidth | phases slip | Cut from the bottom (Phase 6, then 5.4); never Phase 0 |

---

## 8. The step list — in the order we execute

1. Wire `trip_views` from all three renderers; verify rows in prod. *(0.1)*
2. Build `page_views_human` + nightly `is_automation` stamp; switch the dashboard to it. *(0.2)*
3. Freeze baselines into this doc; write the analytics-narrative note. *(0.4, 0.5)*
4. Cookie banner off the CTA; wizard help-button overlap; screenshots at both viewports. *(1.1, 1.2)*
5. Trip locale stored and honoured by the agent; backfill mixed-language public trips to 0. *(1.3)*
6. Explore dedupe + trips above the fold; remove the homepage premium line. *(1.4, 1.5)*
7. `trip_participants` table + `/join` API + RLS check. *(2.1)*
8. `SharedTripView` header: "N going" + **I'm going** replaces Like/Save/Fork; page reorder; remove mid-page save wall; ≤ 6 mobile screens to first activity. *(2.2, 2.3)*
9. Owner "Who's going" card and share copy. *(2.4, 2.5)*
10. Four-locale strings for Phase 2; two-context e2e; ship behind `live_trip_participants`; start the 4-week measurement clock. *(2.6)*
11. Trip timezone + `is_live`; backfill upcoming trips. *(3.1)*
12. Today view as `TripDetailClient` entry state; same for participants on `/shared` and `/trip`. *(3.2)*
13. The four in-trip chips wired to the existing agent with undo. *(3.3)*
14. Checklist and "Who paid?" inside Today; activity feed. *(3.4, 3.5)*
15. Four-locale strings for Phase 3; ship behind `today_mode`; first TODT cohort = trips starting Sep 26 – Oct 26. *(3.6)*
16. Evening-before digest slot in the cascade; participant recipients; post-trip return hook. *(4.1–4.3)*
17. Homepage middle third rewrite (four locales); OG image with "N going". *(5.1, 5.2)*
18. Comparison post refresh for the ~22k-impression product cluster; IndexNow. *(5.3)*
19. PWA manifest, offline cache of the live trip, install prompt on Today only; retire the waitlist copy. *(6.1, 6.2)*
20. Weekly ritual begins; decisions appended below. *(7)*

---

## Appendix A — File map (where each change lands)

| Area | Path | Phase |
|---|---|---|
| Recipient renderer (both routes) | `app/[locale]/shared/[token]/SharedTripView.tsx` (939 lines); `app/[locale]/trip/[slug]/page.tsx` imports it | 2, 3 |
| Owner trip view | `app/[locale]/trips/[id]/TripDetailClient.tsx` (3,121 lines) | 2.4, 3 |
| Anonymous votes (reuse identity) | `app/api/shared/[token]/vote/route.ts`, `…/votes/route.ts`, `app/api/trips/[id]/crew-votes/route.ts` | 2.1, 2.5 |
| Dead view writer to wire | `app/api/trips/[id]/view/route.ts` | 0.1 |
| Bot labelling (leave UA-only; add view) | `lib/analytics/bot-detection.ts`, `lib/supabase/middleware.ts`, `app/api/page-engaged/route.ts` | 0.2 |
| Cookie banner | `components/consent/CookieConsentBanner.tsx`, `components/consent/ConsentWrapper.tsx`, `app/[locale]/trips/new/NewTripWizard.tsx` | 1.1, 1.2 |
| Notifications | `lib/notifications/scheduling.ts`, RPC `enqueue_trip_notifications`, `app/api/cron/scheduled-notifications/route.ts`, `lib/email/templates/TripReminder.tsx` | 4 |
| Flags | `lib/posthog/flags.ts`, `lib/posthog/hooks.ts` | all |
| Explore | `app/[locale]/explore/page.tsx`, `app/api/explore/trips` | 1.4 |
| OG image | `app/api/og/trip` | 5.2 |
| Comparison post | `content/blog/{,es/,it/,pt/}best-ai-trip-planners-2026-compared.md`, `messages/*/blog.json` | 5.3 |
| GSC tooling | `scripts/gsc-daily.mts`, `gsc-theme-gaps.mts`, `gsc-cluster-verify.mts`, `gsc-month-post-queries.mts`, `gsc-page-vs-query.mts` | 7 |

## Appendix B — Data snapshot, 2026-09-04

| Metric | Value |
|---|---|
| Users total / last 8 weeks | 521 / 269 |
| Returned ≥ 2 logins (8w cohort) | 20 (7.4%) |
| Trips total / with dates | 459 / 459 |
| Upcoming: all / 30d / 60d / in progress today | 216 / 80 / 121 / 22 |
| Upcoming and already shared | 40 |
| Travelled since May / edited during / checklist / expenses | 171 / 9 / 0 / 3 |
| Shares lifetime / invites / collaborators | 80 / 6 / 3 |
| Votes: anonymous / authenticated | 53 / 0 |
| Signups via invite / referred | 2 / 1 |
| Referral clicks → signups (28d) | 43 → 1 |
| Human recipient sessions / 28d (est.) | 600–900 |
| Recipient → wizard / → auth | 37.8% / 9.7% |
| `trip_views` rows ever | 0 |
| Product-query impressions / 28d, positions | ~22,000 at 9–17 |
| Organic clicks/day (GSC) | ~188, flat |

## Appendix C — What carries over from UX10X unchanged

Operating principles 1–5 · the cut list (C1, C2, C7, C8, C9 as decided) · measurement doctrine · "live-test via UI" rule · Phase 4.2 trip-detail diet (now Phase 5.4) · the Mindtrip-copies-us defence (speed + own the phrase, now "the plan that's with you on the trip").

## Baseline 2026-09-05 (28 full UTC days, 2026-08-08 → 2026-09-05 exclusive)

*Produced by `scripts/baseline-snapshot.mts` from `get_live_trip_baseline(28)` at 2026-09-05T15:24Z. Every figure reads labelled human data (`page_views_human`, automation labels applied to wizard sessions). Re-run the same command for the weekly ritual; never hand-edit these numbers.*

| Area | Metric | Value |
|---|---|---|
| North Star | **TODT** — trips with ≥1 human open on a day inside their dates, of trips completed in the window | **0%** (96 trips) — trip_views began on 2026-09-05; trips that completed before that date cannot have been observed, so this reads low until a full window of measurement exists (first clean read: 28 days after 2026-09-05) |
| Live trip | trips in progress today / opened today | 22 / 0 |
| Live trip | edited during the trip (trips travelled since 2026-05-01) | 5.3% of 171 |
| Live trip | trip_views rows in window by source | none in window |
| Recipients | human recipient sessions (`/shared/*`, `/trip/*`) | 1642 (410.5/week) |
| Recipients | recipient → wizard / → auth | 29.8% / 11.9% |
| Recipients | **recipient → participant** (Phase 2 metric) | — — not yet built |
| Sharing | trips created / shared / share rate | 194 (6.9/day) / 42 / 19.6% |
| Sharing | recipient sessions per shared trip | 39.1 |
| Sharing | **participants per shared trip** (Phase 2 metric) | — — not yet built |
| K | new users / via invite / referred / **K** | 134 / 2 / 1 / **0.022** |
| Retention | cohort return ≥2 logins | 8.2% of 134 |
| Retention | post-trip 7-day return (owner opened anything within 7 days after end_date) | 10.7% of 84 trips |
| Wizard | step-1 → step-2 (wizard arm, as `get_ux10x_rates`) | 37.4% (812 of 2174) |
| Wizard | step-1 → result / result → saved | 33.3% / 14.2% |
| Guardrail | saves per day (investigate if < 1 for 3 days) | 5.6 |
| Guardrail | human recipient sessions per week (investigate if < 100) | 410.5 |
| Guardrail | human page views per day | 5029 |
| Guardrail | automation share of `is_bot=false` views | 9.1% |

## Decisions log

*(append weekly: date · decision · evidence · owner)*
