/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { classifySharedVisit, CRAWLER_UA_RE, sharedBySomeone } from "./share-visit-classifier";

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
  tripWasShared: true,
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
    // The human who taps the link arrives with a normal mobile browser, even one that names the app.
    expect(classifySharedVisit({ ...recipient, userAgent: IN_APP_ANDROID })).toBe("counted");
    expect(classifySharedVisit({ ...recipient, userAgent: `${IN_APP_ANDROID} WhatsApp/2.24.10.85`, secFetchDest: null })).toBe("counted");
    expect(CRAWLER_UA_RE.test("Mozilla/5.0 (Linux; Android 14) Chrome/125.0 Mobile Safari/537.36 Telegram-Android/11.2")).toBe(false);
  });

  it("skips the preview WhatsApp fetches when a link is pasted into a chat", () => {
    // Its user agent starts with the app's name, on a phone, on a computer and in the business app.
    for (const userAgent of ["WhatsApp/2.24.10.85 A", "WhatsApp/2.23.20.0", "WhatsApp/2.2412.54 W", "whatsapp/2.24.9.78 i"]) {
      expect(classifySharedVisit({ ...recipient, userAgent, secFetchDest: null })).toBe("skip:crawler");
    }
  });

  it("skips the owner opening their own link", () => {
    expect(classifySharedVisit({ ...recipient, isOwner: true })).toBe("skip:owner");
  });

  it("skips the demo trips, which nobody shared, whoever opens them", () => {
    expect(classifySharedVisit({ ...recipient, tripWasShared: false })).toBe("skip:demo");
    expect(classifySharedVisit({ ...recipient, tripWasShared: false, isOwner: true })).toBe("skip:demo");
  });

  it("takes a trip as shared by someone when it has an owner, or the claim of the signed-out planner who sent it", () => {
    expect(sharedBySomeone({ user_id: "owner-1", claim_token: null })).toBe(true);
    // A signed-out planner's share: no owner yet, a claim their browser holds.
    expect(sharedBySomeone({ user_id: null, claim_token: "a-claim" })).toBe(true);
    // A demo trip: neither.
    expect(sharedBySomeone({ user_id: null, claim_token: null })).toBe(false);
    expect(sharedBySomeone({})).toBe(false);
  });

  it("reports the crawler verdict before any other", () => {
    expect(
      classifySharedVisit({ ...recipient, userAgent: "Googlebot/2.1", secFetchDest: "empty", isOwner: true, tripWasShared: false })
    ).toBe("skip:crawler");
  });
});
