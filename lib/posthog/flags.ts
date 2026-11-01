/**
 * Feature Flag Keys
 *
 * Centralized definitions for all feature flags used in the app.
 *
 * READ THIS BEFORE ADDING A FLAG. Every constant sits in one section:
 *
 *   LIVE      — read by application code.
 *   NOT WIRED — a hypothesis we may still run, with no consumer: reading one
 *               returns its default and changes nothing.
 *   TOMBSTONE — kept as a warning. Do not re-wire.
 *
 * `flags-are-wired.vitest.ts` keeps the sections true: a constant must be
 * referenced outside this file or be listed in UNWIRED_FLAGS below.
 */

// ============================================================================
// LIVE — read by application code
// ============================================================================

/**
 * Enhanced Booking Panel
 * Show Travelpayouts partners (Booking.com, Trip.com, Klook, etc.)
 * instead of original affiliates (Aviasales, Hotellook)
 *
 * Read by: app/[locale]/(app)/trips/[id]/TripDetailClient.tsx
 */
export const FLAG_ENHANCED_BOOKING = "enhanced-booking-panel";

// ============================================================================
// NOT WIRED — declared, no consumer. Reading these returns the default.
// ============================================================================

/**
 * Magic-link vs password CTA prominence
 *
 * Tests whether keeping the magic-link as the primary action or surfacing the
 * password option side-by-side performs better at post-result trip save.
 *
 * Variants:
 *  - magic-link-primary: email field + "Email me the link"
 *  - dual-prominent:     two equal-weight buttons
 *  - magic-link-only:    no password escape hatches at all
 *
 * Not wired: AuthPromptModal.tsx does not read it.
 */
export const FLAG_AUTH_WALL_VARIANT = "auth-wall-variant";
export type AuthWallVariant = "magic-link-primary" | "dual-prominent" | "magic-link-only";

/**
 * Concierge surface gate
 *
 * Whether to show the TripConciergeChat button on all trips or only during the
 * live-trip window. Hypothesis: live-only positioning concentrates use around
 * the highest-utility moment ("what's near me after lunch").
 *
 * Variants: always | live-only | off
 *
 * Not wired: TripConciergeChat.tsx does not read it; the env flag is the
 * only switch.
 */
export const FLAG_CONCIERGE_SURFACE = "concierge-surface";
export type ConciergeSurfaceVariant = "always" | "live-only" | "off";

/**
 * Anonymous engagement on /explore
 *
 * Whether anonymous viewers can like/save trips with cookie-keyed state, or
 * must auth before any engagement action.
 *
 * Variants: cookie-keyed | auth-gated
 *
 * Not wired: EngagementBar.tsx does not read it.
 */
export const FLAG_EXPLORE_ANON_ENGAGEMENT = "explore-anon-engagement";
export type ExploreAnonEngagementVariant = "cookie-keyed" | "auth-gated";

/**
 * Wizard step layout
 *
 * Tests whether collapsing the 2-step wizard into one screen lifts
 * step1 → result conversion.
 *
 * Variants: two-step | one-screen
 *
 * Not wired: NewTripWizard.tsx does not read it.
 */
export const FLAG_WIZARD_LAYOUT = "wizard-layout";
export type WizardLayoutVariant = "two-step" | "one-screen";

/**
 * Wizard mobile-first redesign (P11)
 * Gates the new /trips/new layout.
 *
 * Not wired; at 0% in PostHog.
 */
export const FLAG_WIZARD_UX_V2 = "wizard-ux-v2";

/**
 * Wizard performance v2 (P10)
 * Gates the code-split / lazy-loaded wizard JS bundle for LCP/INP on
 * /trips/new.
 *
 * Not wired; at 0% in PostHog.
 */
export const FLAG_WIZARD_PERF_V2 = "wizard-perf-v2";

/**
 * Listicle in-article CTA v1 (P6)
 * Gates the mini-quiz CTA inside the Italian summer post.
 *
 * Not wired; at 0% in PostHog.
 */
export const FLAG_LISTICLE_CTA_V1 = "listicle-cta-v1";

// ============================================================================
// TOMBSTONE — do not re-wire
// ============================================================================

/**
 * @deprecated Never created in PostHog — no consumer, do not re-wire.
 *
 * Meant as the cohort ramp on top of EXPLORE_UGC_ENABLED, but the PostHog flag
 * was never made, so `useFlag` returned nothing and the post-save Publish CTA
 * rendered for no one. Kept as a tombstone so the next person to reach for a
 * cohort ramp here reads this first. EXPLORE_UGC_ENABLED is the only switch.
 */
export const FLAG_EXPLORE_UGC = "explore-ugc-v1";

/*
 * RETIRED — no constant, nothing to re-wire.
 *
 * wizard-step1-editorial-v1: the editorial step 1 was ramped to everyone and
 * the classic one deleted. The arm each session saw is in
 * wizard_step_events.step1_variant. The PostHog flag can be archived; nothing
 * reads it.
 */

/*
 * RETIRED — no constant, nothing to re-wire.
 *
 * front-door: wizard vs decision-first, 50/50, with a local coin for
 * PostHog-blocked browsers. The wizard won on save rate and result rate, and
 * the decision arm (DecisionIntake, /api/ai/decide, lib/ai/decide.ts) was
 * deleted. Rows keep front_door = 'wizard'. The PostHog flag can be archived;
 * nothing reads it.
 */

/*
 * RETIRED — no constant, nothing to re-wire.
 *
 * result-crew-first (first-party, not a PostHog flag): signed-out planners of
 * group trips saw either today's result screen or one that led with the crew
 * vote, 50/50. Crew-first did not lift shares, the bar the test had to clear,
 * so today's screen stays. The arm each session saw is in
 * wizard_step_events.result_variant.
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
export const FLAG_REVIEW_DATES: Record<string, string> = {};
