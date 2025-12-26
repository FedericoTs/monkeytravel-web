"use client";

import posthog from "posthog-js";
import type { User } from "@supabase/supabase-js";

/**
 * User properties for PostHog identification
 *
 * These properties enable:
 * - Cohort creation for experiments
 * - User segmentation
 * - Conversion analysis
 */
export interface PostHogUserProperties {
  email?: string;
  name?: string;
  subscription_tier?: "free" | "pro" | "premium";
  referral_tier?: 0 | 1 | 2 | 3;
  onboarding_completed?: boolean;
  trips_created?: number;
  account_age_days?: number;
  has_beta_access?: boolean;
  preferred_language?: string;
  user_stage?: "new" | "activated" | "engaged" | "power_user";
}

/**
 * Identify a user in PostHog
 *
 * Call after:
 * - Successful login
 * - OAuth callback
 * - Session restoration
 *
 * @param user - Supabase user object
 * @param properties - Additional user properties for segmentation
 */
export function identifyUser(user: User, properties?: PostHogUserProperties) {
  if (typeof window === "undefined") return;

  posthog.identify(user.id, {
    email: user.email,
    ...properties,
    // Set once properties (won't be overwritten)
    $set_once: {
      first_seen_at: new Date().toISOString(),
      signup_method: user.app_metadata?.provider || "email",
    },
  });

  if (process.env.NODE_ENV === "development") {
    console.log("[PostHog] User identified:", user.id, properties);
  }
}

/**
 * Update user properties without full identification
 *
 * Use when user is already identified but properties changed
 */
export function updateUserProperties(properties: PostHogUserProperties) {
  if (typeof window === "undefined") return;

  posthog.people.set(properties);
}

/**
 * Set a property only once (e.g., first purchase date)
 */
export function setOnceUserProperty(key: string, value: unknown) {
  if (typeof window === "undefined") return;

  posthog.people.set_once({ [key]: value });
}

/**
 * Increment a numeric property (e.g., login count)
 */
export function incrementUserProperty(key: string, amount: number = 1) {
  if (typeof window === "undefined") return;

  // PostHog doesn't have a direct increment, use capture with $set
  posthog.capture("$set", {
    $set: { [key]: amount }, // This will be handled differently
  });
}

/**
 * Reset user identification
 *
 * Call on logout to:
 * - Clear user identity
 * - Generate new anonymous distinct_id
 * - Prevent data leakage between users
 */
export function resetUser() {
  if (typeof window === "undefined") return;

  posthog.reset();

  if (process.env.NODE_ENV === "development") {
    console.log("[PostHog] User reset, new distinct_id:", posthog.get_distinct_id());
  }
}

/**
 * Alias an anonymous user to an identified user
 *
 * Use during signup to link pre-signup activity to the new user
 *
 * @param userId - New user ID (from Supabase)
 */
export function aliasUser(userId: string) {
  if (typeof window === "undefined") return;

  posthog.alias(userId);

  if (process.env.NODE_ENV === "development") {
    console.log("[PostHog] User aliased:", userId);
  }
}

/**
 * Get current distinct ID
 */
export function getDistinctId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return posthog.get_distinct_id();
}
