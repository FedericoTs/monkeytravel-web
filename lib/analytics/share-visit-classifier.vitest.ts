/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { classifySharedVisit, CRAWLER_UA_RE } from "./share-visit-classifier";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const IN_APP_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36";

const recipient = {
  userAgent: IPHONE,
  secFetchDest: "document",
  purpose: null,
  secPurpose: null,
  isOwner: false,
  tripHasOwner: true,
};

describe("shared-visit classifier", () => {
  it("counts a recipient's document navigation", () => {
    expect(classifySharedVisit(recipient)).toBe("counted");
  });

  it("counts a client that sends no fetch metadata (in-app browsers, older webviews)", () => {
    expect(classifySharedVisit({ ...recipient, userAgent: IN_APP_ANDROID, secFetchDest: null })).toBe("counted");
  });

  it("skips a router fetch: the page renders again on the server without a visit", () => {
    expect(classifySharedVisit({ ...recipient, secFetchDest: "empty" })).toBe("skip:fetch");
  });

  it("skips speculative prefetches and prerenders", () => {
    expect(classifySharedVisit({ ...recipient, purpose: "prefetch" })).toBe("skip:prefetch");
    expect(classifySharedVisit({ ...recipient, secPurpose: "prefetch;prerender" })).toBe("skip:prefetch");
  });

  it("skips crawlers, link unfurlers and an empty user agent", () => {
    expect(classifySharedVisit({ ...recipient, userAgent: "facebookexternalhit/1.1" })).toBe("skip:crawler");
    expect(classifySharedVisit({ ...recipient, userAgent: "curl/8.4.0" })).toBe("skip:crawler");
    expect(classifySharedVisit({ ...recipient, userAgent: "" })).toBe("skip:crawler");
    expect(classifySharedVisit({ ...recipient, userAgent: null })).toBe("skip:crawler");
  });

  it("does not treat a chat app's in-app browser as a crawler", () => {
    // The preview crawler says "WhatsApp/2.x"; the human who taps the link
    // arrives with a normal mobile UA. Neither string is in the pattern.
    expect(classifySharedVisit({ ...recipient, userAgent: IN_APP_ANDROID })).toBe("counted");
    expect(CRAWLER_UA_RE.test("WhatsApp/2.24.10.85 A")).toBe(false);
  });

  it("skips the owner opening their own link", () => {
    expect(classifySharedVisit({ ...recipient, isOwner: true })).toBe("skip:owner");
  });

  it("skips the ownerless demo trips, whoever opens them", () => {
    expect(classifySharedVisit({ ...recipient, tripHasOwner: false })).toBe("skip:no-owner");
    expect(classifySharedVisit({ ...recipient, tripHasOwner: false, isOwner: true })).toBe("skip:no-owner");
  });

  it("reports the crawler verdict before any other", () => {
    expect(
      classifySharedVisit({ ...recipient, userAgent: "Googlebot/2.1", secFetchDest: "empty", isOwner: true, tripHasOwner: false })
    ).toBe("skip:crawler");
  });
});
