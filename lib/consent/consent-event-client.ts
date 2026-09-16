/**
 * Browser side of consent events: build the payload from the page and send
 * it without waiting. See consent-event-schema.ts for why these exist.
 */
import type { ConsentState } from "./types";
import {
  bannerVariantFor,
  type ConsentEventKind,
  type ConsentEventPayload,
} from "./consent-event-schema";

export function buildConsentEvent(
  kind: ConsentEventKind,
  consent: ConsentState | null
): ConsentEventPayload {
  const pathname = typeof window !== "undefined" ? window.location.pathname : null;
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
  return {
    event: kind,
    variant: bannerVariantFor(pathname),
    analytics: consent ? consent.analytics : null,
    marketing: consent ? consent.marketing : null,
    sessionRecording: consent ? consent.sessionRecording : null,
    path: pathname ? pathname.split(/[?#]/)[0].slice(0, 120) : null,
    locale: /^[a-z]{2}(-[A-Z]{2})?$/.test(lang) ? lang : null,
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
