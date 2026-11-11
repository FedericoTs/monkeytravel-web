import { describe, expect, it } from "vitest";
import type { GeneratedItinerary } from "@/types";
import { keptPlanOf, sessionTripOf, tripFormState, withNote, withUndatedItems, type WizardAnswers } from "./answers";
import { REQUIREMENTS_MAX } from "@/lib/trips/request-limits";

const itinerary = { days: [{ day_number: 1 }, { day_number: 2 }, { day_number: 3 }] } as unknown as GeneratedItinerary;

const answers: WizardAnswers = {
  destination: "Lisbon, Portugal",
  startDate: "2027-05-10",
  endDate: "2027-05-12",
  pace: "relaxed",
  vibes: ["foodie", "cultural"],
  budgetTier: "premium",
  travelStyle: "backpacker",
  anchors: [{ id: "a1", type: "transport", title: "Land at LIS 09:40", date: "2027-05-10" }],
  mustDos: ["Belém tower"],
  dietary: ["vegan"],
  tripIntent: "group",
  flexibleDates: true,
};

describe("tripFormState", () => {
  it("writes every answer, with the derived interests and the locale", () => {
    const state = tripFormState(answers, { derivedInterests: ["food"], locale: "pt" });
    for (const [key, value] of Object.entries(answers)) expect(state).toHaveProperty(key, value);
    expect(state).toMatchObject({ derivedInterests: ["food"], locale: "pt" });
  });
});

describe("keptPlanOf", () => {
  it("keeps every answer but the anchors", () => {
    expect(keptPlanOf(answers, itinerary)).toEqual({
      destination: "Lisbon, Portugal",
      startDate: "2027-05-10",
      endDate: "2027-05-12",
      itinerary,
      pace: "relaxed",
      vibes: ["foodie", "cultural"],
      budgetTier: "premium",
      travelStyle: "backpacker",
      tripIntent: "group",
      flexibleDates: true,
      mustDos: ["Belém tower"],
      dietary: ["vegan"],
    });
  });

  it("leaves out an unanswered intent, fixed dates, and empty wishes and diets", () => {
    const plan = keptPlanOf({ ...answers, tripIntent: "unspecified", flexibleDates: false, mustDos: [], dietary: [] }, itinerary);
    expect(plan).not.toHaveProperty("tripIntent");
    expect(plan).not.toHaveProperty("flexibleDates");
    expect(plan).not.toHaveProperty("mustDos");
    expect(plan).not.toHaveProperty("dietary");
  });
});

describe("sessionTripOf", () => {
  it("holds every answer, the plan and its length", () => {
    expect(sessionTripOf(answers, itinerary)).toEqual({ ...answers, dayCount: 3, itinerary });
  });
});

describe("withUndatedItems", () => {
  it("adds the items as sentences after what is there", () => {
    expect(withUndatedItems("  Vegan food please ", ["Dinner at Belcanto", "Fado night"])).toBe(
      "Vegan food please. Dinner at Belcanto. Fado night"
    );
  });

  it("starts the requirements when there are none", () => {
    expect(withUndatedItems(" ", ["Fado night"])).toBe("Fado night");
  });

  it("stops at the requirements limit", () => {
    const merged = withUndatedItems("a".repeat(490), ["b".repeat(40)]);
    expect(merged).toHaveLength(REQUIREMENTS_MAX);
    expect(merged).toBe(`${"a".repeat(490)}. ${"b".repeat(8)}`);
  });
});

describe("withNote", () => {
  it("keeps a trip described in the destination field as a sentence of the requirements", () => {
    const sentence = "  Somewhere warm in Europe with two kids, near a beach, not too expensive  ";
    expect(withNote("", sentence)).toBe("Somewhere warm in Europe with two kids, near a beach, not too expensive");
    expect(withNote("Vegan food please", sentence)).toBe("Vegan food please. Somewhere warm in Europe with two kids, near a beach, not too expensive");
  });

  it("stops at the requirements limit", () => {
    expect(withNote("a".repeat(495), "b".repeat(200))).toHaveLength(REQUIREMENTS_MAX);
  });
});
