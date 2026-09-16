/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { bannerVariantFor, parseConsentEvent } from "./consent-event-schema";

describe("bannerVariantFor", () => {
  it("is contextual on the wizard, trip pages and shared trips, in every locale", () => {
    for (const p of ["/trips/new", "/it/trips/new", "/trips/abc-123", "/es/trip/rome-x", "/shared/tok3n", "/pt/shared/tok3n"]) {
      expect(bannerVariantFor(p), p).toBe("contextual");
    }
  });

  it("is generic on content pages and when the path is unknown", () => {
    for (const p of ["/", "/blog/x", "/it/destinations/rome", "/tools/packing-list", "/tripsy", null, undefined, ""]) {
      expect(bannerVariantFor(p), String(p)).toBe("generic");
    }
  });
});

describe("parseConsentEvent", () => {
  it("accepts a decision with its flags, path and locale", () => {
    expect(
      parseConsentEvent({
        event: "accept_all",
        variant: "contextual",
        analytics: true,
        marketing: true,
        sessionRecording: false,
        path: "/it/trips/new?destination=tokyo#x",
        locale: "it",
      })
    ).toEqual({
      event: "accept_all",
      variant: "contextual",
      analytics: true,
      marketing: true,
      sessionRecording: false,
      path: "/it/trips/new",
      locale: "it",
    });
  });

  it("accepts an impression with no flags", () => {
    const parsed = parseConsentEvent({ event: "shown", path: "/blog/x" });
    expect(parsed).toMatchObject({ event: "shown", variant: "generic", analytics: null, marketing: null, sessionRecording: null, path: "/blog/x", locale: null });
  });

  it("rejects unknown events and non-objects", () => {
    expect(parseConsentEvent({ event: "hacked" })).toBeNull();
    expect(parseConsentEvent(null)).toBeNull();
    expect(parseConsentEvent("shown")).toBeNull();
    expect(parseConsentEvent({})).toBeNull();
  });

  it("coerces bad optional fields instead of failing", () => {
    const parsed = parseConsentEvent({ event: "minimized", variant: "weird", analytics: "yes", path: "javascript:alert(1)", locale: "IT" });
    expect(parsed).toEqual({ event: "minimized", variant: "generic", analytics: null, marketing: null, sessionRecording: null, path: null, locale: null });
  });

  it("caps the path length", () => {
    const parsed = parseConsentEvent({ event: "shown", path: "/" + "a".repeat(500) });
    expect(parsed?.path).toHaveLength(120);
  });
});
