/**
 * Google Consent Mode v2 for GA4.
 *
 * The "advanced" form (the default): gtag.js loads with every storage type
 * DENIED and sends cookieless pings (no cookies, no client id, nothing stored
 * on the device) until the visitor accepts; Google models the non-consented
 * majority in its own reports. Most visitors leave without ever answering the
 * banner, so mounting GA4 only after consent leaves it with a small minority
 * of them. The consented path is the same either way.
 *
 * What this does not change: page_views_human stays the count of people who
 * came (docs/ANALYTICS_SOURCES_OF_TRUTH.md). Modeled GA4 numbers are Google's
 * estimate, never ours.
 *
 * NEXT_PUBLIC_GA_CONSENT_MODE=gated mounts GA4 only after acceptance, without
 * a code change.
 *
 * Pure: the component and the root layout call these; the mapping is tested.
 */

export type GaConsentMode = "advanced" | "gated";

export function gaConsentModeFromEnv(raw: string | undefined | null): GaConsentMode {
  return raw === "gated" ? "gated" : "advanced";
}

export type GaConsentValue = "granted" | "denied";

export interface GaConsentParams {
  analytics_storage: GaConsentValue;
  ad_storage: GaConsentValue;
  ad_user_data: GaConsentValue;
  ad_personalization: GaConsentValue;
}

/** Everything denied until the visitor says otherwise. */
export const GA_CONSENT_DEFAULT: GaConsentParams = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
};

/**
 * How long gtag waits, after loading, for a consent update before it sends
 * its first hit. Long enough for ConsentGatedTags to read the stored choice
 * of a returning visitor and push the update; short enough not to lose hits.
 */
export const GA_CONSENT_WAIT_FOR_UPDATE_MS = 500;

/** The gtag consent state a stored choice maps to. `null` = no choice yet. */
export function gaConsentParamsFor(
  consent: { analytics: boolean; marketing: boolean } | null | undefined
): GaConsentParams {
  if (!consent) return GA_CONSENT_DEFAULT;
  const ads: GaConsentValue = consent.marketing ? "granted" : "denied";
  return {
    analytics_storage: consent.analytics ? "granted" : "denied",
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
  };
}

/**
 * The inline script the root layout puts in <head>, before any gtag.js, so
 * the default is on the dataLayer before Google reads it. Idempotent: the
 * flag lets the client component tell whether it ran.
 */
export function gaConsentDefaultScript(): string {
  const params = JSON.stringify({
    ...GA_CONSENT_DEFAULT,
    wait_for_update: GA_CONSENT_WAIT_FOR_UPDATE_MS,
  });
  return (
    "window.dataLayer=window.dataLayer||[];" +
    "function gtag(){window.dataLayer.push(arguments)}" +
    "window.gtag=window.gtag||gtag;" +
    `gtag('consent','default',${params});` +
    "gtag('set','ads_data_redaction',true);" +
    "window.__mtGaConsentDefault=true;"
  );
}

/**
 * Props for a server-rendered <script>; null when GA4 is not configured.
 * It carries no nonce: the CSP admits it by hash (lib/security/csp.ts).
 */
export function gaConsentDefaultScriptProps(
  env: { measurementId?: string; mode?: string } = {
    measurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
    mode: process.env.NEXT_PUBLIC_GA_CONSENT_MODE,
  }
): { dangerouslySetInnerHTML: { __html: string } } | null {
  if (!env.measurementId || gaConsentModeFromEnv(env.mode) !== "advanced") return null;
  return { dangerouslySetInnerHTML: { __html: gaConsentDefaultScript() } };
}
