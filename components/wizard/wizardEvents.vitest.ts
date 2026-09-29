// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { landingAttribution } from "./wizardEvents";

function setReferrer(value: string) {
  Object.defineProperty(document, "referrer", { value, configurable: true });
}

describe("landingAttribution", () => {
  afterEach(() => {
    setReferrer("");
    window.history.replaceState(null, "", "/trips/new");
  });

  it("keeps the referrer's host and path but never its query, and reads utm_source from the URL", () => {
    setReferrer("https://www.google.com/search?q=ai+trip+planner&token=secret");
    window.history.replaceState(null, "", "/it/trips/new?utm_source=newsletter&destination=Roma");
    expect(landingAttribution()).toEqual({ referrer: "www.google.com/search", utm_source: "newsletter" });
  });

  it("sends nothing when there is no referrer and no utm_source", () => {
    setReferrer("");
    expect(landingAttribution()).toEqual({});
  });

  it("drops a referrer it cannot parse and caps the lengths", () => {
    setReferrer("not a url");
    window.history.replaceState(null, "", `/trips/new?utm_source=${"x".repeat(100)}`);
    const out = landingAttribution();
    expect(out.referrer).toBeUndefined();
    expect(out.utm_source).toHaveLength(64);
  });
});
