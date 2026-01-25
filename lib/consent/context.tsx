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
} from "./types";
import {
  loadLocalConsent,
  saveLocalConsent,
  clearLocalConsent,
  syncConsentToSupabase,
  loadConsentFromSupabase,
} from "./storage";

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
  openSettings: () => {},
  closeSettings: () => {},
  resetConsent: () => {},
});

/**
 * Custom event for consent changes
 */
const CONSENT_CHANGE_EVENT = "mt_consent_change";

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

      // If no consent found anywhere, show banner
      if (!localRecord && (!userId || !(await loadConsentFromSupabase(userId || "")))) {
        setBannerStatus("visible");
      }

      setIsInitialized(true);
    }

    initializeConsent();
  }, [userId]);

  // Accept all cookies
  const acceptAll = useCallback(() => {
    const newConsent = FULL_CONSENT_STATE;
    setConsent(newConsent);
    setHasConsented(true);
    setBannerStatus("hidden");
    saveLocalConsent(newConsent, "banner_accept_all");
    dispatchConsentChange(newConsent);

    // Sync to Supabase if logged in
    if (userId) {
      syncConsentToSupabase(userId, newConsent);
    }
  }, [userId]);

  // Accept essential only
  const acceptEssentialOnly = useCallback(() => {
    const newConsent = DEFAULT_CONSENT_STATE;
    setConsent(newConsent);
    setHasConsented(true);
    setBannerStatus("hidden");
    saveLocalConsent(newConsent, "banner_essential_only");
    dispatchConsentChange(newConsent);

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
