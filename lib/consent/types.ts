/**
 * Cookie Consent Types
 *
 * GDPR-compliant consent management types for MonkeyTravel.
 * Covers analytics, session recording, and marketing consent.
 */

/**
 * Consent categories as defined by GDPR
 */
export type ConsentCategory =
  | "essential" // Always on - required for basic functionality
  | "analytics" // PostHog events, GA4, Vercel Analytics
  | "sessionRecording" // PostHog replay, Sentry replay
  | "marketing"; // Future: ads, remarketing

/**
 * Individual consent state for each category
 */
export interface ConsentState {
  essential: true; // Always true, cannot be disabled
  analytics: boolean;
  sessionRecording: boolean;
  marketing: boolean;
}

/**
 * Full consent record with metadata
 */
export interface ConsentRecord {
  /** Current consent choices */
  consent: ConsentState;
  /** ISO timestamp of when consent was last updated */
  updatedAt: string;
  /** Version of consent UI shown to user */
  version: number;
  /** How consent was given */
  method: ConsentMethod;
}

/**
 * How user gave consent
 */
export type ConsentMethod =
  | "banner_accept_all" // Clicked "Accept All"
  | "banner_essential_only" // Clicked "Essential Only"
  | "settings_modal" // Configured in settings modal
  | "synced_from_account"; // Loaded from user account

/**
 * Consent banner status for UI
 */
export type ConsentBannerStatus =
  | "hidden" // User already consented
  | "visible" // Showing banner
  | "settings_open"; // Settings modal open

/**
 * Consent change event for listeners
 */
export interface ConsentChangeEvent {
  category: ConsentCategory;
  enabled: boolean;
  timestamp: string;
}

/**
 * Consent context value for React context
 */
export interface ConsentContextValue {
  /** Current consent state */
  consent: ConsentState;
  /** Whether consent has been set (banner dismissed) */
  hasConsented: boolean;
  /** Banner visibility status */
  bannerStatus: ConsentBannerStatus;
  /** Accept all cookies */
  acceptAll: () => void;
  /** Accept essential cookies only */
  acceptEssentialOnly: () => void;
  /** Update specific category */
  updateCategory: (category: Exclude<ConsentCategory, "essential">, enabled: boolean) => void;
  /** Open settings modal */
  openSettings: () => void;
  /** Close settings modal */
  closeSettings: () => void;
  /** Reset consent (show banner again) */
  resetConsent: () => void;
}

/**
 * Default consent state (minimal tracking)
 */
export const DEFAULT_CONSENT_STATE: ConsentState = {
  essential: true,
  analytics: false,
  sessionRecording: false,
  marketing: false,
};

/**
 * Full consent state (all tracking enabled)
 */
export const FULL_CONSENT_STATE: ConsentState = {
  essential: true,
  analytics: true,
  sessionRecording: true,
  marketing: true,
};

/**
 * Current consent version - increment when consent UI changes
 */
export const CONSENT_VERSION = 1;

/**
 * Local storage key for consent
 */
export const CONSENT_STORAGE_KEY = "mt_cookie_consent";

/**
 * Category metadata for UI display
 */
export interface ConsentCategoryInfo {
  id: ConsentCategory;
  required: boolean;
  services: string[];
  translationKey: string;
}

/**
 * Consent categories with metadata
 */
export const CONSENT_CATEGORIES: ConsentCategoryInfo[] = [
  {
    id: "essential",
    required: true,
    services: ["Supabase Auth", "Session Management"],
    translationKey: "essential",
  },
  {
    id: "analytics",
    required: false,
    services: ["PostHog", "Google Analytics 4", "Vercel Analytics"],
    translationKey: "analytics",
  },
  {
    id: "sessionRecording",
    required: false,
    services: ["PostHog Session Replay", "Sentry Session Replay"],
    translationKey: "sessionRecording",
  },
  {
    id: "marketing",
    required: false,
    services: ["Travelpayouts Affiliate Tracking"],
    translationKey: "marketing",
  },
];
