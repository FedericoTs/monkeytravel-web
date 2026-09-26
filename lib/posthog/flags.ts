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

/*
 * RETIRED — no constant, nothing to re-wire.
 *
 * wizard-step1-editorial-v1: shipped 2026-09-02 at 90/10 as a kill switch
 * (an unresolved flag was ON), ramped to 100% and the classic step 1 deleted
 * on 2026-09-16. The review could not separate the arms on step-1→2
 * conversion (dwell-qualified 74.6% before, 75.8% after, p=0.60) and 99.9% of
 * armed sessions were already editorial, so the call was made on the merits.
 * History lives in wizard_step_events.step1_variant.
 * The PostHog flag can be archived; nothing reads it any more.
 */

/*
 * RETIRED — no constant, nothing to re-wire.
 *
 * front-door: wizard vs decision-first, 50/50 from 2026-07-01 (a local coin
 * for PostHog-blocked browsers). Concluded 2026-08-17 — the wizard won on
 * every measure (save rate 11.8% vs 5.4%, result rate 51% vs 35%, n=3,067
 * anon sessions); the flag served wizard 100% from that day and the decision
 * arm (DecisionIntake, /api/ai/decide, lib/ai/decide.ts) was deleted on
 * 2026-09-18. Rows keep front_door = 'wizard'. The PostHog flag can be
 * archived; nothing reads it any more.
 */

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
  // Empty since 2026-09-16: wizard-step1-editorial-v1 was ramped to 100%.
};
