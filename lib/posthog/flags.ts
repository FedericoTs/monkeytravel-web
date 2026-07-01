/**
 * Feature Flag Keys
 *
 * Centralized definitions for all feature flags used in the app.
 * This ensures type safety and easy discoverability.
 */

// ============================================================================
// EXPERIMENT FLAGS (A/B Tests)
// ============================================================================

/**
 * Pricing tier experiment
 * Tests different price points for Pro subscription
 */
export const FLAG_PRICING_TIER = "pricing-tier-test";
export type PricingTierVariant = "control" | "high-price" | "low-price";

/**
 * Trial duration experiment
 * Tests different trial lengths for conversion optimization
 */
export const FLAG_TRIAL_DURATION = "trial-duration";
export type TrialDurationVariant = "7-days" | "14-days" | "3-days";

/**
 * Share modal timing experiment
 * Tests when to show the share prompt after trip save
 * @deprecated Use FLAG_SHARE_MODAL_TIMING_EXP for the active experiment
 */
export const FLAG_SHARE_MODAL_DELAY = "share-modal-delay";
export type ShareModalDelayVariant = "immediate" | "delayed" | "on-scroll";

/**
 * Share modal timing experiment (Active A/B Test)
 * Tests delay before showing share modal after trip save
 * Hypothesis: Brief delay lets users appreciate their trip, increasing shares
 *
 * Variants:
 * - control: Show immediately (0s)
 * - delayed-2s: Show after 2 seconds
 * - delayed-5s: Show after 5 seconds
 */
export const FLAG_SHARE_MODAL_TIMING_EXP = "share-modal-timing-exp";
export type ShareModalTimingVariant = "control" | "delayed-2s" | "delayed-5s";

/**
 * Onboarding steps experiment
 * Tests reduced onboarding for faster activation
 */
export const FLAG_ONBOARDING_STEPS = "onboarding-steps";
export type OnboardingStepsVariant = "4-steps" | "3-steps" | "2-steps";

/**
 * Upgrade prompt style experiment
 * Tests different upgrade prompt presentations
 */
export const FLAG_UPGRADE_PROMPT_STYLE = "upgrade-prompt-style";
export type UpgradePromptStyleVariant = "modal" | "banner" | "toast";

/**
 * Referral messaging experiment
 * Tests different referral incentive copy
 */
export const FLAG_REFERRAL_MESSAGING = "referral-messaging";
export type ReferralMessagingVariant = "earn-rewards" | "help-friends" | "unlock-features";

// ============================================================================
// FEATURE ROLLOUT FLAGS (Boolean)
// ============================================================================

/**
 * New AI features rollout
 * Gradually enable new AI capabilities
 */
export const FLAG_NEW_AI_FEATURES = "new-ai-features";

/**
 * Collaboration v2
 * New collaboration features with proposal voting
 */
export const FLAG_COLLABORATION_V2 = "collaboration-v2";

/**
 * Session replay
 * Enable PostHog session recording
 */
export const FLAG_SESSION_REPLAY = "session-replay";

/**
 * Enhanced analytics
 * Enable detailed user journey tracking
 */
export const FLAG_ENHANCED_ANALYTICS = "enhanced-analytics";

/**
 * Premium templates
 * Show premium trip templates
 */
export const FLAG_PREMIUM_TEMPLATES = "premium-templates";

/**
 * Enhanced Booking Panel
 * Show Travelpayouts partners (Booking.com, Trip.com, Klook, etc.)
 * instead of original affiliates (Aviasales, Hotellook)
 */
export const FLAG_ENHANCED_BOOKING = "enhanced-booking-panel";

/**
 * Wizard mobile-first redesign (P11)
 * Gates the new /trips/new layout. 0% rollout until session-replay data lands.
 */
export const FLAG_WIZARD_UX_V2 = "wizard-ux-v2";

/**
 * Wizard performance v2 (P10)
 * Gates the code-split / lazy-loaded wizard JS bundle to fix LCP/INP on /trips/new.
 */
export const FLAG_WIZARD_PERF_V2 = "wizard-perf-v2";

/**
 * Listicle in-article CTA v1 (P6)
 * Gates the mini-quiz CTA inside the Italian summer post.
 */
export const FLAG_LISTICLE_CTA_V1 = "listicle-cta-v1";

/**
 * Auto-save trip v1 (2026-05-02)
 * Gates the auto-save-on-generation-complete flow inside /trips/new.
 * Roll out 0% → 10% → 50% → 100% while watching the trip_created event
 * rate and the auto_save_failed Sentry tag.
 */
export const FLAG_AUTO_SAVE_V1 = "auto-save-v1";

/**
 * Magic-link vs password CTA prominence (2026-06-06)
 *
 * Tests whether keeping the magic-link as the primary action (current)
 * or surfacing the password option side-by-side performs better at
 * post-result trip save. Hypothesis: magic-link primary wins, but the
 * old auth wall design had 0 saves so this is the first time we'll
 * have signal either way.
 *
 * Variants:
 *  - magic-link-primary: current design (email field + "Email me the link")
 *  - dual-prominent:     two equal-weight buttons (Email link OR Sign up with password)
 *  - magic-link-only:    no password escape hatches at all
 *
 * Wired in: components/ui/AuthPromptModal.tsx
 */
export const FLAG_AUTH_WALL_VARIANT = "auth-wall-variant";
export type AuthWallVariant = "magic-link-primary" | "dual-prominent" | "magic-link-only";

/**
 * Concierge surface gate (2026-06-06)
 *
 * Whether to show the F4 TripConciergeChat button on all trips or only
 * during the live-trip window (today inside the trip dates). Hypothesis:
 * live-only positioning concentrates use around the highest-utility
 * moment (asking "what's near me after lunch") and lifts engagement.
 *
 * Variants:
 *  - always: show on every trip page (current)
 *  - live-only: only render when today is inside the trip window
 *  - off: hide entirely (used to A/B against no-Concierge baseline)
 *
 * Wired in: components/trip/TripConciergeChat.tsx (env flag remains
 * the kill switch — this flag toggles within the enabled cohort).
 */
export const FLAG_CONCIERGE_SURFACE = "concierge-surface";
export type ConciergeSurfaceVariant = "always" | "live-only" | "off";

/**
 * Anonymous engagement on /explore (2026-06-06)
 *
 * Whether anonymous viewers can like/save trips with cookie-keyed
 * state, or must auth before any engagement action. Hypothesis:
 * cookie-keyed anon engagement increases activation by letting users
 * commit to trips they like before being asked to sign up — they
 * then sign up to keep their saves.
 *
 * Variants:
 *  - cookie-keyed: anon can like + save; auth required only for fork/publish
 *  - auth-gated:   any engagement bounces to /auth/signup (current behavior)
 *
 * Wired in: components/explore/EngagementBar.tsx
 */
export const FLAG_EXPLORE_ANON_ENGAGEMENT = "explore-anon-engagement";
export type ExploreAnonEngagementVariant = "cookie-keyed" | "auth-gated";

/**
 * Wizard step layout (2026-06-06)
 *
 * Tests whether collapsing the 2-step wizard into one screen lifts
 * step1 → result conversion. Current design splits destination/dates
 * (step 1) from vibes/budget (step 2); collapse would put it all on
 * one scroll. Risk: longer page = more visual friction. Reward: kills
 * the step1 → step2 drop-off entirely.
 *
 * Variants:
 *  - two-step:   current (destination+dates → vibes+budget)
 *  - one-screen: everything on one scroll, single Generate CTA
 *
 * Wired in: app/[locale]/trips/new/NewTripWizard.tsx
 */
export const FLAG_WIZARD_LAYOUT = "wizard-layout";
export type WizardLayoutVariant = "two-step" | "one-screen";

/**
 * Front door: wizard vs. decision-first (2026-06-30)
 *
 * Tests replacing the multi-step wizard with a single open prompt that
 * returns 2-3 destination/trip-shape PROPOSALS (a decision) before any full
 * itinerary is generated. Hypothesis: repositioning the value moment from
 * "here's your itinerary" to "here's the trip you should take" survives the
 * step-1 cliff (54% of sessions bail before submitting step 1). Once an option
 * is picked the EXISTING generator + result page run unchanged.
 *
 * Variants:
 *  - wizard:   current multi-step form → itinerary (control)
 *  - decision: open prompt → 2-3 proposals → pick → itinerary
 *
 * Anon-only; authenticated users are forced to `wizard`.
 * Wired in: app/[locale]/trips/new/NewTripWizard.tsx (form-return seam ~:2372).
 * Plan: docs/DECISION_FRONT_DOOR_PLAN.md
 */
export const FLAG_FRONT_DOOR = "front-door";
export type FrontDoorVariant = "wizard" | "decision";

/**
 * /explore UGC trip feed (2026-05-25)
 * Gates the public-trip-catalog launch — /explore page, publish toggle,
 * like / save / fork / report API routes, trending block on homepage.
 * Plan: docs/PLAN_EXPLORE_UGC_FEED.md
 *
 * Week 1 build (migrations + APIs) ships behind this flag at 0%. APIs
 * 404 to anyone not in the cohort. Week 3 launch: 10% → 50% → 100%
 * over a week while watching:
 *   - explore_trip_published       (intent)
 *   - explore_trip_forked          (loop closure)
 *   - explore_trip_reported        (abuse signal)
 *   - trip_likes/save insert rate  (engagement)
 */
export const FLAG_EXPLORE_UGC = "explore-ugc-v1";

// ============================================================================
// FLAG CONFIGURATION
// ============================================================================

/**
 * Default values for flags (used as fallbacks)
 */
export const FLAG_DEFAULTS: Record<string, boolean | string> = {
  [FLAG_PRICING_TIER]: "control",
  [FLAG_TRIAL_DURATION]: "7-days",
  [FLAG_SHARE_MODAL_DELAY]: "immediate",
  [FLAG_SHARE_MODAL_TIMING_EXP]: "control",
  [FLAG_ONBOARDING_STEPS]: "4-steps",
  [FLAG_UPGRADE_PROMPT_STYLE]: "modal",
  [FLAG_REFERRAL_MESSAGING]: "earn-rewards",
  [FLAG_NEW_AI_FEATURES]: false,
  [FLAG_COLLABORATION_V2]: true,
  [FLAG_SESSION_REPLAY]: false,
  [FLAG_ENHANCED_ANALYTICS]: true,
  [FLAG_PREMIUM_TEMPLATES]: false,
  [FLAG_ENHANCED_BOOKING]: false, // Start disabled, enable via PostHog
  [FLAG_WIZARD_UX_V2]: false,
  [FLAG_WIZARD_PERF_V2]: false,
  [FLAG_LISTICLE_CTA_V1]: false,
  [FLAG_AUTO_SAVE_V1]: false,
  [FLAG_AUTH_WALL_VARIANT]: "magic-link-primary",
  [FLAG_CONCIERGE_SURFACE]: "always",
  [FLAG_EXPLORE_ANON_ENGAGEMENT]: "auth-gated",
  [FLAG_WIZARD_LAYOUT]: "two-step",
  [FLAG_FRONT_DOOR]: "wizard",
};

/**
 * Get default value for a flag
 */
export function getDefaultFlagValue(flagKey: string): boolean | string {
  return FLAG_DEFAULTS[flagKey] ?? false;
}
