/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { GeneratedItinerary } from "@/types";
import { anonymousShare } from "./anonymous-share";

const itinerary = {
  destination: { name: "Lisbon", country: "Portugal", description: "Lisbon in spring" },
  days: [{ day_number: 1 }, { day_number: 2 }],
  language: "pt",
} as unknown as GeneratedItinerary;

const plan = {
  itinerary,
  tripTitle: "Lisbon",
  destination: "Lisbon, Portugal",
  startDate: "2027-05-10",
  endDate: "2027-05-11",
  locale: "en",
  tripIntent: "unspecified" as const,
  sessionShareUrl: null,
};

describe("anonymousShare", () => {
  it("shares the plan in its own language, as a plain share", () => {
    expect(anonymousShare(plan)).toEqual({
      trip: {
        title: "Lisbon",
        description: "Lisbon in spring",
        destination: "Lisbon, Portugal",
        startDate: "2027-05-10",
        endDate: "2027-05-11",
        itinerary: itinerary.days,
        locale: "pt",
      },
      mode: "share",
      existingShareUrl: null,
    });
  });

  it("falls back to the page's language for a plan without one", () => {
    const share = anonymousShare({ ...plan, locale: "it", itinerary: { ...itinerary, language: undefined } as GeneratedItinerary });
    expect(share.trip.locale).toBe("it");
  });

  it("asks a group's crew to vote, on the link already made", () => {
    const share = anonymousShare({ ...plan, tripIntent: "group", sessionShareUrl: "https://monkeytravel.app/shared/abc" });
    expect([share.mode, share.existingShareUrl]).toEqual(["crew", "https://monkeytravel.app/shared/abc"]);
    expect(anonymousShare({ ...plan, tripIntent: "solo" }).mode).toBe("share");
  });
});
