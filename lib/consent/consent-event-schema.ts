/**
 * Consent events: the one thing about the cookie banner nobody measured.
 *
 * WHY (2026-09-16)
 * After the banner started governing the tags (2026-09-02) GA4 fell to ~11%
 * of real visitors. The only stored consent choices were the ones signed-in
 * users made (users.cookie_consent), so the acceptance rate of the 99% of
 * traffic that is anonymous was unknowable, and nothing about the banner
 * could be tested. These events fix that: one row per banner impression,
 * minimisation and decision, with the banner variant and the page, no
 * identifier beyond the existing analytics session cookie.
 *
 * Pure module: shared by the API route (validation) and the client (payload),
 * and unit-tested.
 */

export const CONSENT_EVENT_KINDS = [
  "shown",
  "minimized",
  "accept_all",
  "essential_only",
  "settings_saved",
] as const;
export type ConsentEventKind = (typeof CONSENT_EVENT_KINDS)[number];

export const CONSENT_BANNER_VARIANTS = ["generic", "contextual"] as const;
export type ConsentBannerVariant = (typeof CONSENT_BANNER_VARIANTS)[number];

export interface ConsentEventPayload {
  event: ConsentEventKind;
  variant: ConsentBannerVariant;
  /** null for `shown` / `minimized`, where no choice has been made yet. */
  analytics: boolean | null;
  marketing: boolean | null;
  sessionRecording: boolean | null;
  /** Pathname only, never a query string. */
  path: string | null;
  locale: string | null;
}

/**
 * Which copy the banner shows. On the wizard, a trip page or a shared trip
 * the visitor is holding a plan, so the banner can say what the consent is
 * FOR ("help us improve your itineraries"). Everywhere else it is the
 * generic privacy card. Logged with every event so the two can be compared.
 */
export function bannerVariantFor(pathname: string | null | undefined): ConsentBannerVariant {
  if (!pathname) return "generic";
  return /\/(trips|trip|shared)(\/|$)/.test(pathname) ? "contextual" : "generic";
}

function safePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  return raw.split(/[?#]/)[0].slice(0, 120);
}

function safeLocale(raw: unknown): string | null {
  return typeof raw === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(raw) ? raw : null;
}

function boolOrNull(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

/** Strict: an unknown event or variant is rejected, everything else is coerced. */
export function parseConsentEvent(body: unknown): ConsentEventPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const event = b.event;
  if (typeof event !== "string" || !(CONSENT_EVENT_KINDS as readonly string[]).includes(event)) {
    return null;
  }
  const variantRaw = b.variant;
  const variant: ConsentBannerVariant =
    typeof variantRaw === "string" && (CONSENT_BANNER_VARIANTS as readonly string[]).includes(variantRaw)
      ? (variantRaw as ConsentBannerVariant)
      : "generic";
  return {
    event: event as ConsentEventKind,
    variant,
    analytics: boolOrNull(b.analytics),
    marketing: boolOrNull(b.marketing),
    sessionRecording: boolOrNull(b.sessionRecording),
    path: safePath(b.path),
    locale: safeLocale(b.locale),
  };
}
