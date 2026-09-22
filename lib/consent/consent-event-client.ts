/**
 * Browser side of consent events: build the payload from the page and send
 * it without waiting. See consent-event-schema.ts for why these exist.
 */
import type { ConsentOrigin, ConsentState } from "./types";
import {
  bannerVariantFor,
  type ConsentEventKind,
  type ConsentEventPayload,
} from "./consent-event-schema";

/**
 * `opts.path` exists because reading window.location at SEND time attributes
 * an event fired around a client-side navigation to the page the visitor went
 * TO, not the one the banner was shown on. That is why the seven days to
 * 2026-09-22 show 245 minimisations against 219 impressions on trip/shared.
 * Callers inside the banner pass Next's `usePathname()`, which is the page
 * the component is keyed to.
 */
export function buildConsentEvent(
  kind: ConsentEventKind,
  consent: ConsentState | null,
  opts?: { origin?: ConsentOrigin; path?: string }
): ConsentEventPayload {
  const pathname =
    opts?.path ?? (typeof window !== "undefined" ? window.location.pathname : null);
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
  return {
    event: kind,
    variant: bannerVariantFor(pathname),
    analytics: consent ? consent.analytics : null,
    marketing: consent ? consent.marketing : null,
    sessionRecording: consent ? consent.sessionRecording : null,
    path: pathname ? pathname.split(/[?#]/)[0].slice(0, 120) : null,
    locale: /^[a-z]{2}(-[A-Z]{2})?$/.test(lang) ? lang : null,
    origin: opts?.origin ?? null,
  };
}

/**
 * Fire-and-forget. sendBeacon survives a navigation that starts right after
 * the click (the usual case for "Accept All" on a landing page); the fetch
 * fallback covers browsers that block beacons. Errors never reach the user.
 */
export function sendConsentEvent(payload: ConsentEventPayload): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/consent-event", blob)) return;
    }
  } catch {
    // fall through to fetch
  }
  try {
    void fetch("/api/consent-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Telemetry must never surface to the visitor.
  }
}
