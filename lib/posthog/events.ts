"use client";

import posthog from "posthog-js";

/**
 * Type-safe PostHog event definitions
 *
 * Each event has:
 * - Specific property types
 * - Documentation for tracking purpose
 * - Alignment with GA4 events where applicable
 */

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
  action: "invite" | "skip" | "later";
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
export function captureTripCreated(event: TripCreatedEvent) {
  posthog.capture("trip_created", event);
}

/**
 * Capture user signup
 */
export function captureUserSignedUp(event: UserSignedUpEvent) {
  posthog.capture("user_signed_up", event);
}

/**
 * Capture user login
 */
export function captureUserLoggedIn(event: UserLoggedInEvent) {
  posthog.capture("user_logged_in", event);
}

/**
 * Capture itinerary generation
 */
export function captureItineraryGenerated(event: ItineraryGeneratedEvent) {
  posthog.capture("itinerary_generated", event);
}

/**
 * Capture share prompt shown
 */
export function captureSharePromptShown(event: SharePromptShownEvent) {
  posthog.capture("share_prompt_shown", event);
}

/**
 * Capture share prompt action
 */
export function captureSharePromptAction(event: SharePromptActionEvent) {
  posthog.capture("share_prompt_action", event);
}

/**
 * Capture trip shared
 */
export function captureTripShared(event: TripSharedEvent) {
  posthog.capture("trip_shared", event);
}

/**
 * Capture referral conversion
 */
export function captureReferralConverted(event: ReferralConvertedEvent) {
  posthog.capture("referral_converted", event);
}

/**
 * Capture limit reached
 */
export function captureLimitReached(event: LimitReachedEvent) {
  posthog.capture("limit_reached", event);
}

/**
 * Capture upgrade prompt shown
 */
export function captureUpgradePromptShown(event: UpgradePromptShownEvent) {
  posthog.capture("upgrade_prompt_shown", event);
}

/**
 * Capture upgrade prompt action
 */
export function captureUpgradePromptAction(event: UpgradePromptActionEvent) {
  posthog.capture("upgrade_prompt_action", event);
}

/**
 * Capture trial started
 */
export function captureTrialStarted(event: TrialStartedEvent) {
  posthog.capture("trial_started", event);
}

/**
 * Capture subscription started
 */
export function captureSubscriptionStarted(event: SubscriptionStartedEvent) {
  posthog.capture("subscription_started", event);
}

/**
 * Capture onboarding step viewed
 */
export function captureOnboardingStepViewed(event: OnboardingStepViewedEvent) {
  posthog.capture("onboarding_step_viewed", event);
}

/**
 * Capture onboarding step completed
 */
export function captureOnboardingStepCompleted(event: OnboardingStepCompletedEvent) {
  posthog.capture("onboarding_step_completed", event);
}

/**
 * Capture onboarding completed
 */
export function captureOnboardingCompleted(event: OnboardingCompletedEvent) {
  posthog.capture("onboarding_completed", event);
}

/**
 * Capture activity completed
 */
export function captureActivityCompleted(event: ActivityCompletedEvent) {
  posthog.capture("activity_completed", event);
}

/**
 * Capture AI assistant usage
 */
export function captureAIAssistantUsed(event: AIAssistantUsedEvent) {
  posthog.capture("ai_assistant_used", event);
}

// ============================================================================
// CONTENT TRACKING CAPTURE FUNCTIONS
// ============================================================================

/**
 * Capture a semantic content view (blog post, destination, index page)
 */
export function captureContentViewed(event: ContentViewedEvent) {
  posthog.capture("content_viewed", event);
}

/**
 * Capture a content interaction (filter, paginate, scroll milestone)
 */
export function captureContentInteraction(event: ContentInteractionEvent) {
  posthog.capture("content_interaction", event);
}

// ============================================================================
// AHA MOMENT & RETENTION CAPTURE FUNCTIONS
// ============================================================================

/**
 * Capture when user reaches an aha moment
 * Key for understanding what drives retention
 */
export function captureAhaMomentReached(event: AhaMomentReachedEvent) {
  posthog.capture("aha_moment_reached", event);
}

/**
 * Capture retention checkpoint (D1, D7, D30)
 * Used for cohort analysis
 */
export function captureRetentionCheckpoint(event: RetentionCheckpointEvent) {
  posthog.capture("retention_checkpoint", event);
}

/**
 * Capture first trip saved (critical aha moment candidate)
 */
export function captureFirstTripSaved(event: FirstTripSavedEvent) {
  posthog.capture("first_trip_saved", event);
}

/**
 * Capture activity modification (engagement signal)
 */
export function captureActivityModified(event: ActivityModifiedEvent) {
  posthog.capture("activity_modified", event);
}

/**
 * Capture return visit (retention signal)
 */
export function captureReturnVisit(event: ReturnVisitEvent) {
  posthog.capture("return_visit", event);
}

/**
 * Generic event capture with type safety
 */
export function capture(eventName: string, properties?: Record<string, unknown>) {
  posthog.capture(eventName, properties);
}
