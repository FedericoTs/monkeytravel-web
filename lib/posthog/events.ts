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

/**
 * Sync handle to the already-initialized PostHog client.
 *
 * **Why this exists (2026-06-09):** the async `getPosthog()` helper fires
 * `import("posthog-js")` then `.capture()`. For events that race a
 * navigation (the auth modal opens then redirects, the save flow then
 * pushes to /trips/[id], etc.), the async resolution can lose to the
 * navigation and the event is dropped before the SDK's batch flushes.
 *
 * The daily routine on 2026-06-09 showed exactly this pattern:
 * `save_blocked_anon = 1` in Supabase but `0` in PostHog for the same
 * user session. The Supabase write is a server-side fetch that survives
 * navigation; PostHog's client-side capture didn't.
 *
 * `window.posthog` is populated by `instrumentation-client.ts` right
 * after the consent-gated init. Once init has run (which is by the time
 * any user-interaction handler fires), reading from `window.posthog`
 * gives us a synchronous reference to the same SDK instance — capture
 * fires immediately into the SDK's queue, then PostHog's own
 * `XHR` + `sendBeacon` fallback flushes it across navigation boundaries.
 *
 * Returns `null` before init or on the server. Callers must handle
 * that — the sync path is best-effort, fall through to the async path
 * if the SDK isn't ready yet.
 */
// `unknown` for the props arg so we accept any typed event shape without
// requiring every event interface to declare an index signature. PostHog's
// own .capture() accepts any object; we cast at the boundary.
type WindowPosthog = {
  capture: (event: string, props?: unknown) => void;
};

function getPosthogSync(): WindowPosthog | null {
  if (typeof window === "undefined") return null;
  const ph = (window as typeof window & { posthog?: WindowPosthog }).posthog;
  if (!ph || typeof ph.capture !== "function") return null;
  return ph;
}

/**
 * Fire-and-forget capture that prefers the sync path when the SDK is
 * already initialized. Used by events that race navigation. Falls
 * through to the existing async path if window.posthog isn't ready.
 *
 * Don't use this from server components or route handlers — it's
 * client-only. The sync check short-circuits to the async path
 * (which is itself a no-op on the server) if window is undefined.
 *
 * Generic over the event shape so callers keep their type-safe event
 * interface; we widen to `unknown` only at the SDK boundary.
 */
function captureNavSafe<T>(event: string, props?: T): void {
  const sync = getPosthogSync();
  if (sync) {
    try {
      sync.capture(event, props);
      return;
    } catch (err) {
      // Fall through to async path if the sync call somehow throws.
      console.warn("[posthog] sync capture failed, falling back", err);
    }
  }
  // Best-effort async path. Returns a promise we deliberately drop;
  // the caller already chose fire-and-forget by calling this helper.
  void getPosthog()
    .then((ph) => ph.capture(event, props as Record<string, unknown>))
    .catch(() => {});
}

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
  /**
   * `magic-link` added 2026-06-04 alongside the AuthPromptModal redesign
   * (commit 9350871). `apple` added 2026-06-01 for the iOS Capacitor
   * Sign in with Apple flow (task #268). When extending here, also
   * extend the auth_event router in app/auth/callback/route.ts so
   * OAuth providers fire the correct PostHog event.
   */
  method: "email" | "google" | "apple" | "magic-link";
  referral_code?: string;
  from_onboarding?: boolean;
}

export interface UserLoggedInEvent {
  method: "email" | "google" | "apple" | "magic-link";
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
    | "flexible_dates"
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
    | "requirements"
    | "flexible_dates";
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
  /**
   * Where the editing assistant is mounted. `trip_detail` = the saved-trip
   * page agent (the one users lean on to rearrange/add/remove — see the
   * 2026-07-02 session-recording finding). Lets us split agent usage from
   * the anon pre-save panel in the same event.
   */
  surface?: "trip_detail" | "wizard_anon";
  /**
   * Did the assistant autonomously apply a change to the itinerary this
   * turn? This is the value moment — a message that actually edited the
   * plan, not just chatted. Was previously invisible: `ai_assistant_used`
   * only went to GA4 via trackAIAssistantMessage(), never to PostHog.
   */
  action_applied?: boolean;
  /** The kind of action the assistant returned (add/remove/replace/reorder/...), if any. */
  action_type?: string;
  /** Assistant round-trip latency in ms — lets us measure p50/p95 turn time. */
  response_time_ms?: number;
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
 * Capture first trip saved (critical aha moment candidate).
 *
 * Switched to sync nav-safe path 2026-06-09 — this event fires inside
 * the manual + auto-save handlers, immediately before a router.push
 * to /trips/[id]. The async dynamic-import-then-capture used to lose
 * to the navigation; this lands the event in the SDK queue before
 * the route change.
 */
export function captureFirstTripSaved(event: FirstTripSavedEvent) {
  captureNavSafe("first_trip_saved", event);
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

// ============================================================================
// AUTH-WALL FUNNEL EVENTS (added 2026-06-06 — tracking refresh)
// ============================================================================

/**
 * Where the AuthPromptModal opened. Drives funnel segmentation: the
 * post-result-save trigger is the highest-intent path; nav and explore
 * triggers are lower intent. We want to see them in separate funnels.
 */
export type AuthPromptLocation =
  | "wizard_save"
  | "explore_like"
  | "explore_fork"
  | "shared_vote"
  | "shared_save"
  | "invite_accept"
  | "publish_trip"
  | "concierge_quota"
  | "other";

export interface AuthPromptShownEvent {
  location: AuthPromptLocation;
  /** Trip ID when shown over a trip surface (wizard, explore, shared). */
  trip_id?: string;
  /** Destination if known — for cohort analysis by destination intent. */
  destination?: string;
}

export interface MagicLinkRequestedEvent {
  location: AuthPromptLocation;
  /** Hash of the email domain (e.g. "gmail.com"). Never the address itself. */
  email_domain?: string;
}

export interface MagicLinkRequestFailedEvent {
  location: AuthPromptLocation;
  /** Supabase error code if available, else "unknown". */
  reason: string;
}

export interface AuthMethodSwitchedEvent {
  location: AuthPromptLocation;
  /** From the magic-link entry, which escape hatch did they take? */
  to: "password_signup" | "password_login";
}

export interface AuthPromptDismissedEvent {
  location: AuthPromptLocation;
  /** Did the user type any email before bailing? */
  had_email_entered: boolean;
}

// Auth-wall captures all race a router.push or window.location change.
// Use the sync window.posthog handle so the event lands BEFORE navigation
// has a chance to abort the in-flight async getPosthog() dynamic import.
// See `captureNavSafe` for the rationale (2026-06-09).
export function captureAuthPromptShown(event: AuthPromptShownEvent) {
  captureNavSafe("auth_prompt_shown", event);
}

export function captureMagicLinkRequested(event: MagicLinkRequestedEvent) {
  captureNavSafe("magic_link_requested", event);
}

export function captureMagicLinkRequestFailed(event: MagicLinkRequestFailedEvent) {
  captureNavSafe("magic_link_request_failed", event);
}

export function captureAuthMethodSwitched(event: AuthMethodSwitchedEvent) {
  captureNavSafe("auth_method_switched", event);
}

export function captureAuthPromptDismissed(event: AuthPromptDismissedEvent) {
  captureNavSafe("auth_prompt_dismissed", event);
}

// ============================================================================
// WIZARD-SAVE GAP EVENTS (added 2026-06-06)
//
// The save_blocked_anon + save_failed events are also written to the
// Supabase `wizard_step_events` table for the database funnel, but
// PostHog needs them too so they appear in funnel charts there.
// ============================================================================

export interface SaveBlockedAnonEvent {
  destination?: string;
  group_size?: string;
  backpacker_mode?: boolean;
  /** Was the AuthPromptModal then shown? (false = silent block somehow) */
  modal_shown: boolean;
}

export interface SaveFailedEvent {
  destination?: string;
  group_size?: string;
  backpacker_mode?: boolean;
  /** Top-line error class so we can group failures. */
  error_class: "network" | "rls" | "validation" | "rate_limit" | "unknown";
  /** Truncated error message — never raw PII. */
  error_message?: string;
}

// Save-funnel captures race the modal-open + window.location.assign that
// the save flow triggers immediately after. Sync handle keeps the event
// from being dropped (see 2026-06-09 daily routine — save_blocked_anon
// was hitting Supabase wizard_step_events but never landing in PostHog
// because the async dynamic import lost to navigation).
export function captureSaveBlockedAnon(event: SaveBlockedAnonEvent) {
  captureNavSafe("save_blocked_anon", event);
}

export function captureSaveFailed(event: SaveFailedEvent) {
  captureNavSafe("save_failed", event);
}

// ============================================================================
// CONCIERGE EVENTS (F4, task #242) — added 2026-06-06
// ============================================================================

export interface ConciergeOpenedEvent {
  trip_id: string;
  /** Is the trip's date window active right now? Drives "today" mode. */
  is_live_trip?: boolean;
}

export interface ConciergeQuestionSentEvent {
  trip_id: string;
  question_length: number;
  /** Was the trip in live-trip "today" mode when the question fired? */
  is_live_trip?: boolean;
}

export interface ConciergeResponseReceivedEvent {
  trip_id: string;
  response_time_ms: number;
  is_live_trip: boolean;
  /** Length of the streamed answer (chars). 0 if empty or errored. */
  answer_length: number;
}

export interface ConciergeQuotaBlockedEvent {
  trip_id: string;
}

export interface ConciergeErrorEvent {
  trip_id: string;
  error_type: "network" | "stream_parse" | "quota" | "unknown";
}

export async function captureConciergeOpened(event: ConciergeOpenedEvent) {
  const ph = await getPosthog();
  ph.capture("concierge_opened", event);
}

export async function captureConciergeQuestionSent(event: ConciergeQuestionSentEvent) {
  const ph = await getPosthog();
  ph.capture("concierge_question_sent", event);
}

export async function captureConciergeResponseReceived(event: ConciergeResponseReceivedEvent) {
  const ph = await getPosthog();
  ph.capture("concierge_response_received", event);
}

export async function captureConciergeQuotaBlocked(event: ConciergeQuotaBlockedEvent) {
  const ph = await getPosthog();
  ph.capture("concierge_quota_blocked", event);
}

export async function captureConciergeError(event: ConciergeErrorEvent) {
  const ph = await getPosthog();
  ph.capture("concierge_error", event);
}

// ============================================================================
// EXPENSE LEDGER EVENTS (task #220) — added 2026-06-06
// ============================================================================

export interface ExpenseAddedEvent {
  trip_id: string;
  currency: string;
  category: "transport" | "accommodation" | "food" | "activity" | "shopping" | "other";
  /**
   * Amount in the entry's native currency. We do NOT FX-convert here —
   * the dashboard side does that with a snapshot rate. Keeps the event
   * faithful to what the user actually typed.
   */
  amount: number;
}

export interface ExpenseDeletedEvent {
  trip_id: string;
  was_self: boolean;
}

export interface SettleUpViewedEvent {
  trip_id: string;
  /** How many settlement edges came back. 0 = "nothing to settle". */
  settlement_count: number;
}

export async function captureExpenseAdded(event: ExpenseAddedEvent) {
  const ph = await getPosthog();
  ph.capture("expense_added", event);
}

export async function captureExpenseDeleted(event: ExpenseDeletedEvent) {
  const ph = await getPosthog();
  ph.capture("expense_deleted", event);
}

export async function captureSettleUpViewed(event: SettleUpViewedEvent) {
  const ph = await getPosthog();
  ph.capture("settle_up_viewed", event);
}

// ============================================================================
// /EXPLORE ENGAGEMENT EVENTS (tasks #118/#119) — added 2026-06-06
// ============================================================================

export type ExploreSurface = "explore_feed" | "trip_detail" | "shared" | "saved";

export interface ExploreTripLikedEvent {
  trip_id: string;
  surface: ExploreSurface;
  /** Did the click bounce to auth? (anon user) */
  required_auth: boolean;
}

export interface ExploreTripSavedEvent {
  trip_id: string;
  surface: ExploreSurface;
  /** Anon saves go to a cookie-keyed list; auth saves to DB. */
  was_anon: boolean;
}

export interface ExploreTripForkedEvent {
  trip_id: string;
  surface: ExploreSurface;
  required_auth: boolean;
}

export interface ExploreFilterAppliedEvent {
  /** Which dropdown / chip the user adjusted. */
  filter_type: "destination" | "duration" | "vibe" | "budget" | "sort";
  /** The value they picked, stringified. */
  value: string;
}

export interface ExploreTripPublishedEvent {
  trip_id: string;
  has_author_name: boolean;
  has_author_note: boolean;
}

export interface ExploreTripPublishFailedEvent {
  trip_id: string;
  /** Server's anti-spam guard that rejected (or "network"/"unknown"). */
  reason: string;
}

export async function captureExploreTripLiked(event: ExploreTripLikedEvent) {
  const ph = await getPosthog();
  ph.capture("explore_trip_liked", event);
}

export async function captureExploreTripSaved(event: ExploreTripSavedEvent) {
  const ph = await getPosthog();
  ph.capture("explore_trip_saved", event);
}

export async function captureExploreTripForked(event: ExploreTripForkedEvent) {
  const ph = await getPosthog();
  ph.capture("explore_trip_forked", event);
}

export async function captureExploreFilterApplied(event: ExploreFilterAppliedEvent) {
  const ph = await getPosthog();
  ph.capture("explore_filter_applied", event);
}

export async function captureExploreTripPublished(event: ExploreTripPublishedEvent) {
  const ph = await getPosthog();
  ph.capture("explore_trip_published", event);
}

export async function captureExploreTripPublishFailed(event: ExploreTripPublishFailedEvent) {
  const ph = await getPosthog();
  ph.capture("explore_trip_publish_failed", event);
}

// ============================================================================
// MANUAL EDITOR EVENTS — added 2026-07-02
// ============================================================================
//
// WHY: the 2026-07-02 shared session recording (Taipei trip) showed a user
// making ~all itinerary changes through the AI assistant and touching the
// manual drag-and-drop editor exactly once. But the manual editor emitted NO
// analytics at all — so "is anyone using the editor?" was unanswerable from
// data. These three lifecycle events (enter / save / discard) let us measure
// manual-editor adoption and compare it head-to-head against `ai_assistant_used`
// (now also dual-written to PostHog) in the same funnel.

export interface EditModeEnteredEvent {
  trip_id: string;
  /** Number of days in the itinerary when the user opened the editor. */
  days_count?: number;
}

export interface EditModeSavedEvent {
  trip_id: string;
  days_count?: number;
  /** Total activities across all days at save time. */
  activities_count?: number;
}

export interface EditModeDiscardedEvent {
  trip_id: string;
}

export async function captureEditModeEntered(event: EditModeEnteredEvent) {
  const ph = await getPosthog();
  ph.capture("edit_mode_entered", event);
}

export async function captureEditModeSaved(event: EditModeSavedEvent) {
  const ph = await getPosthog();
  ph.capture("edit_mode_saved", event);
}

export async function captureEditModeDiscarded(event: EditModeDiscardedEvent) {
  const ph = await getPosthog();
  ph.capture("edit_mode_discarded", event);
}
