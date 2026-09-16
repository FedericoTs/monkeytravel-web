/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { POSTHOG_COOKIELESS_MODE, posthogActionFor } from "./posthog-consent";

describe("posthogActionFor", () => {
  it("does nothing before a choice: the SDK stays pending and captures nothing", () => {
    expect(posthogActionFor(null)).toBe("pending");
    expect(posthogActionFor(undefined)).toBe("pending");
  });

  it("opts in on analytics consent", () => {
    expect(posthogActionFor({ analytics: true })).toBe("opt_in");
  });

  it("goes cookieless, not silent, on essential-only", () => {
    expect(posthogActionFor({ analytics: false })).toBe("opt_out_cookieless");
  });

  it("pins the SDK mode the mapping was written for", () => {
    expect(POSTHOG_COOKIELESS_MODE).toBe("on_reject");
  });
});
