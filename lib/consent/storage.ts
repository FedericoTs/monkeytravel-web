/**
 * Consent Storage Utilities
 *
 * Handles persistence of consent choices to localStorage and Supabase.
 * Syncs consent between devices for logged-in users.
 */

import {
  ConsentRecord,
  ConsentState,
  ConsentMethod,
  DEFAULT_CONSENT_STATE,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
} from "./types";

/**
 * Check if we're in a browser environment
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/**
 * Load consent from localStorage
 */
export function loadLocalConsent(): ConsentRecord | null {
  if (!isBrowser()) return null;

  try {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!stored) return null;

    const record = JSON.parse(stored) as ConsentRecord;

    // Validate the record has required fields
    if (
      !record.consent ||
      typeof record.consent.essential !== "boolean" ||
      typeof record.consent.analytics !== "boolean" ||
      typeof record.consent.sessionRecording !== "boolean" ||
      typeof record.consent.marketing !== "boolean"
    ) {
      console.warn("[Consent] Invalid consent record in localStorage, clearing");
      localStorage.removeItem(CONSENT_STORAGE_KEY);
      return null;
    }

    // Ensure essential is always true
    record.consent.essential = true;

    return record;
  } catch (error) {
    console.error("[Consent] Failed to load consent from localStorage:", error);
    localStorage.removeItem(CONSENT_STORAGE_KEY);
    return null;
  }
}

/**
 * Save consent to localStorage
 */
export function saveLocalConsent(
  consent: ConsentState,
  method: ConsentMethod
): ConsentRecord {
  const record: ConsentRecord = {
    consent: { ...consent, essential: true },
    updatedAt: new Date().toISOString(),
    version: CONSENT_VERSION,
    method,
  };

  if (isBrowser()) {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch (error) {
      console.error("[Consent] Failed to save consent to localStorage:", error);
    }
  }

  return record;
}

/**
 * Clear consent from localStorage (resets to banner)
 */
export function clearLocalConsent(): void {
  if (isBrowser()) {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
  }
}

/**
 * Sync consent to Supabase for logged-in users
 */
export async function syncConsentToSupabase(
  userId: string,
  consent: ConsentState
): Promise<boolean> {
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();

    const { error } = await supabase
      .from("users")
      .update({
        cookie_consent: consent,
        cookie_consent_updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      console.error("[Consent] Failed to sync to Supabase:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Consent] Failed to sync to Supabase:", error);
    return false;
  }
}

/**
 * Load consent from Supabase for logged-in users
 */
export async function loadConsentFromSupabase(
  userId: string
): Promise<ConsentState | null> {
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();

    const { data, error } = await supabase
      .from("users")
      .select("cookie_consent")
      .eq("id", userId)
      .single();

    if (error || !data?.cookie_consent) {
      return null;
    }

    const consent = data.cookie_consent as ConsentState;

    // Validate and ensure essential is true
    if (
      typeof consent.analytics !== "boolean" ||
      typeof consent.sessionRecording !== "boolean" ||
      typeof consent.marketing !== "boolean"
    ) {
      return null;
    }

    return { ...consent, essential: true };
  } catch (error) {
    console.error("[Consent] Failed to load from Supabase:", error);
    return null;
  }
}

/**
 * Merge local consent with Supabase consent
 * Prefers the most recently updated consent
 */
export function mergeConsentRecords(
  local: ConsentRecord | null,
  remote: ConsentState | null,
  remoteUpdatedAt?: string
): ConsentState {
  // If neither exists, return default
  if (!local && !remote) {
    return DEFAULT_CONSENT_STATE;
  }

  // If only one exists, use it
  if (!local && remote) return remote;
  if (local && !remote) return local.consent;

  // Both exist - prefer most recent
  if (local && remote && remoteUpdatedAt) {
    const localDate = new Date(local.updatedAt);
    const remoteDate = new Date(remoteUpdatedAt);
    return remoteDate > localDate ? remote : local.consent;
  }

  // Fallback to local
  return local?.consent || DEFAULT_CONSENT_STATE;
}

/**
 * Check if consent has been given (banner already dismissed)
 */
export function hasExistingConsent(): boolean {
  return loadLocalConsent() !== null;
}

/**
 * Get specific consent category value
 */
export function getConsentCategory(
  category: keyof ConsentState
): boolean {
  const record = loadLocalConsent();
  if (!record) return category === "essential";
  return record.consent[category];
}

/**
 * Check if analytics consent is given
 */
export function hasAnalyticsConsent(): boolean {
  return getConsentCategory("analytics");
}

/**
 * Check if session recording consent is given
 */
export function hasSessionRecordingConsent(): boolean {
  return getConsentCategory("sessionRecording");
}

/**
 * Check if marketing consent is given
 */
export function hasMarketingConsent(): boolean {
  return getConsentCategory("marketing");
}
