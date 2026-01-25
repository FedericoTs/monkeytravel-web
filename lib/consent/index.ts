/**
 * Consent Management Module
 *
 * GDPR-compliant cookie consent for MonkeyTravel.
 *
 * @example
 * // In app layout
 * import { ConsentProvider } from '@/lib/consent';
 *
 * <ConsentProvider userId={user?.id}>
 *   {children}
 * </ConsentProvider>
 *
 * @example
 * // In components
 * import { useConsent } from '@/lib/consent';
 *
 * function MyComponent() {
 *   const { consent, acceptAll, openSettings } = useConsent();
 *   // ...
 * }
 */

// Types
export type {
  ConsentCategory,
  ConsentState,
  ConsentRecord,
  ConsentMethod,
  ConsentBannerStatus,
  ConsentChangeEvent,
  ConsentContextValue,
  ConsentCategoryInfo,
} from "./types";

export {
  DEFAULT_CONSENT_STATE,
  FULL_CONSENT_STATE,
  CONSENT_VERSION,
  CONSENT_STORAGE_KEY,
  CONSENT_CATEGORIES,
} from "./types";

// Storage utilities
export {
  loadLocalConsent,
  saveLocalConsent,
  clearLocalConsent,
  syncConsentToSupabase,
  loadConsentFromSupabase,
  mergeConsentRecords,
  hasExistingConsent,
  getConsentCategory,
  hasAnalyticsConsent,
  hasSessionRecordingConsent,
  hasMarketingConsent,
} from "./storage";

// React context and hooks
export {
  ConsentProvider,
  useConsent,
  useConsentCategory,
  useConsentListener,
  CONSENT_CHANGE_EVENT,
} from "./context";

// Additional hooks
export {
  useClientConsent,
  useShouldShowBanner,
  useAnalyticsConsent,
  useSessionRecordingConsent,
} from "./hooks";
