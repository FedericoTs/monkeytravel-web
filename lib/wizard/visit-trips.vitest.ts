// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTripSnapshot } from "@/hooks/useSessionTripStack";
import type { GeneratedItinerary } from "@/types";
import { forgetVisitToKeep, keepVisitTrips, markVisitToKeep, otherPlacesOfVisit, visitToKeep } from "./visit-trips";

/**
 * A signed-out planner who planned Rome, then Lisbon, then signed in to save Lisbon kept only Lisbon: the plans of
 * the visit live in the tab's session tray, and the sign-in saved the one on screen. Every distinct place of the
 * visit is kept now, each once.
 */

const itinerary = (name: string) => ({ destination: { name }, days: [] }) as unknown as GeneratedItinerary;
const trip = (id: string, destination: string, createdAt: number, over: Partial<SessionTripSnapshot> = {}): SessionTripSnapshot => ({
  id,
  destination,
  startDate: "2027-05-10",
  endDate: "2027-05-13",
  dayCount: 4,
  itinerary: itinerary(destination.split(",")[0]),
  pace: "moderate",
  vibes: ["cultural", "foodie"],
  budgetTier: "balanced",
  createdAt,
  ...over,
});

describe("otherPlacesOfVisit", () => {
  it("is the newest plan of each place besides the one on screen, oldest first", () => {
    const trips = [
      trip("rome-1", "Rome, Italy", 1),
      trip("porto", "Porto, Portugal", 2),
      trip("rome-2", "Rome", 3, { startDate: "2027-06-01", endDate: "2027-06-04" }),
      trip("lisbon", "Lisbon, Portugal", 4),
    ];
    expect(otherPlacesOfVisit(trips, { destination: "Lisbon, Portugal" }).map((t) => t.id)).toEqual(["porto", "rome-2"]);
  });

  it("leaves out every copy of the place on screen: a regenerated plan, other dates, a name without its country", () => {
    const trips = [
      trip("lisbon-1", "Lisbon", 1),
      trip("lisbon-2", "Lisbon, Portugal", 2, { startDate: "2027-05-11", endDate: "2027-05-14" }),
      trip("lisbon-3", "lisbon, portugal", 3),
    ];
    expect(otherPlacesOfVisit(trips, { destination: "Lisbon, Portugal" })).toEqual([]);
  });

  it("knows a place by the plan's own name too: a second one would be saved under the same title", () => {
    const trips = [
      trip("lisboa", "Lisboa", 1, { itinerary: itinerary("Lisbon") }),
      trip("roma", "Roma", 2, { itinerary: itinerary("Rome") }),
      trip("rome", "Rome, Italy", 3),
    ];
    expect(otherPlacesOfVisit(trips, { destination: "Lisbon, Portugal" }).map((t) => t.id)).toEqual(["rome"]);
    expect(otherPlacesOfVisit(trips, { destination: "Lisbon (Portugal)", itinerary: itinerary("Lisbon") }).map((t) => t.id)).toEqual(["rome"]);
  });

  it("is nothing without a place on screen", () => {
    expect(otherPlacesOfVisit([trip("rome", "Rome", 1)], { destination: "" })).toEqual([]);
  });
});

describe("the visit to keep, in the tab", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("holds the marked plans until it is forgotten", () => {
    markVisitToKeep(["rome", "porto"], 1_000);
    expect(visitToKeep(1_000 + 60_000)).toEqual(["rome", "porto"]);
    forgetVisitToKeep();
    expect(visitToKeep(1_000 + 60_000)).toEqual([]);
  });

  it("is forgotten after two hours, and a later mark takes an earlier one's place", () => {
    markVisitToKeep(["rome"], 1_000);
    expect(visitToKeep(1_000 + 2 * 3_600_000)).toEqual(["rome"]);
    expect(visitToKeep(1_000 + 2 * 3_600_000 + 1)).toEqual([]);
    markVisitToKeep(["rome"], 1_000);
    markVisitToKeep([], 2_000);
    expect(visitToKeep(2_000)).toEqual([]);
  });

  it("reads nothing from a mark that isn't one, and only the ids of one", () => {
    window.sessionStorage.setItem("mt_keep_visit", "{not json");
    expect(visitToKeep()).toEqual([]);
    window.sessionStorage.setItem("mt_keep_visit", JSON.stringify({ ids: "rome", at: Date.now() }));
    expect(visitToKeep()).toEqual([]);
    window.sessionStorage.setItem("mt_keep_visit", JSON.stringify({ ids: ["rome", 3, null], at: Date.now() }));
    expect(visitToKeep()).toEqual(["rome"]);
  });
});

describe("keepVisitTrips", () => {
  const deps = () => ({
    userId: "u1",
    locale: "it",
    isTwin: vi.fn(async (_userId: string, _trip: { destination: string }) => false),
    claimed: null as { destination: string; startDate: string; endDate: string } | null,
    save: vi.fn(async (input: { formState: { destination: string } }) => ({ tripId: `trip-${input.formState.destination}`, durationDays: 4 })),
    attachCover: vi.fn(async () => {}),
    onError: vi.fn(),
  });

  it("saves each marked plan in turn with its own answers, and says which it kept", async () => {
    const d = deps();
    const trips = [trip("rome", "Rome, Italy", 1, { tripIntent: "couple" }), trip("porto", "Porto, Portugal", 2)];
    const kept = await keepVisitTrips(["rome", "porto"], trips, d);
    expect(kept.map((t) => t.id)).toEqual(["rome", "porto"]);
    expect(d.save).toHaveBeenCalledTimes(2);
    expect(d.save.mock.calls[0][0]).toMatchObject({
      itinerary: trips[0].itinerary,
      formState: {
        destination: "Rome, Italy",
        startDate: "2027-05-10",
        endDate: "2027-05-13",
        vibes: ["cultural", "foodie"],
        tripIntent: "couple",
        derivedInterests: ["culture", "history", "art", "food"],
        locale: "it",
        mustDos: [],
        anchors: [],
      },
    });
    expect(d.attachCover).toHaveBeenCalledWith("trip-Rome, Italy", "Rome, Italy", trips[0].itinerary);
  });

  it("skips a plan the account already holds, one a share is claiming, and one gone from the tray", async () => {
    const d = deps();
    d.isTwin.mockImplementation(async (_userId: string, t: { destination: string }) => t.destination === "Rome, Italy");
    d.claimed = { destination: "porto, portugal", startDate: "2027-05-10", endDate: "2027-05-13" };
    const trips = [trip("rome", "Rome, Italy", 1), trip("porto", "Porto, Portugal", 2), trip("seville", "Seville, Spain", 3)];
    const kept = await keepVisitTrips(["rome", "porto", "gone", "seville"], trips, d);
    expect(kept.map((t) => t.id)).toEqual(["seville"]);
    expect(d.save).toHaveBeenCalledTimes(1);
  });

  it("goes on past a plan that fails to save, and reports it", async () => {
    const d = deps();
    d.save.mockRejectedValueOnce(new Error("network"));
    const trips = [trip("rome", "Rome, Italy", 1), trip("porto", "Porto, Portugal", 2)];
    const kept = await keepVisitTrips(["rome", "porto"], trips, d);
    expect(kept.map((t) => t.id)).toEqual(["porto"]);
    expect(d.onError).toHaveBeenCalledTimes(1);
  });
});
