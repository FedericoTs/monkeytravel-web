import { describe, it, expect, vi, beforeEach } from "vitest";

const track = vi.fn();
vi.mock("@vercel/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));

import {
  setContentGroup,
  trackItineraryGenerated,
  trackPlanKept,
  trackSignup,
  trackTripCreated,
  trackTripShared,
  trackUserReturn,
} from "./analytics";

const TRIP = { tripId: "trip-1", destination: "Lisbon", duration: 4, budgetTier: "balanced" } as const;

function walkTheFunnel() {
  trackItineraryGenerated({ destination: "Lisbon", duration: 4, budgetTier: "balanced", generationTimeMs: 9000 });
  trackPlanKept({ days: 4 });
  trackTripCreated(TRIP);
  trackSignup("google");
  trackTripShared({ tripId: "trip-1", shareMethod: "link" });
}

describe("funnel milestones reach GA4 and Vercel Web Analytics", () => {
  const gtag = vi.fn();

  beforeEach(() => {
    track.mockClear();
    gtag.mockClear();
    window.gtag = gtag;
  });

  it("sends each milestone to both tools under the same name", () => {
    walkTheFunnel();
    const names = ["itinerary_generated", "plan_kept", "trip_created", "sign_up", "share"];
    expect(track.mock.calls.map(([name]) => name)).toEqual(names);
    expect(gtag.mock.calls.map(([, name]) => name)).toEqual(names);
  });

  it("keeps Vercel events to two plain properties, with no destination or trip id", () => {
    walkTheFunnel();
    for (const [, props] of track.mock.calls) {
      expect(Object.keys(props).length).toBeLessThanOrEqual(2);
      for (const value of Object.values(props)) expect(["string", "number"]).toContain(typeof value);
    }
    const sent = JSON.stringify(track.mock.calls);
    expect(sent).not.toContain("Lisbon");
    expect(sent).not.toContain("trip-1");
  });

  it("says where a saved trip came from", () => {
    trackTripCreated(TRIP);
    trackTripCreated({ ...TRIP, isFromTemplate: true });
    trackTripCreated({ ...TRIP, isFromChatgpt: true });
    expect(track.mock.calls.map(([, props]) => props.from)).toEqual(["planner", "template", "chatgpt"]);
  });

  it("still reaches Vercel when GA4 is not on the page", () => {
    window.gtag = undefined;
    trackSignup("email");
    expect(track).toHaveBeenCalledWith("sign_up", { method: "email" });
  });
});

describe("what GA4 is told", () => {
  const gtag = vi.fn();

  beforeEach(() => {
    gtag.mockClear();
    window.gtag = gtag;
  });

  it("is what a saved trip is, with no money: nobody pays for a trip", () => {
    trackTripCreated({ ...TRIP, budgetTier: "premium" });
    expect(gtag).toHaveBeenCalledWith("event", "trip_created", {
      trip_id: "trip-1",
      destination: "Lisbon",
      duration_days: 4,
      budget_tier: "premium",
      is_from_template: false,
    });
  });

  it.each([
    [0, "same_day"],
    [1, "d1"],
    [3, "d2_7"],
    [30, "d8_30"],
    [31, "d30_plus"],
  ])("is how long a returning person was away (%i days), with no made-up source", (days, bucket) => {
    trackUserReturn({ daysSinceLastVisit: days });
    expect(gtag).toHaveBeenCalledWith("event", "user_return", { days_since_last_visit: days, return_bucket: bucket });
  });

  it("is a page's content group as a setting, not a second setup of the tag", () => {
    // A second config call would set the tag up again without the team's traffic_type.
    setContentGroup("blog");
    expect(gtag).toHaveBeenCalledOnce();
    expect(gtag).toHaveBeenCalledWith("set", { content_group: "blog" });
  });
});
