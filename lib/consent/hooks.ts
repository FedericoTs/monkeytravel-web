"use client";

/**
 * Consent Hooks
 *
 * Additional hooks for working with consent state.
 */

import { useEffect, useState } from "react";
import { ConsentState } from "./types";
import { loadLocalConsent, hasExistingConsent } from "./storage";

/**
 * Hook to check consent on the client side without context
 * Useful for components that load before the context is available
 */
export function useClientConsent(): {
  consent: ConsentState | null;
  hasConsented: boolean;
  isLoading: boolean;
} {
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [hasConsented, setHasConsented] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const record = loadLocalConsent();
    if (record) {
      setConsent(record.consent);
      setHasConsented(true);
    }
    setIsLoading(false);
  }, []);

  return { consent, hasConsented, isLoading };
}

/**
 * Hook to check if user should see the consent banner
 * Returns true if banner should be shown
 */
export function useShouldShowBanner(): boolean {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    setShouldShow(!hasExistingConsent());
  }, []);

  return shouldShow;
}

/**
 * Hook to get analytics consent specifically
 * Useful for conditionally initializing analytics
 */
export function useAnalyticsConsent(): boolean {
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    const record = loadLocalConsent();
    setHasConsent(record?.consent.analytics ?? false);

    // Listen for consent changes
    function handleChange(event: CustomEvent<ConsentState>) {
      setHasConsent(event.detail.analytics);
    }

    window.addEventListener(
      "mt_consent_change",
      handleChange as EventListener
    );

    return () => {
      window.removeEventListener(
        "mt_consent_change",
        handleChange as EventListener
      );
    };
  }, []);

  return hasConsent;
}

/**
 * Hook to get session recording consent specifically
 */
export function useSessionRecordingConsent(): boolean {
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    const record = loadLocalConsent();
    setHasConsent(record?.consent.sessionRecording ?? false);

    // Listen for consent changes
    function handleChange(event: CustomEvent<ConsentState>) {
      setHasConsent(event.detail.sessionRecording);
    }

    window.addEventListener(
      "mt_consent_change",
      handleChange as EventListener
    );

    return () => {
      window.removeEventListener(
        "mt_consent_change",
        handleChange as EventListener
      );
    };
  }, []);

  return hasConsent;
}
