"use client";

import { useSyncExternalStore } from "react";
import { CONSENT_CHANGE_EVENT } from "./types";
import { loadLocalConsent } from "./storage";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
}

/**
 * Whether the visitor agreed to analytics, read without the consent
 * context: false on the server and until they agree. Every change saves the
 * consent before announcing it, so the stored record is current on each
 * announcement.
 */
export function useAnalyticsConsent(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => loadLocalConsent()?.consent.analytics ?? false,
    () => false
  );
}
