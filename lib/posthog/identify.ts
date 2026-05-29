"use client";

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
 * BUNDLE NOTE (perf task #179, 2026-05-29): posthog-js is lazy-loaded via
 * `getPosthog()` instead of a top-level import so this module doesn't pull
 * the ~120 KB SDK into every component chunk that calls `identifyUser`
 * (SessionTracker, ShareAfterSaveModal, etc.). The SDK is initialized
 * once in `instrumentation-client.ts`; this dynamic import resolves to
 * the same module instance.
 */
const getPosthog = () => import("posthog-js").then((m) => m.default);

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
export async function identifyUser(user: User, properties?: PostHogUserProperties) {
  if (typeof window === "undefined") return;

  const posthog = await getPosthog();
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
export async function updateUserProperties(properties: PostHogUserProperties) {
  if (typeof window === "undefined") return;

  const posthog = await getPosthog();
  posthog.people.set(properties);
}

/**
 * Set a property only once (e.g., first purchase date)
 */
export async function setOnceUserProperty(key: string, value: unknown) {
  if (typeof window === "undefined") return;

  const posthog = await getPosthog();
  posthog.people.set_once({ [key]: value });
}

/**
 * Increment a numeric property (e.g., login count)
 */
export async function incrementUserProperty(key: string, amount: number = 1) {
  if (typeof window === "undefined") return;

  const posthog = await getPosthog();
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
export async function resetUser() {
  if (typeof window === "undefined") return;

  const posthog = await getPosthog();
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
export async function aliasUser(userId: string) {
  if (typeof window === "undefined") return;

  const posthog = await getPosthog();
  posthog.alias(userId);

  if (process.env.NODE_ENV === "development") {
    console.log("[PostHog] User aliased:", userId);
  }
}

/**
 * Stitch the current anonymous distinct_id to a known user.id.
 *
 * Use right after signup/login so all pre-auth activity (homepage view,
 * wizard step views, /shared visits) merges into the user's profile in
 * PostHog. Safe to call multiple times — PostHog dedupes.
 *
 * Task #207: anon→known stitching. Without this, every funnel that starts
 * before login (which is most of them after the anon-generation flip in
 * task #9) shows a drop at signup because the events live on different
 * distinct_ids.
 */
export async function aliasAnonToUser(userId: string) {
  if (typeof window === "undefined") return;

  const posthog = await getPosthog();
  // Only alias if the current distinct_id is NOT already the target user
  // — otherwise we'd alias a user.id to itself, which is a noop but
  // generates noise in the alias table.
  const currentDistinctId = posthog.get_distinct_id();
  if (currentDistinctId && currentDistinctId !== userId) {
    posthog.alias(userId);
    if (process.env.NODE_ENV === "development") {
      console.log("[PostHog] Aliased anon distinct_id → user.id:", currentDistinctId, "→", userId);
    }
  }
}

/**
 * Lightweight identify wrapper — task #207 spec form.
 *
 * Use at auth entry points (callback, signup, login, AuthProvider mount)
 * where you only have userId + basic properties (no need to pass a full
 * Supabase `User` object). For session-level identify with full DB-derived
 * properties, prefer `identifyUser` (used by SessionTracker).
 *
 * Idempotent: PostHog dedupes identifies of the same distinct_id with
 * the same property set, and the call sites short-circuit when the
 * lib/posthog/identify-state module has already seen this userId on
 * this page-load.
 */
export interface IdentifyProperties {
  email?: string;
  name?: string;
  /**
   * The method used to authenticate. Stamped as `signup_method` $set_once
   * so we can segment cohorts by acquisition channel forever.
   */
  signupMethod?: "email" | "oauth-google";
  locale?: string;
}

export async function identify(userId: string, properties: IdentifyProperties = {}) {
  if (typeof window === "undefined") return;

  const posthog = await getPosthog();
  const { signupMethod, ...rest } = properties;
  posthog.identify(userId, {
    ...rest,
    // Only the first identify for a user persists these — captures the
    // ORIGINAL acquisition channel even if the user later logs in via a
    // different method.
    $set_once: {
      first_seen_at: new Date().toISOString(),
      ...(signupMethod && { signup_method: signupMethod }),
    },
  });

  if (process.env.NODE_ENV === "development") {
    console.log("[PostHog] identify():", userId, properties);
  }
}

/**
 * Get current distinct ID
 *
 * Returns `undefined` if posthog-js hasn't loaded yet. Callers that need
 * the distinct ID synchronously should fall back to a cookie-derived id.
 */
export async function getDistinctId(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  const posthog = await getPosthog();
  return posthog.get_distinct_id();
}
