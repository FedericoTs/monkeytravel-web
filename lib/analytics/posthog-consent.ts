/**
 * How a consent choice maps onto PostHog when the SDK runs in
 * `cookieless_mode: 'on_reject'` (2026-09-16).
 *
 * The SDK's own semantics (posthog-js 1.310, read from the source):
 *   - no choice yet   → consent PENDING: nothing is captured at all
 *   - opt_in_capturing  → cookies and local storage as usual
 *   - opt_out_capturing → cookieless: no cookie, no storage, identity is a
 *                         server-side hash that PostHog rotates daily, and
 *                         every event carries $cookieless_mode
 *
 * So "Essential Only" no longer means "invisible": it means counted without
 * anything stored on the device. alias() is dropped in cookieless mode and a
 * persistent distinct id is personal data, which is why identify() stays
 * gated on analytics consent (lib/posthog/identify.ts).
 *
 * REQUIRES the project setting "Cookieless server hash mode" (PostHog →
 * Project settings → Web analytics). Without it PostHog drops every
 * cookieless event on ingestion; the client code is the same either way.
 */

export const POSTHOG_COOKIELESS_MODE = "on_reject" as const;

export type PosthogConsentAction = "opt_in" | "opt_out_cookieless" | "pending";

export function posthogActionFor(
  consent: { analytics: boolean } | null | undefined
): PosthogConsentAction {
  if (!consent) return "pending";
  return consent.analytics ? "opt_in" : "opt_out_cookieless";
}
