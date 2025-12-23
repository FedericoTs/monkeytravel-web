/**
 * Analytics Utility Library
 *
 * Centralized analytics tracking for Google Analytics 4 and Sentry.
 * Provides type-safe event tracking functions for key conversion events.
 *
 * @see https://developers.google.com/analytics/devguides/collection/ga4/events
 */

import * as Sentry from "@sentry/nextjs";

// Type definitions for gtag
declare global {
  interface Window {
    gtag?: (
      command: "config" | "event" | "set",
      targetId: string,
      params?: Record<string, unknown>
    ) => void;
    dataLayer?: unknown[];
  }
}

/**
 * Check if analytics is available
 */
function isAnalyticsAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.gtag === "function";
}

/**
 * Generic event tracking function
 */
export function trackEvent(
  eventName: string,
  params?: Record<string, unknown>
): void {
  // Track in Google Analytics
  if (isAnalyticsAvailable()) {
    window.gtag!("event", eventName, params);
  }

  // Also add breadcrumb to Sentry for debugging
  Sentry.addBreadcrumb({
    category: "analytics",
    message: eventName,
    data: params,
    level: "info",
  });

  // Log in development
  if (process.env.NODE_ENV === "development") {
    console.log("[Analytics] Event:", eventName, params);
  }
}

// ============================================================================
// CONVERSION EVENTS - Key metrics for measuring success
// ============================================================================

/**
 * Track user signup completion
 * Conversion: visitor → registered user
 */
export function trackSignup(method: "email" | "google"): void {
  trackEvent("sign_up", {
    method,
  });
}

/**
 * Track user login
 */
export function trackLogin(method: "email" | "google"): void {
  trackEvent("login", {
    method,
  });
}

/**
 * Track trip creation
 * Conversion: user → trip creator (activation)
 */
export function trackTripCreated(params: {
  tripId: string;
  destination: string;
  duration: number;
  budgetTier: "budget" | "balanced" | "premium";
  isFromTemplate?: boolean;
}): void {
  trackEvent("trip_created", {
    trip_id: params.tripId,
    destination: params.destination,
    duration_days: params.duration,
    budget_tier: params.budgetTier,
    is_from_template: params.isFromTemplate ?? false,
    // GA4 ecommerce-style tracking
    currency: "USD",
    value: params.budgetTier === "premium" ? 100 : params.budgetTier === "balanced" ? 50 : 25,
  });
}

/**
 * Track AI itinerary generation
 */
export function trackItineraryGenerated(params: {
  destination: string;
  duration: number;
  budgetTier: string;
  generationTimeMs: number;
}): void {
  trackEvent("itinerary_generated", {
    destination: params.destination,
    duration_days: params.duration,
    budget_tier: params.budgetTier,
    generation_time_ms: params.generationTimeMs,
  });
}

/**
 * Track trip sharing
 * Viral coefficient metric
 */
export function trackTripShared(params: {
  tripId: string;
  shareMethod: "link" | "email" | "social";
}): void {
  trackEvent("share", {
    content_type: "trip",
    item_id: params.tripId,
    method: params.shareMethod,
  });
}

/**
 * Track share link click (when someone views a shared trip)
 */
export function trackShareLinkClicked(params: {
  tripId: string;
  referrer?: string;
}): void {
  trackEvent("share_link_clicked", {
    trip_id: params.tripId,
    referrer: params.referrer || "direct",
  });
}

/**
 * Track template browsing
 */
export function trackTemplateBrowsed(params: {
  templateId: string;
  templateName: string;
}): void {
  trackEvent("view_item", {
    content_type: "template",
    item_id: params.templateId,
    item_name: params.templateName,
  });
}

/**
 * Track template copied to user's trips
 */
export function trackTemplateCopied(params: {
  templateId: string;
  templateName: string;
  destination: string;
}): void {
  trackEvent("template_copied", {
    template_id: params.templateId,
    template_name: params.templateName,
    destination: params.destination,
  });
}

// ============================================================================
// ONBOARDING FUNNEL EVENTS
// ============================================================================

/**
 * Track onboarding step viewed
 */
export function trackOnboardingStepViewed(params: {
  step: number;
  stepName: string;
}): void {
  trackEvent("onboarding_step_viewed", {
    step_number: params.step,
    step_name: params.stepName,
  });
}

/**
 * Track onboarding step completed
 */
export function trackOnboardingStepCompleted(params: {
  step: number;
  stepName: string;
  selections?: string[];
}): void {
  trackEvent("onboarding_step_completed", {
    step_number: params.step,
    step_name: params.stepName,
    selections_count: params.selections?.length || 0,
    selections: params.selections?.join(",") || "",
  });
}

/**
 * Track onboarding completed
 */
export function trackOnboardingCompleted(params: {
  totalSteps: number;
  skipped: boolean;
  preferences: {
    travelStyles: string[];
    dietaryPreferences: string[];
    accessibilityNeeds: string[];
  };
}): void {
  trackEvent("onboarding_completed", {
    total_steps: params.totalSteps,
    was_skipped: params.skipped,
    travel_styles_count: params.preferences.travelStyles.length,
    dietary_count: params.preferences.dietaryPreferences.length,
    accessibility_count: params.preferences.accessibilityNeeds.length,
  });
}

/**
 * Track onboarding skipped
 */
export function trackOnboardingSkipped(params: {
  atStep: number;
}): void {
  trackEvent("onboarding_skipped", {
    skipped_at_step: params.atStep,
  });
}

/**
 * Track early access code redemption
 */
export function trackEarlyAccessRedeemed(params: {
  codeId: string;
}): void {
  trackEvent("early_access_redeemed", {
    code_id: params.codeId,
  });
}

/**
 * Track trial started
 */
export function trackTrialStarted(params: {
  trialDays: number;
}): void {
  trackEvent("trial_started", {
    trial_duration_days: params.trialDays,
  });
}

// ============================================================================
// ENGAGEMENT EVENTS - User behavior tracking
// ============================================================================

/**
 * Track activity completion during trip
 */
export function trackActivityCompleted(params: {
  tripId: string;
  activityId: string;
  dayNumber: number;
  xpEarned: number;
}): void {
  trackEvent("activity_completed", {
    trip_id: params.tripId,
    activity_id: params.activityId,
    day_number: params.dayNumber,
    xp_earned: params.xpEarned,
  });
}

/**
 * Track activity regeneration (AI feature usage)
 */
export function trackActivityRegenerated(params: {
  tripId: string;
  activityType: string;
}): void {
  trackEvent("activity_regenerated", {
    trip_id: params.tripId,
    activity_type: params.activityType,
  });
}

/**
 * Track AI assistant usage
 */
export function trackAIAssistantMessage(params: {
  tripId?: string;
  messageLength: number;
}): void {
  trackEvent("ai_assistant_used", {
    trip_id: params.tripId,
    message_length: params.messageLength,
  });
}

/**
 * Track hotel search
 */
export function trackHotelSearch(params: {
  tripId: string;
  destination: string;
}): void {
  trackEvent("hotel_search", {
    trip_id: params.tripId,
    destination: params.destination,
  });
}

/**
 * Track flight search
 */
export function trackFlightSearch(params: {
  tripId: string;
  origin: string;
  destination: string;
}): void {
  trackEvent("flight_search", {
    trip_id: params.tripId,
    origin: params.origin,
    destination: params.destination,
  });
}

// ============================================================================
// ERROR TRACKING
// ============================================================================

/**
 * Track an error event (non-fatal)
 */
export function trackError(params: {
  errorType: string;
  errorMessage: string;
  componentName?: string;
  additionalData?: Record<string, unknown>;
}): void {
  trackEvent("error", {
    error_type: params.errorType,
    error_message: params.errorMessage,
    component_name: params.componentName,
    ...params.additionalData,
  });

  // Also report to Sentry as a non-fatal error
  Sentry.captureMessage(params.errorMessage, {
    level: "warning",
    tags: {
      errorType: params.errorType,
      componentName: params.componentName,
    },
    extra: params.additionalData,
  });
}

// ============================================================================
// PAGE VIEW TRACKING (for SPA navigation)
// ============================================================================

/**
 * Track page view (called on route change)
 * Note: GA4 with @next/third-parties handles this automatically,
 * but this can be used for custom tracking.
 */
export function trackPageView(params: {
  pagePath: string;
  pageTitle?: string;
}): void {
  if (isAnalyticsAvailable()) {
    window.gtag!("config", process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "", {
      page_path: params.pagePath,
      page_title: params.pageTitle,
    });
  }
}

// ============================================================================
// USER IDENTIFICATION (for cross-session tracking)
// ============================================================================

/**
 * Set user ID for cross-session tracking
 * Call this after successful login
 */
export function setUserId(userId: string): void {
  // Set in GA4
  if (isAnalyticsAvailable()) {
    window.gtag!("set", "user_properties", {
      user_id: userId,
    });
  }

  // Set in Sentry
  Sentry.setUser({ id: userId });
}

/**
 * Clear user identification on logout
 */
export function clearUserId(): void {
  // Clear in GA4
  if (isAnalyticsAvailable()) {
    window.gtag!("set", "user_properties", {
      user_id: null,
    });
  }

  // Clear in Sentry
  Sentry.setUser(null);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Set user properties for segmentation
 */
export function setUserProperties(properties: {
  subscriptionTier?: "free" | "premium" | "enterprise";
  tripsCreated?: number;
  accountAgeDays?: number;
}): void {
  if (isAnalyticsAvailable()) {
    window.gtag!("set", "user_properties", properties);
  }
}

/**
 * Track timing (for performance monitoring)
 */
export function trackTiming(params: {
  category: string;
  variable: string;
  value: number;
  label?: string;
}): void {
  trackEvent("timing_complete", {
    event_category: params.category,
    name: params.variable,
    value: params.value,
    event_label: params.label,
  });
}

// ============================================================================
// RETENTION EVENTS - Critical for growth measurement
// ============================================================================

/**
 * Track user returning to the app
 * Call on app load after checking last visit
 */
export function trackUserReturn(params: {
  daysSinceLastVisit: number;
  totalSessions: number;
  returnSource?: "direct" | "notification" | "email" | "share";
}): void {
  trackEvent("user_return", {
    days_since_last_visit: params.daysSinceLastVisit,
    total_sessions: params.totalSessions,
    return_source: params.returnSource || "direct",
    // Bucket for easier analysis
    return_bucket:
      params.daysSinceLastVisit === 0
        ? "same_day"
        : params.daysSinceLastVisit === 1
          ? "d1"
          : params.daysSinceLastVisit <= 7
            ? "d2_7"
            : params.daysSinceLastVisit <= 30
              ? "d8_30"
              : "d30_plus",
  });
}

/**
 * Track when user views their trip (engagement signal)
 */
export function trackTripViewed(params: {
  tripId: string;
  isOwnTrip: boolean;
  tripStatus: string;
  daysSinceCreation: number;
  activitiesCount: number;
}): void {
  trackEvent("trip_viewed", {
    trip_id: params.tripId,
    is_own_trip: params.isOwnTrip,
    trip_status: params.tripStatus,
    days_since_creation: params.daysSinceCreation,
    activities_count: params.activitiesCount,
  });
}

/**
 * Track session start with context
 */
export function trackSessionStart(params: {
  userId?: string;
  isNewUser: boolean;
  hasActiveTrip: boolean;
  tripsCount: number;
  daysSinceSignup: number;
}): void {
  trackEvent("session_start", {
    is_new_user: params.isNewUser,
    has_active_trip: params.hasActiveTrip,
    trips_count: params.tripsCount,
    days_since_signup: params.daysSinceSignup,
    // Lifecycle stage
    user_stage:
      params.tripsCount === 0
        ? "new"
        : params.tripsCount === 1
          ? "activated"
          : params.tripsCount < 5
            ? "engaged"
            : "power_user",
  });
}

/**
 * Track achievement unlock (gamification retention)
 */
export function trackAchievementUnlocked(params: {
  achievementId: string;
  achievementName: string;
  xpEarned: number;
  totalXp: number;
}): void {
  trackEvent("achievement_unlocked", {
    achievement_id: params.achievementId,
    achievement_name: params.achievementName,
    xp_earned: params.xpEarned,
    total_xp: params.totalXp,
  });
}

// ============================================================================
// REFERRAL FUNNEL EVENTS - Viral coefficient tracking
// ============================================================================

/**
 * Track referral code generated
 */
export function trackReferralCodeGenerated(params: {
  code: string;
  userId: string;
}): void {
  trackEvent("referral_code_generated", {
    referral_code: params.code,
    user_id: params.userId,
  });
}

/**
 * Track referral link clicked
 */
export function trackReferralLinkClicked(params: {
  code: string;
  medium: "copy" | "whatsapp" | "twitter" | "facebook" | "email" | "qr" | "direct";
}): void {
  trackEvent("referral_link_clicked", {
    referral_code: params.code,
    share_medium: params.medium,
  });
}

/**
 * Track signup from referral
 */
export function trackReferralSignup(params: {
  referralCode: string;
  referrerId: string;
}): void {
  trackEvent("referral_signup", {
    referral_code: params.referralCode,
    referrer_id: params.referrerId,
  });
}

/**
 * Track referral conversion (when referee creates first trip)
 */
export function trackReferralConversion(params: {
  referralCode: string;
  rewardAmount: number;
  referrerId: string;
  refereeId: string;
}): void {
  trackEvent("referral_conversion", {
    referral_code: params.referralCode,
    reward_amount: params.rewardAmount,
    referrer_id: params.referrerId,
    referee_id: params.refereeId,
  });
}

/**
 * Track share modal opened
 */
export function trackShareModalOpened(params: {
  tripId: string;
  tripDestination: string;
}): void {
  trackEvent("share_modal_opened", {
    trip_id: params.tripId,
    trip_destination: params.tripDestination,
  });
}

/**
 * Track post-save sharing prompt shown (critical virality metric)
 */
export function trackSharePromptShown(params: {
  tripId: string;
  tripDestination: string;
  tripDays: number;
}): void {
  trackEvent("share_prompt_shown", {
    trip_id: params.tripId,
    trip_destination: params.tripDestination,
    trip_days: params.tripDays,
    location: "post_save",
  });
}

/**
 * Track post-save sharing prompt action
 */
export function trackSharePromptAction(params: {
  tripId: string;
  action: "invite" | "skip";
}): void {
  trackEvent("share_prompt_action", {
    trip_id: params.tripId,
    action: params.action,
    location: "post_save",
  });
}

// ============================================================================
// REVENUE INTENT EVENTS - Pre-monetization tracking
// ============================================================================

/**
 * Track upgrade prompt shown
 */
export function trackUpgradePromptShown(params: {
  trigger: "limit_reached" | "feature_gate" | "trial_ending" | "upsell";
  limitType?: string;
  location: string;
}): void {
  trackEvent("upgrade_prompt_shown", {
    trigger: params.trigger,
    limit_type: params.limitType,
    location: params.location,
  });
}

/**
 * Track upgrade prompt action
 */
export function trackUpgradePromptAction(params: {
  trigger: string;
  action: "clicked" | "dismissed" | "later";
}): void {
  trackEvent("upgrade_prompt_action", {
    trigger: params.trigger,
    action: params.action,
  });
}

/**
 * Track limit reached
 */
export function trackLimitReached(params: {
  limitType: "generation" | "regeneration" | "assistant";
  currentUsage: number;
  limit: number;
}): void {
  trackEvent("limit_reached", {
    limit_type: params.limitType,
    current_usage: params.currentUsage,
    limit: params.limit,
    utilization_percent: Math.round((params.currentUsage / params.limit) * 100),
  });
}

/**
 * Track free trip used
 */
export function trackFreeTripUsed(params: {
  tripsRemaining: number;
  tripId: string;
}): void {
  trackEvent("free_trip_used", {
    trips_remaining: params.tripsRemaining,
    trip_id: params.tripId,
    is_last_free: params.tripsRemaining === 0,
  });
}

/**
 * Track beta code attempt (success or failure)
 */
export function trackBetaCodeAttempt(params: {
  code: string;
  success: boolean;
  errorReason?: string;
}): void {
  trackEvent("beta_code_attempt", {
    code_entered: params.code,
    success: params.success,
    error_reason: params.errorReason,
  });
}

/**
 * Track welcome page viewed
 */
export function trackWelcomePageViewed(params: {
  hasBetaAccess: boolean;
  hasCompletedOnboarding: boolean;
}): void {
  trackEvent("welcome_page_viewed", {
    has_beta_access: params.hasBetaAccess,
    has_completed_onboarding: params.hasCompletedOnboarding,
  });
}

/**
 * Track destination selected (trip creation flow)
 */
export function trackDestinationSelected(params: {
  destination: string;
  source: "autocomplete" | "popular" | "manual";
}): void {
  trackEvent("destination_selected", {
    destination: params.destination,
    selection_source: params.source,
  });
}

/**
 * Track email subscription
 */
export function trackEmailSubscribed(params: {
  source: "hero" | "footer" | "cta" | "modal";
  email?: string;
}): void {
  trackEvent("email_subscribed", {
    subscription_source: params.source,
    // Don't track actual email for privacy
  });
}

// ============================================================================
// ENHANCED USER PROPERTIES
// ============================================================================

/**
 * Set comprehensive user properties for segmentation
 */
export function setUserPropertiesEnhanced(properties: {
  subscriptionTier?: "free" | "premium" | "enterprise";
  tripsCreated?: number;
  accountAgeDays?: number;
  onboardingCompleted?: boolean;
  hasBetaAccess?: boolean;
  referralSource?: "organic" | "referral" | "paid";
  userStage?: "new" | "activated" | "engaged" | "power_user";
}): void {
  if (isAnalyticsAvailable()) {
    window.gtag!("set", "user_properties", {
      subscription_tier: properties.subscriptionTier,
      trips_count: properties.tripsCreated,
      account_age_days: properties.accountAgeDays,
      onboarding_completed: properties.onboardingCompleted,
      has_beta_access: properties.hasBetaAccess,
      referral_source: properties.referralSource,
      user_stage: properties.userStage,
    });
  }
}
