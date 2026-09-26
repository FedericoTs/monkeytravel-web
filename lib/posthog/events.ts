"use client";

/**
 * Type-safe PostHog event definitions
 *
 * Each event has:
 * - Specific property types
 * - Documentation for tracking purpose
 * - Alignment with GA4 events where applicable
 *
 * posthog-js is loaded through `getPosthog()`, not a top-level import: many
 * components import these helpers, and a static import would pull the whole
 * SDK into the shared chunk of every route they touch. The SDK is initialized
 * once, on idle, in `instrumentation-client.ts`, which also applies the
 * consent choice (these helpers never check consent); the dynamic import
 * resolves to that same instance.
 *
 * Every capture is fire-and-forget. An event fired before the SDK initializes
 * is dropped; most fire from user interactions, well after the idle init.
 */

const getPosthog = () => import("posthog-js").then((m) => m.default);

// `unknown` for the props arg so we accept any typed event shape without
// requiring every event interface to declare an index signature. PostHog's
// own .capture() accepts any object; we cast at the boundary.
type WindowPosthog = {
  capture: (event: string, props?: unknown) => void;
};

/**
 * Sync handle to the initialized PostHog client (`window.posthog`, set by
 * `instrumentation-client.ts` at init), or `null` before init and on the
 * server. The async `getPosthog()` import can lose to a navigation and drop
 * the event; capturing through this handle queues it at once, and PostHog's
 * unload flush (sendBeacon) carries it across the page change.
 */
function getPosthogSync(): WindowPosthog | null {
  if (typeof window === "undefined") return null;
  const ph = (window as typeof window & { posthog?: WindowPosthog }).posthog;
  if (!ph || typeof ph.capture !== "function") return null;
  return ph;
}

/**
 * Fire-and-forget capture for events that race a navigation: the sync handle
 * when the SDK is ready, else the async path. Client-only; on the server it
 * falls to the async path, which captures nothing there.
 * Generic over the event shape so callers keep their typed interface; props
 * widen to `unknown` only at the SDK boundary.
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
   * Callers send only `email` and `google`: app/auth/callback/route.ts tags
   * every OAuth arrival signup_google, which AuthEventTracker reports as
   * `google`, Apple included. A new method needs its own auth_event there
   * and a branch in AuthEventTracker.
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
  /** Arm of the retired share-modal-timing-exp; callers always send "control". */
  experiment_variant?: "control" | "delayed-2s" | "delayed-5s";
  /** Delay in milliseconds before modal was shown */
  delay_ms?: number;
}

export interface SharePromptActionEvent {
  trip_id: string;
  /**
   * `publish` is the share prompt's Publish-to-Explore option. It rides the
   * share_prompt funnel so collaboration and publish intent compare in one
   * chart.
   */
  action: "invite" | "skip" | "later" | "publish";
  /** Arm of the retired share-modal-timing-exp; callers always send "control". */
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
  /** Step 1 only: were the dates chosen, or the pencilled flexible default? */
  dates_mode?: "exact" | "flexible";
  /** Step 1 only: did a popular-pick one-tap fill the destination? */
  one_tap?: boolean;
}

export interface TripWizardAbandonedEvent {
  last_step_completed: number;
  last_step_name: string;
  /** Total time in wizard in seconds */
  total_time_seconds: number;
  /**
   * The field the user touched immediately before abandoning. Lets us
   * distinguish "didn't engage at all" from "stuck on the date picker"
   * from "filled everything but didn't submit". Values match
   * `TripWizardFieldInteractedEvent.field`.
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
 * Who the trip is planned for: the solo/group toggle on wizard step 1,
 * "unspecified" until the user picks. Saved trips keep it in
 * trip_meta.trip_intent, which shapes the share prompt.
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
  /** The solo/group toggle answer; "unspecified" when the user did not pick. */
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
  /** Same as TripGenerationStartedEvent.trip_intent. */
  trip_intent?: TripIntent;
}

// ============================================================================
// AHA MOMENT & RETENTION EVENTS
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
  /** Minutes from signup to this save; the wizard always sends 0 (it has no signup time). */
  time_to_value_minutes: number;
  /** Was this from a template */
  from_template: boolean;
  /**
   * Did this trip carry user-declared fixed commitments (anchors)? Lets the
   * funnel compare save rates of anchored and generic plans.
   */
  is_anchored?: boolean;
  anchor_count?: number;
}

export interface ActivityModifiedEvent {
  trip_id: string;
  activity_id: string;
  /** Type of modification */
  modification_type: "reorder" | "delete" | "add" | "edit_details" | "regenerate" | "move_day";
  /** Is this the user's first modification ever */
  is_first_modification: boolean;
  /** Day number in the trip (the destination day for move_day) */
  day_number: number;
  /** move_day only: dragged across days, or picked in the "Move to day" sheet */
  method?: "drag" | "menu";
  /** move_day only: the day the activity came from */
  from_day_number?: number;
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
   * Where the editing assistant is mounted: `trip_detail` is the saved-trip
   * page agent, `wizard_anon` the anonymous pre-save panel (no caller sends
   * it).
   */
  surface?: "trip_detail" | "wizard_anon";
  /**
   * Did the assistant apply a change to the itinerary this turn? That is the
   * value moment: a message that edited the plan, not one that only chatted.
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
 * Capture referral conversion
 */
export async function captureReferralConverted(event: ReferralConvertedEvent) {
  const ph = await getPosthog();
  ph.capture("referral_converted", event);
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

// ============================================================================
// ACTIVATION FUNNEL CAPTURE FUNCTIONS
// ============================================================================

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

// ── Step-1 entry ─────────────────────────────────────────────────────────────
// Sliced by the wizard_entry super-property NewTripWizard registers, so no
// call here passes the entry state itself.

/** A popular pick set the destination (and, when no dates existed, pencilled flexible dates). */
export interface WizardOneTapStartEvent {
  destination: string;
  in_season: boolean;
  dates_autofilled: boolean;
  first_run: boolean;
  /** 0-based position in the six-chip grid. */
  position: number;
}

export async function captureWizardOneTapStart(event: WizardOneTapStartEvent) {
  const ph = await getPosthog();
  ph.capture("wizard_one_tap_start", event);
}

/** A brand-new account landed on step 1 (latched ?auth_event=signup_email|signup_google). */
export interface WizardFirstRunViewedEvent {
  auth_event: string;
}

export async function captureWizardFirstRunViewed(event: WizardFirstRunViewedEvent) {
  const ph = await getPosthog();
  ph.capture("wizard_first_run_viewed", event);
}

/** The "Your trip came with you" banner — surfaced once, then what the person did with it. */
export interface ClaimedTripBannerEvent {
  action: "surfaced" | "opened" | "plan_another" | "dismissed";
  trip_id: string;
}

export async function captureClaimedTripBanner(event: ClaimedTripBannerEvent) {
  const ph = await getPosthog();
  ph.capture("claimed_trip_banner", event);
}

export interface AnonShareKeepClickedEvent {
  destination?: string;
  duration_days?: number;
}

/** "Keep this trip" beside a freshly minted signed-out share link. */
export async function captureAnonShareKeepClicked(event: AnonShareKeepClickedEvent) {
  const ph = await getPosthog();
  ph.capture("anon_share_keep_clicked", event);
}

export interface PendingClaimBannerEvent {
  action: "surfaced" | "keep" | "open_link" | "dismissed";
  destination?: string;
  trip_id?: string;
}

/** Return-visit reminder for a browser still holding an unclaimed shared trip. */
export async function capturePendingClaimBanner(event: PendingClaimBannerEvent) {
  const ph = await getPosthog();
  ph.capture("pending_claim_banner", event);
}

export async function captureAutoSaveSkipped(event: AutoSaveSkippedEvent) {
  const ph = await getPosthog();
  ph.capture("auto_save_skipped", event);
}

export async function captureTripGenerationStarted(event: TripGenerationStartedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_generation_started", event);
}

/**
 * Fires when the user picks "Just me" or "With friends" on wizard step 1.
 * Read it as distinct users per intent, then the share rate of "group"
 * pickers after generation.
 */
export async function captureTripIntentSelected(event: TripIntentSelectedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_intent_selected", event);
}

/**
 * Which copy branch the share prompt rendered, and where. The copy branches
 * on trip_intent, so recording the branch ties each outcome to the ask that
 * produced it.
 */
export async function captureSharePromptVariantShown(event: {
  trip_id: string;
  intent: "solo" | "group" | "unspecified";
  surface: "trip_detail" | "post_save";
}) {
  const ph = await getPosthog();
  ph.capture("share_prompt_variant_shown", event);
}

/**
 * Fires when the user puts a share link somewhere: the clipboard or a
 * completed native share sheet. Minting is a separate act, recorded as
 * share_prompt_action { action: 'invite' }; this event is the send.
 */
export async function captureShareLinkCopied(event: {
  trip_id: string;
  method: "copy" | "native_share";
}) {
  const ph = await getPosthog();
  ph.capture("share_link_copied", event);
}

export async function captureTripGenerationCompleted(event: TripGenerationCompletedEvent) {
  const ph = await getPosthog();
  ph.capture("trip_generation_completed", event);
}

// ============================================================================
// AHA MOMENT & RETENTION CAPTURE FUNCTIONS
// ============================================================================

/**
 * Despite the name, fires once for every trip the wizard saves, not only a
 * user's first. The manual save calls router.push to /trips/[id] right after,
 * so this takes the nav-safe path: the async import would lose to the route
 * change.
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
 * Untyped escape hatch: any event name with any properties. Prefer a typed
 * helper above.
 */
export async function capture(eventName: string, properties?: Record<string, unknown>) {
  const ph = await getPosthog();
  ph.capture(eventName, properties);
}

// ============================================================================
// AUTH-WALL FUNNEL EVENTS
// ============================================================================

/**
 * Where the AuthPromptModal opened. Intent differs by trigger (a wizard save
 * is the highest-intent path, explore triggers are lower), so each location
 * gets its own funnel.
 */
export type AuthPromptLocation =
  | "wizard_save"
  | "anon_share_keep"
  | "pending_claim"
  | "explore_like"
  | "explore_fork"
  | "shared_vote"
  | "shared_save"
  | "invite_accept"
  | "publish_trip"
  | "concierge_quota"
  // The anonymous free-generation cap, reached from the wizard (the stream
  // and its JSON fallback both enforce it).
  | "wizard_generation_limit"
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
  /** The plain lowercased domain (e.g. "gmail.com"), never the address itself. */
  email_domain?: string;
}

export interface MagicLinkRequestFailedEvent {
  location: AuthPromptLocation;
  /** The error message cut to 80 characters, or "unknown". */
  reason: string;
}

export interface AuthMethodSwitchedEvent {
  location: AuthPromptLocation;
  /** From the magic-link entry, which alternate method did they take? */
  to: "password_signup" | "password_login" | "google";
}

export interface AuthPromptDismissedEvent {
  location: AuthPromptLocation;
  /** Did the user type any email before bailing? */
  had_email_entered: boolean;
}

// Auth-wall captures race a router.push or window.location change, so they
// take the nav-safe path: the event lands in the SDK queue before navigation
// can abort the async getPosthog() import.
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
// WIZARD-SAVE EVENTS
//
// save_blocked_anon and save_failed are also written to the Supabase
// `wizard_step_events` table for the database funnel; PostHog gets them for
// its own funnel charts.
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
  /** Which path failed: the silent auto-save, or a Save click. */
  arm?: "auto" | "manual";
  /** Auto-save only: how many attempts were made before giving up. */
  attempts?: number;
}

/**
 * Auto-save did NOT run for a rendered itinerary; reported once per itinerary
 * so a lost signed-in generation still leaves an event. `not_authenticated`:
 * anonymous. `disabled`: the env kill switch. `auth_pending`: auth unresolved
 * when the result landed. `pending_claim`: the itinerary is an anonymous
 * shared trip whose claim has not resolved.
 */
export interface AutoSaveSkippedEvent {
  reason: "not_authenticated" | "disabled" | "auth_pending" | "pending_claim";
  destination?: string;
}

// Save-funnel captures race what follows them (the auth modal and its
// redirects, or the user leaving after an error), so they take the nav-safe
// path.
export function captureSaveBlockedAnon(event: SaveBlockedAnonEvent) {
  captureNavSafe("save_blocked_anon", event);
}

export function captureSaveFailed(event: SaveFailedEvent) {
  captureNavSafe("save_failed", event);
}

/**
 * Fires on pagehide when the user leaves the result view with an UNSAVED
 * generated itinerary. trip_wizard_abandoned cannot cover this exit: its
 * listener is disarmed once generation starts. PostHog only, NOT mirrored
 * into wizard_step_events.
 */
export interface ResultExitUnsavedEvent {
  /** mt_gen_count — generations attempted this browser session. */
  gen_count: number;
  /** Did the user apply at least one anon-assistant edit this session? */
  edits_applied: boolean;
}

// Fired from a pagehide handler, so it must take the sync nav-safe path: the
// async dynamic import always loses to a page teardown.
export function captureResultExitUnsaved(event: ResultExitUnsavedEvent) {
  captureNavSafe("result_exit_unsaved", event);
}

// ============================================================================
// CONCIERGE EVENTS
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

// Concierge edit proposals: the shown → applied rate is the success metric.
interface ConciergeProposalShownEvent {
  trip_id: string;
  proposal_type: string;
  day_number: number;
}

interface ConciergeProposalAppliedEvent {
  trip_id: string;
  proposal_type: string;
  day_number: number;
}

export async function captureConciergeProposalShown(
  event: ConciergeProposalShownEvent
) {
  const ph = await getPosthog();
  ph.capture("concierge_proposal_shown", event);
}

export async function captureConciergeProposalApplied(
  event: ConciergeProposalAppliedEvent
) {
  const ph = await getPosthog();
  ph.capture("concierge_proposal_applied", event);
}

export async function captureConciergeError(event: ConciergeErrorEvent) {
  const ph = await getPosthog();
  ph.capture("concierge_error", event);
}

// ============================================================================
// EXPENSE LEDGER EVENTS
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

// ============================================================================
// /EXPLORE ENGAGEMENT EVENTS
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
  /** Anon saves are stored against a browser cookie, signed-in saves against the account. */
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

export async function captureExploreTripPublished(event: ExploreTripPublishedEvent) {
  const ph = await getPosthog();
  ph.capture("explore_trip_published", event);
}

export async function captureExploreTripPublishFailed(event: ExploreTripPublishFailedEvent) {
  const ph = await getPosthog();
  ph.capture("explore_trip_publish_failed", event);
}

// ============================================================================
// MANUAL EDITOR EVENTS
// ============================================================================
//
// Enter / save / discard for the manual drag-and-drop editor, so its adoption
// can be compared with `ai_assistant_used` in the same funnel.

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

// ============================================================================
// ANCHOR EVENTS (constraint-aware planning)
// ----------------------------------------------------------------------------
// Test whether a plan built around the user's fixed commitments gets saved
// more often than a generic one:
//   anchor_panel_opened          → does anyone find the collapsed CTA?
//   anchors_generated            → of those, who generates with anchors?
//   first_trip_saved.is_anchored → do anchored trips save more often?
// Opened and generated stay separate: many opens with few generations means
// the panel confuses; few opens means people can't find it.
// ============================================================================

export interface AnchorPanelOpenedEvent {
  /** Anchors already present when opened (>0 = returning to edit). */
  existing_count: number;
}

export interface AnchorsGeneratedEvent {
  anchor_count: number;
  /** Distinct anchor types used, e.g. ["transport","event","lodging"]. */
  anchor_types: string[];
  /** Whole-day locks — how constrained the trip is. */
  all_day_count: number;
  /** Anchors that pin where a night ends (the hardest constraint). */
  lodging_count: number;
  trip_days: number;
}

/** Fired when the collapsed "I have fixed plans" panel is expanded. */
export async function captureAnchorPanelOpened(event: AnchorPanelOpenedEvent) {
  const ph = await getPosthog();
  ph.capture("anchor_panel_opened", event);
}

/**
 * Fired at Generate when the request carries anchors. Nav-safe because
 * generation swaps the view at once and can navigate, a race the async
 * import loses.
 */
export function captureAnchorsGenerated(event: AnchorsGeneratedEvent) {
  captureNavSafe("anchors_generated", event);
}

export interface RefineSuggestionClickedEvent {
  /**
   * A derived chip's RefineSuggestion key (lib/trip/refine-suggestions.ts),
   * else "static1".."static3".
   */
  source: string;
  /** True when the chips were derived from this itinerary rather than static. */
  derived: boolean;
}

/**
 * Fired when a result-page assistant chip is tapped. `derived` splits taps by
 * whether the chip described THIS trip, to tell whether specificity earns the
 * tap or whether chips are not a lever at all.
 */
export async function captureRefineSuggestionClicked(event: RefineSuggestionClickedEvent) {
  const ph = await getPosthog();
  ph.capture("refine_suggestion_clicked", event);
}

export interface PlanImportedEvent {
  /** Size of the paste — separates one-liners from real itineraries. */
  text_length: number;
  /** Anchors that actually landed on screen. */
  anchor_count: number;
  /** Items the extractor or the merge refused. High = extraction is weak. */
  dropped_count: number;
  /** Undated items routed to the requirements box instead. */
  undated_count: number;
}

/**
 * Fired after a successful paste-a-plan import. Stays async — the panel
 * doesn't navigate, so there's no race to lose. A high dropped_count relative
 * to anchor_count is the signal that the extraction prompt needs work.
 */
export async function capturePlanImported(event: PlanImportedEvent) {
  const ph = await getPosthog();
  ph.capture("plan_imported", event);
}

/**
 * The assistant told the user it changed their plan, and the server did not
 * confirm a write. The model's own claim is not evidence, so this rate is the
 * honest measure of whether the agent does what it says. Drive it toward zero
 * by widening intent coverage, not by hiding the message.
 */
export async function captureAssistantClaimUnverified(props: {
  trip_id: string;
  action_type: string;
}) {
  return capture("assistant_claim_unverified", props);
}

// ============================================================================
// ANONYMOUS SHARE LOOP (hop one)
// ============================================================================

/**
 * These fire client-side on purpose: the share rate of anonymous result-viewers
 * needs them on the same person as `itinerary_generated` and `save_nudge_shown`.
 * A server-side capture from /api/trips/anonymous has no reliable distinct_id
 * for a signed-out visitor, so it would land unjoined. Click, mint, failure and
 * copy are separate events because minting a link is not sharing it.
 */
// A `type` rather than an `interface` on purpose: capture() takes
// Record<string, unknown>, and TypeScript treats an interface as having no
// implicit index signature, so an interface here fails to assign.
export type AnonShareEvent = {
  /** Absent on the click event — the row does not exist yet. */
  trip_id?: string;
  destination: string;
  duration_days: number;
};

/** Intent: the signed-out planner pressed Share. Denominator for mint rate. */
export async function captureAnonShareClicked(event: AnonShareEvent) {
  return capture("anon_share_clicked", event);
}

/** The ownerless row and its share_token exist. */
export async function captureAnonShareCreated(event: AnonShareEvent) {
  return capture("anon_share_created", event);
}

/**
 * The mint failed. Its own event rather than a property, so the failure rate
 * is directly visible: a broken route otherwise leaves every dashboard silent.
 */
export async function captureAnonShareFailed(event: AnonShareEvent & { reason: string }) {
  return capture("anon_share_failed", event);
}

/**
 * The link actually left the page — copied to the clipboard. This is the only
 * event in the set that represents distribution; the rest are intent.
 */
export async function captureAnonShareCopied(
  event: AnonShareEvent & { trigger: "auto" | "manual" }
) {
  return capture("anon_share_copied", event);
}
