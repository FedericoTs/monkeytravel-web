/**
 * Feature Flag Keys
 *
 * Centralized definitions for all feature flags used in the app.
 *
 * READ THIS BEFORE ADDING A FLAG
 *
 * Audited 2026-08-21. This file declared 23 flag constants; application code
 * read exactly 3 of them. The rest were indistinguishable from live flags at a
 * glance — several carried a "Wired in: <file>" line naming a consumer that did
 * not reference the flag — so the file read as a much larger experimentation
 * program than actually existed. Two flags (`ai-assistant-model`,
 * `onboarding-flow`) also sat at 100% rollout in PostHog with no reader at all.
 *
 * The sections below are therefore load-bearing, not decoration:
 *
 *   LIVE      — read by application code right now.
 *   NOT WIRED — a real hypothesis we may still run, with NO consumer today.
 *               Reading one of these returns the default. Do not assume it
 *               does anything.
 *   TOMBSTONE — deliberately kept as a warning. Do not re-wire.
 *
 * `flags-are-wired.vitest.ts` enforces the split: a constant must either be
 * referenced outside this file or be listed in UNWIRED_FLAGS below. That guard
 * is what stops this file drifting back into theater.
 */

// ============================================================================
// LIVE — read by application code
// ============================================================================

/**
 * Enhanced Booking Panel
 * Show Travelpayouts partners (Booking.com, Trip.com, Klook, etc.)
 * instead of original affiliates (Aviasales, Hotellook)
 *
 * Read by: app/[locale]/trips/[id]/TripDetailClient.tsx
 */
export const FLAG_ENHANCED_BOOKING = "enhanced-booking-panel";

/**
 * Auto-save trip v1 (2026-05-02)
 * Gates the auto-save-on-generation-complete flow inside /trips/new.
 * Roll out 0% → 10% → 50% → 100% while watching the trip_created event
 * rate and the auto_save_failed Sentry tag.
 *
 * Read by: app/[locale]/trips/new/NewTripWizard.tsx
 */
export const FLAG_AUTO_SAVE_V1 = "auto-save-v1";

/**
 * Front door: wizard vs. decision-first (2026-06-30)
 *
 * Tests replacing the multi-step wizard with a single open prompt that
 * returns 2-3 destination/trip-shape PROPOSALS (a decision) before any full
 * itinerary is generated. Hypothesis: repositioning the value moment from
 * "here's your itinerary" to "here's the trip you should take" survives the
 * step-1 cliff. Once an option is picked the EXISTING generator + result page
 * run unchanged.
 *
 * Variants:
 *  - wizard:   current multi-step form → itinerary (control)
 *  - decision: open prompt → 2-3 proposals → pick → itinerary
 *
 * CONCLUDED 2026-08-17: wizard won (saves 11.8% vs 5.4%); flag set to wizard
 * at 100%. Still read by code, so it stays here rather than moving down.
 *
 * Read by: app/[locale]/trips/new/NewTripWizard.tsx
 */
export const FLAG_FRONT_DOOR = "front-door";
export type FrontDoorVariant = "wizard" | "decision";

/**
 * Wizard step-1 editorial entry (shipped 2026-09-02)
 *
 * Gates the visual half of the /trips/new step-1 rework: the masthead that
 * names the output ("Your trip, planned day by day." + about 30 seconds,
 * free, no account to see it), the six popular picks as one-tap starts that
 * also pencil in flexible dates, the multi-city switch demoted below the
 * destination, the footer's enabled "Use flexible dates" state, and the cream
 * ground. The unflagged half (claimed-trip banner, first-run suppression of
 * "Welcome back", signed-in reassurance copy, cookie-banner scoping, the
 * date-picker flip) ships as bug fixes and is reverted by commit, not flag.
 *
 * This is a KILL SWITCH at 90/10, not an experiment — ~96 trip-holders a
 * month cannot power one. Resolution in NewTripWizard, most specific first:
 *   ?step1=classic|editorial          QA override
 *   NEXT_PUBLIC_WIZARD_STEP1_FORCE     env force (covers ad-blocked browsers)
 *   PostHog value                      an UNRESOLVED flag is ON; only an
 *                                      explicit false renders classic
 * Levers: set the flag to 0% in PostHog (no deploy), or the env force
 * (redeploy). The 10% holdout is a live proof the kill path works and a
 * sanity reference; it is NOT a control arm.
 *
 * HOW TO READ IT — and the trap, found 2026-09-02 while checking early:
 *
 * Do NOT compare against the recorded 36.0% step1->2 baseline. That number is
 * real but no longer means what it did: on 2026-08-17 the share of step-1
 * sessions emitting ONE event and nothing else (no 10s dwell heartbeat, no
 * step 2) jumped from ~5-17% to ~51-58%, and step-1 "sessions" roughly doubled
 * from ~340/week to ~800. Genuinely engaged sessions stayed FLAT at ~300/week
 * throughout, so the denominator filled and every rate built on it fell
 * mechanically: 35.9% (trailing 30d) / 30.4% (14d) / 27.3% (7d) are three
 * different "baselines" for the same product, and picking among them decides
 * the verdict by itself.
 *
 * WHAT THAT TRAFFIC ACTUALLY IS (settled on the third attempt — the first two
 * guesses were wrong and are recorded here so nobody repeats them):
 *
 *   guess 1 "bots"    — right conclusion, no evidence behind it.
 *   guess 2 "people"  — the UA strings look like ordinary browsers, the
 *                       sessions average 3.3 page views, and 898 of 934 reach
 *                       /trips/new. All true, and all consistent with a
 *                       headless browser. Not evidence of a human.
 *   guess 3, settled  — geography and UA diversity settle it.
 *
 * Bounce and engagement by country, localized step-1 sessions, 14 days:
 *
 *   CN  374 bouncing   0 engaged   95.9%
 *   SG  109            0           92.4%
 *   HK   65            0           91.5%
 *   US  107            1           96.4%
 *   IT   47           33           58.0%
 *   ES    6           30           16.7%
 *
 * CN + SG + HK is 629 sessions sharing only 29 distinct user agents, 0.0% of
 * them flagged by the is_bot regex, and ZERO that ever dwell 10 seconds. The
 * real markets show MORE user-agent diversity across FEWER sessions. That is
 * automation from cloud regions hitting localized URLs, and the `locale`
 * column records the URL's locale, not a person's language — which is what
 * made it look like a Spanish-speaker problem.
 *
 * THERE IS NO LOCALIZED LANDING PROBLEM. Real Spanish traffic bounces at
 * 16.7%, BETTER than English at 22.5%, and localized visitors who engage
 * convert like everyone else (67-80% reach step 2 against 74.8% for en).
 * Do not build a localized landing fix for this; it would be solving nothing.
 *
 * What IS broken is the filter: is_bot catches 0.0% of these 629 sessions, so
 * they land in the denominator of every raw wizard-funnel rate. That is the
 * whole reason the 36.0% baseline moved without the product changing, and the
 * reason the dwell-qualified query above is the one to trust — a headless
 * visitor never emits step1_heartbeat.
 *
 * Read the dwell-qualified rate instead — sessions with a step1_heartbeat:
 *
 *   with s as (
 *     select session_id, min(created_at) as first_at,
 *            bool_or(step='step1_heartbeat')      as dwelled,
 *            bool_or(step='step_2_vibes')         as s2
 *     from wizard_step_events
 *     where created_at >= now() - interval '45 days' and session_id <> 'no_session'
 *     group by session_id having bool_or(step='step_1_destination_dates'))
 *   select count(*) filter (where dwelled) as n,
 *          round(100.0*count(*) filter (where dwelled and s2)
 *                /nullif(count(*) filter (where dwelled),0),1) as step2_pct
 *   from s where first_at >= '<ship or window start>';
 *
 * On that metric the pre-ship regime since 2026-08-17 is 74.5% (n=745). The
 * first ~10 hours post-ship read 76.0% (n=25) — i.e. nothing yet, and NOT the
 * +11 points a naive trailing-30d comparison appears to show.
 *
 * DO NOT RE-DERIVE ANY OF THIS BY HAND — run it:
 *
 *     npm run flags:review
 *
 * That prints both metrics with a confidence interval on every rate, the
 * two-sided p, a verdict, and how many more sessions the question needs. The
 * query above is what it runs; this comment is now the explanation, not the
 * procedure.
 *
 * TWO THINGS THAT SCRIPT WILL TELL YOU, RECORDED HERE SO THEY ARE NOT A
 * SURPRISE ON REVIEW DAY (measured 2026-09-03):
 *
 * 1. THE DATA CANNOT ANSWER THE QUESTION BY 2026-09-09. Dwell-qualified reads
 *    74.4% [71.2-77.4] (n=763) pre-ship against 68.2% [53.4-80.0] (n=44)
 *    post-ship, p=0.36 — inconclusive, and the intervals overlap almost
 *    entirely. Resolving a 5pp move against that baseline needs ~598 dwelled
 *    post-ship sessions; they arrive at ~42/day, i.e. ~14 days from ship, so
 *    09-09 lands at roughly 280 — enough for ~7pp and no finer. Decide on the
 *    merits, or move this date deliberately. Do not split the difference by
 *    leaving the flag at 90/10.
 *
 * 2. THE ARMS ARE NOT COMPARABLE POPULATIONS. resolveEditorialStep1 returns
 *    `flagValue !== false` — it FAILS OPEN, so every session where PostHog
 *    does not resolve (consent declined, script blocked) is counted as
 *    editorial. "classic" therefore means "PostHog resolved and said no",
 *    which selects for consenting, unblocked users. Since 2026-09-03 the arm
 *    is also recorded server-side in wizard_step_events.step1_variant, which
 *    makes the split measurable for the first time — measurable, not unbiased.
 *
 * REVIEW BY 2026-09-09 — see FLAG_REVIEW_DATES; flag-review-dates.vitest.ts
 * goes red a week after that. Ramp to 100% and delete the classic branches,
 * or set 0% and revert. Never left at 90/10: front-door ran unwatched for
 * six weeks.
 *
 * Read by: app/[locale]/trips/new/NewTripWizard.tsx
 */
export const FLAG_WIZARD_STEP1_EDITORIAL = "wizard-step1-editorial-v1";

// ============================================================================
// NOT WIRED — declared, no consumer. Reading these returns the default.
// ============================================================================

/**
 * Magic-link vs password CTA prominence (2026-06-06)
 *
 * Tests whether keeping the magic-link as the primary action or surfacing the
 * password option side-by-side performs better at post-result trip save.
 *
 * Variants:
 *  - magic-link-primary: email field + "Email me the link"
 *  - dual-prominent:     two equal-weight buttons
 *  - magic-link-only:    no password escape hatches at all
 *
 * NOT WIRED as of 2026-08-21. AuthPromptModal.tsx does not read this.
 */
export const FLAG_AUTH_WALL_VARIANT = "auth-wall-variant";
export type AuthWallVariant = "magic-link-primary" | "dual-prominent" | "magic-link-only";

/**
 * Concierge surface gate (2026-06-06)
 *
 * Whether to show the TripConciergeChat button on all trips or only during the
 * live-trip window. Hypothesis: live-only positioning concentrates use around
 * the highest-utility moment ("what's near me after lunch").
 *
 * Variants: always | live-only | off
 *
 * NOT WIRED as of 2026-08-21. TripConciergeChat.tsx does not read this; the
 * env flag remains the only switch.
 */
export const FLAG_CONCIERGE_SURFACE = "concierge-surface";
export type ConciergeSurfaceVariant = "always" | "live-only" | "off";

/**
 * Anonymous engagement on /explore (2026-06-06)
 *
 * Whether anonymous viewers can like/save trips with cookie-keyed state, or
 * must auth before any engagement action.
 *
 * Variants: cookie-keyed | auth-gated
 *
 * NOT WIRED as of 2026-08-21. EngagementBar.tsx does not read this.
 */
export const FLAG_EXPLORE_ANON_ENGAGEMENT = "explore-anon-engagement";
export type ExploreAnonEngagementVariant = "cookie-keyed" | "auth-gated";

/**
 * Wizard step layout (2026-06-06)
 *
 * Tests whether collapsing the 2-step wizard into one screen lifts
 * step1 → result conversion.
 *
 * Variants: two-step | one-screen
 *
 * NOT WIRED as of 2026-08-21. NewTripWizard.tsx does not read this.
 */
export const FLAG_WIZARD_LAYOUT = "wizard-layout";
export type WizardLayoutVariant = "two-step" | "one-screen";

/**
 * Wizard mobile-first redesign (P11)
 * Gates the new /trips/new layout.
 *
 * NOT WIRED as of 2026-08-21; sits at 0% in PostHog.
 */
export const FLAG_WIZARD_UX_V2 = "wizard-ux-v2";

/**
 * Wizard performance v2 (P10)
 * Gates the code-split / lazy-loaded wizard JS bundle for LCP/INP on
 * /trips/new.
 *
 * NOT WIRED as of 2026-08-21; sits at 0% in PostHog.
 */
export const FLAG_WIZARD_PERF_V2 = "wizard-perf-v2";

/**
 * Listicle in-article CTA v1 (P6)
 * Gates the mini-quiz CTA inside the Italian summer post.
 *
 * NOT WIRED as of 2026-08-21; sits at 0% in PostHog.
 */
export const FLAG_LISTICLE_CTA_V1 = "listicle-cta-v1";

// ============================================================================
// TOMBSTONE — do not re-wire
// ============================================================================

/**
 * @deprecated Never created in PostHog — no consumer, do not re-wire.
 *
 * This was meant to be the cohort ramp on top of EXPLORE_UGC_ENABLED. The env
 * flag went true but the PostHog flag was never made, so `useFlag` returned
 * nothing and the post-save Publish CTA rendered for zero users from the day
 * it shipped. Verified 2026-08-04 by querying PostHog's /flags endpoint
 * directly: 10 flags served to this project, none matching /explore/.
 *
 * Kept as a tombstone rather than deleted so the next person to reach for a
 * cohort ramp here reads this first. EXPLORE_UGC_ENABLED is the only switch.
 */
export const FLAG_EXPLORE_UGC = "explore-ugc-v1";

// ============================================================================
// FLAG CONFIGURATION
// ============================================================================

/**
 * Flags with no consumer in application code.
 *
 * Listing a key here is an assertion that its absence from the codebase is
 * intentional. `flags-are-wired.vitest.ts` fails if a constant is neither
 * referenced outside this file nor listed here — so a flag cannot quietly
 * become theater, and a flag that gets wired up must be removed from this list.
 */
export const UNWIRED_FLAGS: readonly string[] = [
  FLAG_AUTH_WALL_VARIANT,
  FLAG_CONCIERGE_SURFACE,
  FLAG_EXPLORE_ANON_ENGAGEMENT,
  FLAG_WIZARD_LAYOUT,
  FLAG_WIZARD_UX_V2,
  FLAG_WIZARD_PERF_V2,
  FLAG_LISTICLE_CTA_V1,
  FLAG_EXPLORE_UGC,
];

/**
 * Default values for flags (used as fallbacks)
 */
export const FLAG_DEFAULTS: Record<string, boolean | string> = {
  [FLAG_ENHANCED_BOOKING]: false, // Start disabled, enable via PostHog
  [FLAG_AUTO_SAVE_V1]: false,
  [FLAG_FRONT_DOOR]: "wizard",
  [FLAG_WIZARD_STEP1_EDITORIAL]: true, // fail-open: unresolved = on, only explicit false kills
  [FLAG_AUTH_WALL_VARIANT]: "magic-link-primary",
  [FLAG_CONCIERGE_SURFACE]: "always",
  [FLAG_EXPLORE_ANON_ENGAGEMENT]: "auth-gated",
  [FLAG_WIZARD_LAYOUT]: "two-step",
  [FLAG_WIZARD_UX_V2]: false,
  [FLAG_WIZARD_PERF_V2]: false,
  [FLAG_LISTICLE_CTA_V1]: false,
};

/**
 * Review dates for rollout flags, ISO YYYY-MM-DD, set to ship date + 7.
 * lib/posthog/flag-review-dates.vitest.ts fails once today is more than a
 * week past a date here, so a flag cannot sit at 90/10 with nobody watching.
 * Remove the entry when the flag is ramped to 100% or reverted.
 */
export const FLAG_REVIEW_DATES: Record<string, string> = {
  [FLAG_WIZARD_STEP1_EDITORIAL]: "2026-09-09",
};

/**
 * Get default value for a flag
 */
export function getDefaultFlagValue(flagKey: string): boolean | string {
  return FLAG_DEFAULTS[flagKey] ?? false;
}
