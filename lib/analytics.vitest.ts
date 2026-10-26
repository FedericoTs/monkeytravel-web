import { describe, it, expect, vi, beforeEach } from "vitest";

const track = vi.fn();
vi.mock("@vercel/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));

import { trackItineraryGenerated, trackPlanKept, trackSignup, trackTripCreated, trackTripShared } from "./analytics";

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
