"use client";

/**
 * Consent Context Provider
 *
 * Provides consent state and management functions throughout the app.
 * Handles localStorage persistence and Supabase sync for logged-in users.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import {
  ConsentState,
  ConsentContextValue,
  ConsentBannerStatus,
  ConsentCategory,
  DEFAULT_CONSENT_STATE,
  FULL_CONSENT_STATE,
  CONSENT_CHANGE_EVENT,
  CONSENT_ORIGINS,
  type ConsentOrigin,
} from "./types";

/**
 * Validate before use: a missed call site should degrade to "card", not
 * serialise a MouseEvent into the column (every handler here is also a
 * plausible onClick target).
 */
function asOrigin(value: unknown): ConsentOrigin {
  return CONSENT_ORIGINS.includes(value as ConsentOrigin) ? (value as ConsentOrigin) : "card";
}
import {
  loadLocalConsent,
  saveLocalConsent,
  clearLocalConsent,
  syncConsentToSupabase,
  loadConsentFromSupabase,
} from "./storage";
import { buildConsentEvent, sendConsentEvent } from "./consent-event-client";

/**
 * Consent context with default values
 */
const ConsentContext = createContext<ConsentContextValue>({
  consent: DEFAULT_CONSENT_STATE,
  hasConsented: false,
  bannerStatus: "visible",
  acceptAll: () => {},
  acceptEssentialOnly: () => {},
  updateCategory: () => {},
  saveSettings: () => {},
  openSettings: () => {},
  closeSettings: () => {},
  resetConsent: () => {},
});

// CONSENT_CHANGE_EVENT is defined in ./types (so instrumentation-client.ts
// can subscribe without React) and re-exported at the bottom of this file.

/**
 * Dispatch consent change event for analytics listeners
 */
function dispatchConsentChange(consent: ConsentState): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(CONSENT_CHANGE_EVENT, { detail: consent })
    );
  }
}

/**
 * Consent Provider Props
 */
interface ConsentProviderProps {
  children: ReactNode;
  userId?: string | null;
}

/**
 * Consent Provider Component
 */
export function ConsentProvider({ children, userId }: ConsentProviderProps) {
  const [consent, setConsent] = useState<ConsentState>(DEFAULT_CONSENT_STATE);
  const [hasConsented, setHasConsented] = useState(false);
  const [bannerStatus, setBannerStatus] = useState<ConsentBannerStatus>("hidden");
  const [isInitialized, setIsInitialized] = useState(false);

  // Load consent on mount
  useEffect(() => {
    async function initializeConsent() {
      // First try localStorage
      const localRecord = loadLocalConsent();

      if (localRecord) {
        setConsent(localRecord.consent);
        setHasConsented(true);
        setBannerStatus("hidden");
        dispatchConsentChange(localRecord.consent);
      }

      // If logged in, sync with Supabase
      if (userId) {
        const remoteConsent = await loadConsentFromSupabase(userId);

        if (remoteConsent) {
          // If we have both, use the local one but sync to remote
          if (localRecord) {
            // Local exists - sync it to remote
            await syncConsentToSupabase(userId, localRecord.consent);
          } else {
            // No local but remote exists - use remote and save locally
            setConsent(remoteConsent);
            setHasConsented(true);
            setBannerStatus("hidden");
            saveLocalConsent(remoteConsent, "synced_from_account");
            dispatchConsentChange(remoteConsent);
          }
        } else if (localRecord) {
          // Local exists but no remote - sync to remote
          await syncConsentToSupabase(userId, localRecord.consent);
        }
      }

      // If no consent found anywhere, show banner — but defer the
      // appearance by ~800ms so it doesn't race the rest of the
      // page (auth-button hydration, navbar settle, image priorities).
      // Banner pops up as a deliberate moment rather than competing
      // with everything else painting in the first 200ms.
      if (!localRecord && (!userId || !(await loadConsentFromSupabase(userId || "")))) {
        const t = setTimeout(() => setBannerStatus("visible"), 800);
        cleanups.push(() => clearTimeout(t));
      }

      setIsInitialized(true);
    }

    const cleanups: Array<() => void> = [];
    initializeConsent();
    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [userId]);

  // Accept all cookies
  const acceptAll = useCallback((origin?: ConsentOrigin) => {
    const newConsent = FULL_CONSENT_STATE;
    setConsent(newConsent);
    setHasConsented(true);
    setBannerStatus("hidden");
    saveLocalConsent(newConsent, "banner_accept_all");
    dispatchConsentChange(newConsent);
    sendConsentEvent(buildConsentEvent("accept_all", newConsent, { origin: asOrigin(origin) }));

    // Sync to Supabase if logged in
    if (userId) {
      syncConsentToSupabase(userId, newConsent);
    }
  }, [userId]);

  // Accept essential only
  const acceptEssentialOnly = useCallback((origin?: ConsentOrigin) => {
    const newConsent = DEFAULT_CONSENT_STATE;
    setConsent(newConsent);
    setHasConsented(true);
    setBannerStatus("hidden");
    saveLocalConsent(newConsent, "banner_essential_only");
    dispatchConsentChange(newConsent);
    sendConsentEvent(buildConsentEvent("essential_only", newConsent, { origin: asOrigin(origin) }));

    // Sync to Supabase if logged in
    if (userId) {
      syncConsentToSupabase(userId, newConsent);
    }
  }, [userId]);

  // Update specific category
  const updateCategory = useCallback(
    (category: Exclude<ConsentCategory, "essential">, enabled: boolean) => {
      setConsent((prev) => {
        const newConsent = { ...prev, [category]: enabled };
        // Persist the toggle so a reload keeps it, but do NOT record a
        // decision here: one event per toggle is why settings_saved read as
        // 2 in seven days and meant nothing. The decision is saveSettings().
        saveLocalConsent(newConsent, "settings_modal");
        dispatchConsentChange(newConsent);

        // Sync to Supabase if logged in
        if (userId) {
          syncConsentToSupabase(userId, newConsent);
        }

        return newConsent;
      });
    },
    [userId]
  );

  /**
   * Commit the granular choice. Before 2026-09-22 "Save Settings" only closed
   * the modal, and closeSettings falls back to "visible" while hasConsented
   * is false — so switching everything off and pressing Save brought the
   * banner straight back, for ever, while Accept All was one click and gone.
   * Refusal cannot cost more than acceptance.
   */
  const saveSettings = useCallback(() => {
    setConsent((current) => {
      saveLocalConsent(current, "settings_modal");
      dispatchConsentChange(current);
      sendConsentEvent(buildConsentEvent("settings_saved", current, { origin: "settings" }));
      if (userId) {
        syncConsentToSupabase(userId, current);
      }
      return current;
    });
    setHasConsented(true);
    setBannerStatus("hidden");
  }, [userId]);

  // Open settings modal
  const openSettings = useCallback(() => {
    setBannerStatus("settings_open");
  }, []);

  // Close settings modal
  const closeSettings = useCallback(() => {
    // If user hasn't consented yet, show banner
    // Otherwise hide everything
    setBannerStatus(hasConsented ? "hidden" : "visible");
  }, [hasConsented]);

  // Reset consent (for testing or user request)
  const resetConsent = useCallback(() => {
    clearLocalConsent();
    setConsent(DEFAULT_CONSENT_STATE);
    setHasConsented(false);
    setBannerStatus("visible");
    dispatchConsentChange(DEFAULT_CONSENT_STATE);
  }, []);

  const value: ConsentContextValue = {
    consent,
    hasConsented,
    bannerStatus,
    acceptAll,
    acceptEssentialOnly,
    updateCategory,
    saveSettings,
    openSettings,
    closeSettings,
    resetConsent,
  };

  // Don't render children until consent is initialized
  // This prevents flash of analytics before consent check
  if (!isInitialized) {
    return <>{children}</>;
  }

  return (
    <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>
  );
}

/**
 * Hook to access consent context
 */
export function useConsent(): ConsentContextValue {
  const context = useContext(ConsentContext);
  if (!context) {
    throw new Error("useConsent must be used within a ConsentProvider");
  }
  return context;
}

/**
 * Hook to check if a specific category is consented
 */
export function useConsentCategory(
  category: keyof ConsentState
): boolean {
  const { consent } = useConsent();
  return consent[category];
}

/**
 * Hook to listen for consent changes
 */
export function useConsentListener(
  callback: (consent: ConsentState) => void
): void {
  useEffect(() => {
    function handleChange(event: CustomEvent<ConsentState>) {
      callback(event.detail);
    }

    window.addEventListener(
      CONSENT_CHANGE_EVENT,
      handleChange as EventListener
    );

    return () => {
      window.removeEventListener(
        CONSENT_CHANGE_EVENT,
        handleChange as EventListener
      );
    };
  }, [callback]);
}

/**
 * Export the event name for external listeners
 */
export { CONSENT_CHANGE_EVENT };
