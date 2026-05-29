/**
 * Shared user context loader for AI generation routes.
 *
 * Used by both /api/ai/generate (JSON) and /api/ai/generate/stream (SSE).
 * Consolidates what was previously THREE separate awaits per request:
 *   1. SELECT preferences + notification_settings FROM users
 *   2. cookies() + NEXT_LOCALE read
 *   3. SELECT preferred_language FROM users (DUPLICATE of #1's row)
 *
 * into ONE single SELECT (pulling all three columns in one round-trip)
 * plus the cookie read. Per task #190 — saves ~1 RTT per generation
 * (~30-50ms) and removes a duplicate row lookup.
 *
 * Fail-open by design: any DB or cookie failure returns sensible defaults
 * (empty preferences, English language) rather than 500-ing the generation
 * (per the post-#151 invariant that AI generate must never fail closed on
 * an ancillary read).
 */

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfilePreferences } from "@/types";

export type SupportedLanguage = "en" | "es" | "it";

export interface UserGenerationContext {
  profilePreferences: UserProfilePreferences;
  userLanguage: SupportedLanguage;
}

const VALID_LANGUAGES: readonly SupportedLanguage[] = ["en", "es", "it"];

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    (VALID_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Read locale cookie (next-intl sets NEXT_LOCALE). Works for both
 * authenticated and anonymous users — anon users get language detection
 * purely from this path.
 */
async function readLocaleCookie(): Promise<SupportedLanguage | null> {
  try {
    const cookieStore = await cookies();
    const localeCookie = cookieStore.get("NEXT_LOCALE");
    if (localeCookie?.value && isSupportedLanguage(localeCookie.value)) {
      return localeCookie.value;
    }
  } catch {
    // cookies() can throw in odd contexts; treat as no preference set.
  }
  return null;
}

/**
 * Single consolidated SELECT pulling the three columns the generation
 * routes care about. Returns null on any error (fail-open).
 */
async function loadUserProfileRow(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  preferences: unknown;
  notification_settings: unknown;
  preferred_language: unknown;
} | null> {
  try {
    const { data } = await supabase
      .from("users")
      .select("preferences, notification_settings, preferred_language")
      .eq("id", userId)
      .single();
    return (data as {
      preferences: unknown;
      notification_settings: unknown;
      preferred_language: unknown;
    } | null) ?? null;
  } catch (err) {
    console.warn("[user-context] profile load failed:", err);
    return null;
  }
}

/**
 * Map the raw user-profile row into the shape the AI generate routes
 * actually consume: profile preferences (dietary/styles/accessibility/
 * active hours) + preferred language.
 *
 * For anonymous users (userId === null) we skip the DB hit and rely on
 * the cookie alone. The wizard form supplies preferences directly in
 * that case.
 *
 * Both branches run the cookie read and (if applicable) the DB read in
 * parallel — saving the round-trip wait for authenticated users.
 */
export async function loadUserContext(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<UserGenerationContext> {
  // Run cookie + profile read in parallel. For anon users the profile
  // branch is a synchronous null — no work — so this is a no-op penalty.
  const [localeFromCookie, profileRow] = await Promise.all([
    readLocaleCookie(),
    userId ? loadUserProfileRow(supabase, userId) : Promise.resolve(null),
  ]);

  // Build the preferences view-model.
  const profilePreferences: UserProfilePreferences = {};
  if (profileRow) {
    if (profileRow.preferences && typeof profileRow.preferences === "object") {
      const prefs = profileRow.preferences as Record<string, unknown>;
      profilePreferences.dietaryPreferences = prefs.dietaryPreferences as
        | string[]
        | undefined;
      profilePreferences.travelStyles = prefs.travelStyles as
        | string[]
        | undefined;
      profilePreferences.accessibilityNeeds = prefs.accessibilityNeeds as
        | string[]
        | undefined;
    }

    // Quiet hours → active hours inversion (matches prior route logic).
    if (
      profileRow.notification_settings &&
      typeof profileRow.notification_settings === "object"
    ) {
      const ns = profileRow.notification_settings as Record<string, unknown>;
      const quietStart = ns.quietHoursStart as number | undefined;
      const quietEnd = ns.quietHoursEnd as number | undefined;
      if (quietStart !== undefined && quietEnd !== undefined) {
        profilePreferences.activeHoursStart = quietEnd;
        profilePreferences.activeHoursEnd = quietStart;
      }
    }
  }

  // Language resolution: cookie wins (next-intl is the source of truth
  // when present), then profile, then English default.
  let userLanguage: SupportedLanguage = "en";
  if (localeFromCookie) {
    userLanguage = localeFromCookie;
  } else if (profileRow && isSupportedLanguage(profileRow.preferred_language)) {
    userLanguage = profileRow.preferred_language;
  }

  return { profilePreferences, userLanguage };
}
