import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({
  tripCreated: vi.fn(),
  wizardEvent: vi.fn(async (_step: string, _props: Record<string, unknown>) => {}),
  firstTripSaved: vi.fn(),
  referral: vi.fn(async (..._args: unknown[]) => {}),
}));
vi.mock("@/lib/analytics", () => ({ trackTripCreated: sent.tripCreated }));
vi.mock("@/lib/posthog/events", () => ({ captureFirstTripSaved: sent.firstTripSaved }));
vi.mock("@/lib/referral/client", () => ({ handleTripCreatedWithReferral: sent.referral }));
vi.mock("@/components/wizard/wizardEvents", () => ({ trackWizardEvent: sent.wizardEvent }));

import { reportTripSaved, type SavedTripReport } from "./trip-saved";

let n = 0;
const trip = (extra: Partial<SavedTripReport> = {}): SavedTripReport => ({
  tripId: `trip-${++n}`,
  durationDays: 5,
  destination: "Lisbon, Portugal",
  budgetTier: "balanced",
  tripIntent: "group",
  travelStyle: "backpacker",
  anchorCount: 2,
  locale: "it",
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("a trip's first save", () => {
  it("reaches GA4, the funnel, PostHog and the referral credit with the trip's answers", () => {
    const t = trip();
    reportTripSaved(t, "Auto-save");
    expect(sent.tripCreated).toHaveBeenCalledWith({ tripId: t.tripId, destination: "Lisbon, Portugal", duration: 5, budgetTier: "balanced", isFromTemplate: false });
    expect(sent.wizardEvent).toHaveBeenCalledWith("saved", { destination: "Lisbon, Portugal", duration_days: 5, group_size: "group", backpacker_mode: true, locale: "it" });
    expect(sent.firstTripSaved).toHaveBeenCalledWith({
      trip_id: t.tripId,
      destination: "Lisbon, Portugal",
      duration_days: 5,
      time_to_value_minutes: 0,
      from_template: false,
      is_anchored: true,
      anchor_count: 2,
    });
    expect(sent.referral).toHaveBeenCalledWith(t.tripId, "Lisbon, Portugal", 5, "balanced", false);
  });

  it("reads a classic trip without anchors as such", () => {
    reportTripSaved(trip({ travelStyle: "classic", anchorCount: 0, tripIntent: "solo" }), "Trip Save");
    expect(sent.wizardEvent.mock.calls[0][1]).toMatchObject({ backpacker_mode: false, group_size: "solo" });
    expect(sent.firstTripSaved.mock.calls[0][0]).toMatchObject({ is_anchored: false, anchor_count: 0 });
  });

  it("counts a single anchor as anchored", () => {
    reportTripSaved(trip({ anchorCount: 1 }), "Trip Save");
    expect(sent.firstTripSaved.mock.calls[0][0]).toMatchObject({ is_anchored: true, anchor_count: 1 });
  });

  it("is reported once per trip, whichever arm saves it again", () => {
    const t = trip();
    reportTripSaved(t, "Auto-save");
    reportTripSaved(t, "Trip Save");
    for (const fn of Object.values(sent)) expect(fn).toHaveBeenCalledTimes(1);
  });

  it("still credits the referral when PostHog throws, and says which arm", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sent.firstTripSaved.mockImplementationOnce(() => {
      throw new Error("posthog down");
    });
    reportTripSaved(trip(), "Trip Save");
    expect(sent.referral).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[Trip Save] first_trip_saved error:", expect.any(Error));
  });

  it("logs a failed referral credit under the arm's name", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sent.referral.mockRejectedValueOnce(new Error("network"));
    reportTripSaved(trip(), "Auto-save");
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("[Auto-save] referral/tracking error:", expect.any(Error)));
  });
});
