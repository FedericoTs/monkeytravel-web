"use client";

/**
 * Type-safe PostHog event definitions
 *
 * Each event has:
 * - Specific property types
 * - Documentation for tracking purpose
 * - Alignment with GA4 events where applicable
 *
 * BUNDLE NOTE (perf task #179, 2026-05-29): posthog-js is lazy-loaded via
 * `getPosthog()` instead of a top-level import. Many components import the
 * `captureXxx` helpers below (booking surfaces, wizard, content tracker,
 * referral client), and a static import here would drag the full ~120 KB
 * posthog-js SDK into the shared chunk of every route those components
 * touch. SDK init still happens once in `instrumentation-client.ts`; this
 * file just needs the same module instance to call `.capture()` on, which
 * `import('posthog-js')` resolves to the already-loaded copy after the
 * idle-callback init fires.
 *
 * Each capture function is fire-and-forget: callers can either `await` it
 * or ignore the returned promise — events that race ahead of the SDK init
 * are dropped silently (matches prior behavior when posthog wasn't loaded
 * yet) but most call sites fire from user interactions that happen well
 * after the idle-callback bootstrap.
 */

const getPosthog = () => import("posthog-js").then((m) => m.default);

// ============================================================================
// CONTENT TRACKING EVENTS
// ============================================================================

export interface ContentViewedEvent {
  content_type: string;
  content_id: string;
  content_group: string;
  [key: string]: unknown;
}

export interface ContentInteractionEvent {
  action: string;
  content_group: string;
  [key: string]: unknown;
}

// ============================================================================
// CONVERSION EVENTS
// ============================================================================

export interface TripCreatedEvent {
  trip_id: string;
  destination: string;
  duration_days: number;
  budget_tier: "budget" | "balanced" | "premium";
  is_from_template?: boolean;
  /** Monetary value for revenue tracking */
  value?: number;
}

export interface UserSignedUpEvent {
  method: "email" | "google";
  referral_code?: string;
  from_onboarding?: boolean;
}

export interface UserLoggedInEvent {
  method: "email" | "google";
}

export interface ItineraryGeneratedEvent {
  destination: string;
  duration_days: number;
  budget_tier: string;
  generation_time_ms: number;
}

// ============================================================================
// GROWTH & VIRALITY EVENTS
// ============================================================================

export interface SharePromptShownEvent {
  trip_id: string;
  trip_destination: string;
  trip_days: number;
  location: "post_save" | "trip_detail" | "share_button";
  /** A/B test variant (for share-modal-timing-exp) */
  experiment_variant?: "control" | "delayed-2s" | "delayed-5s";
  /** Delay in milliseconds before modal was shown */
  delay_ms?: number;
}

export interface SharePromptActionEvent {
  trip_id: string;
  /**
   * "publish" added 2026-05-28 for the post-save Publish-to-Explore CTA.
   * Surfaces in the same share_prompt funnel so we can A/B compare
   * collaboration intent vs publish intent in the same chart.
   */
  action: "invite" | "skip" | "later" | "publish";
  /** A/B test variant (for share-modal-timing-exp) */
  experiment_variant?: "control" | "delayed-2s" | "delayed-5s";
}

export interface TripSharedEvent {
  trip_id: string;
  method: "link" | "whatsapp" | "twitter" | "facebook" | "email" | "qr";
}

export interface ReferralConvertedEvent {
  referral_code: string;
  reward_amount: number;
  referrer_id: string;
  referee_id: string;
}

// ============================================================================
// MONETIZATION EVENTS
// ============================================================================

export interface LimitReachedEvent {
  limit_type: "generation" | "regeneration" | "assistant";
  current_usage: number;
  limit: number;
  utilization_percent: number;
}

export interface UpgradePromptShownEvent {
  trigger: "limit_reached" | "feature_gate" | "trial_ending" | "upsell";
  limit_type?: string;
  location: string;
}

export interface UpgradePromptActionEvent {
  trigger: string;
  action: "clicked" | "dismissed" | "later";
}

export interface TrialStartedEvent {
  trial_days: number;
}

export interface SubscriptionStartedEvent {
  plan: "pro" | "premium";
  billing_period: "monthly" | "annual";
  value: number;
}

// ============================================================================
// ONBOARDING EVENTS
// ============================================================================

export interface OnboardingStepViewedEvent {
  step_number: number;
  step_name: string;
}

export interface OnboardingStepCompletedEvent {
  step_number: number;
  step_name: string;
  selections_count: number;
  selections?: string[];
}

export interface OnboardingCompletedEvent {
  total_steps: number;
  was_skipped: boolean;
  travel_styles_count: number;
  dietary_count: number;
  accessibility_count: number;
}

// ============================================================================
// ACTIVATION FUNNEL EVENTS
// ============================================================================

export interface WelcomePageViewedEvent {
  has_beta_access: boolean;
  has_completed_onboarding: boolean;
}

export interface WelcomeCompletedEvent {
  action: "continue" | "skip" | "beta_code_entered";
  has_beta_code: boolean;
}

export interface TripWizardStepViewedEvent {
  step_number: number;
  step_name: "destination" | "dates" | "vibes" | "preferences" | "destination_dates" | "vibes_preferences";
}

export interface TripWizardStepCompletedEvent {
  step_number: number;
  step_name: "destination" | "dates" | "vibes" | "preferences" | "destination_dates" | "vibes_preferences";
  /** Time spent on this step in seconds */
  time_on_step_seconds?: number;
}

export interface TripWizardAbandonedEvent {
  last_step_completed: number;
  last_step_name: string;
  /** Total time in wizard in seconds */
  total_time_seconds: number;
  /**
   * The field the user touched immediately before abandoning. Lets us
   * distinguish "didn't engage at all" from "stuck on the date picker"
   * from "filled everything but didn't submit". Values match the
   * `wizard_field_interacted.field` taxonomy.
   */
  last_touched_field?:
    | "destination_autocomplete"
    | "destination_pill"
    | "start_date"
    | "end_date"
    | "vibe"
    | "budget"
    | "pace"
    | "requirements"
    | null;
  /** Did they put something in the destination field by the time they left? */
  had_destination?: boolean;
  /** Did they pick both start AND end date? */
  had_dates?: boolean;
  /** Did they pick at least one vibe? */
  had_vibes?: boolean;
}

export interface TripWizardFieldInteractedEvent {
  step_number: number;
  step_name: string;
  field:
    | "destination_autocomplete"
    | "destination_pill"
    | "start_date"
    | "end_date"
    | "vibe"
    | "budget"
    | "pace"
    | "requirements";
  /** First time this field was touched in this step session, or a follow-up? */
  first_touch: boolean;
}

/**
 * Who is the trip being planned for/with. Captured on wizard step 1 by
 * the solo/group toggle (added 2026-05-24 as a measurement experiment —
 * see docs/COLLAB_AUDIT.md "Phase 1: validate the bet"). No flow change
 * yet; pure signal to decide whether to invest in a full group-first
 * restructure.
 */
export type TripIntent = "solo" | "group" | "unspecified";

export interface TripIntentSelectedEvent {
  intent: TripIntent;
  /** True if the user changed their intent (vs first-time selection). */
  changed: boolean;
}

export interface TripGenerationStartedEvent {
  destination: string;
  duration_days: number;
  budget_tier: string;
  /** Optional — present when the user interacted with the solo/group toggle. */
  trip_intent?: TripIntent;
}

export interface TripGenerationCompletedEvent {
  destination: string;
  duration_days: number;
  budget_tier: string;
  /** Generation time in seconds */
  generation_time_seconds: number;
  success: boolean;
  error_type?: string;
  /** Optional — same as TripGenerationStartedEvent.trip_intent. */
  trip_intent?: TripIntent;
}

// ============================================================================
// AHA MOMENT & RETENTION EVENTS (Sean Ellis Framework)
// ============================================================================

export interface AhaMomentReachedEvent {
  /** Which aha moment was reached */
  moment_type: "first_trip_saved" | "first_activity_modified" | "first_share" | "first_collaboration";
  /** Time from signup to aha moment in hours */
  time_to_aha_hours: number;
  /** User's trip count at this moment */
  trips_count: number;
  /** Whether this happened in first session */
  is_first_session: boolean;
}

export interface RetentionCheckpointEvent {
  /** Days since signup */
  days_since_signup: number;
  /** Checkpoint type */
  checkpoint: "d1" | "d3" | "d7" | "d14" | "d30";
  /** Total trips created */
  trips_count: number;
  /** Total activities modified */
  activities_modified_count: number;
  /** Has shared a trip */
  has_shared: boolean;
  /** Has collaborated */
  has_collaborated: boolean;
}

export interface FirstTripSavedEvent {
  trip_id: string;
  destination: string;
  duration_days: number;
  /** Time from signup to first trip save in minutes */
  time_to_value_minutes: number;
  /** Was this from a template */
  from_template: boolean;
}

export interface ActivityModifiedEvent {
  trip_id: string;
  activity_id: string;
  /** Type of modification */
  modification_type: "reorder" | "delete" | "add" | "edit_details" | "regenerate";
  /** Is this the user's first modification ever */
  is_first_modification: boolean;
  /** Day number in the trip */
  day_number: number;
}

export interface ReturnVisitEvent {
  /** Days since last visit */
  days_since_last_visit: number;
  /** Total visit count */
  visit_count: number;
  /** Did user have incomplete trip */
  has_incomplete_trip: boolean;
}

// ============================================================================
// ENGAGEMENT EVENTS
// ============================================================================

export interface ActivityCompletedEvent {
  trip_id: string;
  activity_id: string;
  day_number: number;
  xp_earned: number;
}

export interface AIAssistantUsedEvent {
  trip_id?: string;
  message_length: number;
}

export interface FeatureFlagExposedEvent {
  flag_key: string;
  variant: string | boolean;
}

// ============================================================================
// EVENT CAPTURE FUNCTIONS
// ============================================================================

/**
 * Capture a trip creation event
 */
export async function captureTripCreated(event: TripCreatedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_created", event);
}

/**
 * Capture a trip-updated event — fires when an auto-saved trip is
 * UPDATEd in place (e.g. user clicks Regenerate after auto-save).
 * Distinct from trip_created so funnel analysis can tell whether
 * a user came back to refine vs. created from scratch.
 */
export async function captureTripUpdated(event: TripCreatedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_updated", event);
}

/**
 * Capture user signup
 */
export async function captureUserSignedUp(event: UserSignedUpEvent) {
  const ph = await getPosthog();
  ph.capture("user_signed_up", event);
}

/**
 * Capture user login
 */
export async function captureUserLoggedIn(event: UserLoggedInEvent) {
  const ph = await getPosthog();
  ph.capture("user_logged_in", event);
}

/**
 * Capture itinerary generation
 */
export async function captureItineraryGenerated(event: ItineraryGeneratedEvent) {
  const ph = await getPosthog();
  ph.capture("itinerary_generated", event);
}

/**
 * Capture share prompt shown
 */
export async function captureSharePromptShown(event: SharePromptShownEvent) {
  const ph = await getPosthog();
  ph.capture("share_prompt_shown", event);
}

/**
 * Capture share prompt action
 */
export async function captureSharePromptAction(event: SharePromptActionEvent) {
  const ph = await getPosthog();
  ph.capture("share_prompt_action", event);
}

/**
 * Capture trip shared
 */
export async function captureTripShared(event: TripSharedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_shared", event);
}

/**
 * Capture referral conversion
 */
export async function captureReferralConverted(event: ReferralConvertedEvent) {
  const ph = await getPosthog();
  ph.capture("referral_converted", event);
}

/**
 * Capture limit reached
 */
export async function captureLimitReached(event: LimitReachedEvent) {
  const ph = await getPosthog();
  ph.capture("limit_reached", event);
}

/**
 * Capture upgrade prompt shown
 */
export async function captureUpgradePromptShown(event: UpgradePromptShownEvent) {
  const ph = await getPosthog();
  ph.capture("upgrade_prompt_shown", event);
}

/**
 * Capture upgrade prompt action
 */
export async function captureUpgradePromptAction(event: UpgradePromptActionEvent) {
  const ph = await getPosthog();
  ph.capture("upgrade_prompt_action", event);
}

/**
 * Capture trial started
 */
export async function captureTrialStarted(event: TrialStartedEvent) {
  const ph = await getPosthog();
  ph.capture("trial_started", event);
}

/**
 * Capture subscription started
 */
export async function captureSubscriptionStarted(event: SubscriptionStartedEvent) {
  const ph = await getPosthog();
  ph.capture("subscription_started", event);
}

/**
 * Capture onboarding step viewed
 */
export async function captureOnboardingStepViewed(event: OnboardingStepViewedEvent) {
  const ph = await getPosthog();
  ph.capture("onboarding_step_viewed", event);
}

/**
 * Capture onboarding step completed
 */
export async function captureOnboardingStepCompleted(event: OnboardingStepCompletedEvent) {
  const ph = await getPosthog();
  ph.capture("onboarding_step_completed", event);
}

/**
 * Capture onboarding completed
 */
export async function captureOnboardingCompleted(event: OnboardingCompletedEvent) {
  const ph = await getPosthog();
  ph.capture("onboarding_completed", event);
}

/**
 * Capture activity completed
 */
export async function captureActivityCompleted(event: ActivityCompletedEvent) {
  const ph = await getPosthog();
  ph.capture("activity_completed", event);
}

/**
 * Capture AI assistant usage
 */
export async function captureAIAssistantUsed(event: AIAssistantUsedEvent) {
  const ph = await getPosthog();
  ph.capture("ai_assistant_used", event);
}

// ============================================================================
// CONTENT TRACKING CAPTURE FUNCTIONS
// ============================================================================

/**
 * Capture a semantic content view (blog post, destination, index page)
 */
export async function captureContentViewed(event: ContentViewedEvent) {
  const ph = await getPosthog();
  ph.capture("content_viewed", event);
}

/**
 * Capture a content interaction (filter, paginate, scroll milestone)
 */
export async function captureContentInteraction(event: ContentInteractionEvent) {
  const ph = await getPosthog();
  ph.capture("content_interaction", event);
}

// ============================================================================
// ACTIVATION FUNNEL CAPTURE FUNCTIONS
// ============================================================================

export async function captureWelcomePageViewed(event: WelcomePageViewedEvent) {
  const ph = await getPosthog();
  ph.capture("welcome_page_viewed", event);
}

export async function captureWelcomeCompleted(event: WelcomeCompletedEvent) {
  const ph = await getPosthog();
  ph.capture("welcome_completed", event);
}

export async function captureTripWizardStepViewed(event: TripWizardStepViewedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_wizard_step_viewed", event);
}

export async function captureTripWizardStepCompleted(event: TripWizardStepCompletedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_wizard_step_completed", event);
}

export async function captureTripWizardAbandoned(event: TripWizardAbandonedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_wizard_abandoned", event);
}

export async function captureTripWizardFieldInteracted(event: TripWizardFieldInteractedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_wizard_field_interacted", event);
}

export async function captureTripGenerationStarted(event: TripGenerationStartedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_generation_started", event);
}

/**
 * Fires when the user picks "Just me" or "With friends" on wizard step 1.
 * Drives the Phase-1 measurement that gates the full group-first
 * restructure. PostHog funnel: count distinct users per intent value,
 * then check what % of "group" pickers actually share the trip after
 * generation.
 */
export async function captureTripIntentSelected(event: TripIntentSelectedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_intent_selected", event);
}

export async function captureTripGenerationCompleted(event: TripGenerationCompletedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_generation_completed", event);
}

// ============================================================================
// AHA MOMENT & RETENTION CAPTURE FUNCTIONS
// ============================================================================

/**
 * Capture when user reaches an aha moment
 * Key for understanding what drives retention
 */
export async function captureAhaMomentReached(event: AhaMomentReachedEvent) {
  const ph = await getPosthog();
  ph.capture("aha_moment_reached", event);
}

/**
 * Capture retention checkpoint (D1, D7, D30)
 * Used for cohort analysis
 */
export async function captureRetentionCheckpoint(event: RetentionCheckpointEvent) {
  const ph = await getPosthog();
  ph.capture("retention_checkpoint", event);
}

/**
 * Capture first trip saved (critical aha moment candidate)
 */
export async function captureFirstTripSaved(event: FirstTripSavedEvent) {
  const ph = await getPosthog();
  ph.capture("first_trip_saved", event);
}

/**
 * Capture activity modification (engagement signal)
 */
export async function captureActivityModified(event: ActivityModifiedEvent) {
  const ph = await getPosthog();
  ph.capture("activity_modified", event);
}

/**
 * Capture return visit (retention signal)
 */
export async function captureReturnVisit(event: ReturnVisitEvent) {
  const ph = await getPosthog();
  ph.capture("return_visit", event);
}

/**
 * Generic event capture with type safety
 */
export async function capture(eventName: string, properties?: Record<string, unknown>) {
  const ph = await getPosthog();
  ph.capture(eventName, properties);
}
