import { describe, it, expect, vi } from "vitest";
import type { ItineraryDraft } from "@/hooks/useItineraryDraft";
import type { SessionTripSnapshot } from "@/hooks/useSessionTripStack";
import type { GeneratedItinerary, TripAnchor } from "@/types";
import { applyAnswers, applyDraft, applyKeptPlan, applySessionTrip, type DraftTargets } from "./apply-draft";
import { FRESH_ANSWERS } from "./answers";
import type { KeptPlan } from "@/lib/plans/kept-plan";

/**
 * Restoring a draft puts back everything saveDraft stored. The banner's
 * Restore once kept its own list and lost the trip's fixed plans (anchors).
 */

const itinerary = { days: [{ day_number: 1 }, { day_number: 2 }] } as unknown as GeneratedItinerary;
const anchors = [{ type: "lodging", date: "2027-05-01", title: "Hotel Lisboa" }] as unknown as TripAnchor[];

const fullDraft: ItineraryDraft = {
  generatedItinerary: itinerary,
  destination: "Lisbon, Portugal",
  startDate: "2027-05-01",
  endDate: "2027-05-02",
  pace: "relaxed",
  vibes: ["foodie"],
  budgetTier: "premium",
  travelStyle: "backpacker",
  anchors,
  mustDos: ["Tram 28"],
  dietary: ["vegan", "not-a-diet"],
  tripIntent: "group",
  flexibleDates: true,
  savedAt: 1,
};

function targets() {
  const fns = {
    setDestination: vi.fn(),
    setStartDate: vi.fn(),
    setEndDate: vi.fn(),
    setPace: vi.fn(),
    setSelectedVibes: vi.fn(),
    setBudgetTier: vi.fn(),
    setMustDos: vi.fn(),
    setDietary: vi.fn(),
    setTravelStyle: vi.fn(),
    setAnchors: vi.fn(),
    setTripIntent: vi.fn(),
    setFlexibleDates: vi.fn(),
    setGeneratedItinerary: vi.fn(),
    registerRestore: vi.fn(),
  } satisfies DraftTargets;
  return fns;
}

describe("applyDraft", () => {
  it("puts back every field a draft stores, the fixed plans included", () => {
    const to = targets();
    applyDraft(fullDraft, to);
    expect(to.setDestination).toHaveBeenCalledWith("Lisbon, Portugal");
    expect(to.setStartDate).toHaveBeenCalledWith("2027-05-01");
    expect(to.setEndDate).toHaveBeenCalledWith("2027-05-02");
    expect(to.setPace).toHaveBeenCalledWith("relaxed");
    expect(to.setSelectedVibes).toHaveBeenCalledWith(["foodie"]);
    expect(to.setBudgetTier).toHaveBeenCalledWith("premium");
    expect(to.setMustDos).toHaveBeenCalledWith(["Tram 28"]);
    expect(to.setDietary).toHaveBeenCalledWith(["vegan"]);
    expect(to.setTravelStyle).toHaveBeenCalledWith("backpacker");
    expect(to.setAnchors).toHaveBeenCalledWith(anchors);
    expect(to.setTripIntent).toHaveBeenCalledWith("group");
    expect(to.setFlexibleDates).toHaveBeenCalledWith(true);
    expect(to.setGeneratedItinerary).toHaveBeenCalledWith(itinerary);
    expect(to.registerRestore).toHaveBeenCalledWith({
      destination: "Lisbon, Portugal",
      startDate: "2027-05-01",
      endDate: "2027-05-02",
      dayCount: 2,
      itinerary,
      pace: "relaxed",
      vibes: ["foodie"],
      budgetTier: "premium",
      travelStyle: "backpacker",
      anchors,
      mustDos: ["Tram 28"],
      dietary: ["vegan"],
      tripIntent: "group",
      flexibleDates: true,
    });
  });

  it("every target is used by a full draft, so a new field can't be left out", () => {
    const to = targets();
    applyDraft(fullDraft, to);
    const unused = Object.entries(to).filter(([, fn]) => fn.mock.calls.length === 0).map(([name]) => name);
    expect(unused).toEqual([]);
  });

  it("an older draft without the optional fields leaves the wizard's defaults", () => {
    const to = targets();
    const old: ItineraryDraft = {
      generatedItinerary: itinerary,
      destination: "Lisbon, Portugal",
      startDate: "2027-05-01",
      endDate: "2027-05-02",
      pace: "relaxed",
      vibes: ["foodie"],
      budgetTier: "premium",
      savedAt: 1,
    };
    applyDraft(old, to);
    expect(to.setTravelStyle).not.toHaveBeenCalled();
    expect(to.setAnchors).not.toHaveBeenCalled();
    expect(to.setMustDos).not.toHaveBeenCalled();
    expect(to.setTripIntent).not.toHaveBeenCalled();
    expect(to.setFlexibleDates).not.toHaveBeenCalled();
    expect(to.setDietary).toHaveBeenCalledWith([]);
    const entry = to.registerRestore.mock.calls[0][0];
    expect(entry).toMatchObject({ travelStyle: "classic", dietary: [] });
    for (const lacking of ["anchors", "mustDos", "tripIntent", "flexibleDates"]) expect(entry).not.toHaveProperty(lacking);
  });
});

describe("applyKeptPlan", () => {
  const keptTargets = () => ({ ...targets(), setDestinationCoords: vi.fn(), setMultiCityMode: vi.fn() });
  const current = { pace: "moderate", vibes: ["cultural"], budgetTier: "balanced", tripIntent: "solo" as const };
  const plan: KeptPlan = {
    destination: "Lisbon, Portugal",
    startDate: "2027-05-01",
    endDate: "2027-05-02",
    itinerary,
    pace: "relaxed",
    vibes: ["foodie"],
    budgetTier: "premium",
    travelStyle: "backpacker",
    tripIntent: "group",
    flexibleDates: true,
    mustDos: ["Tram 28"],
    dietary: ["vegan"],
  };

  it("puts the whole plan on screen and makes it the tray's current trip", () => {
    const to = keptTargets();
    applyKeptPlan(plan, to, current);
    expect(to.setDestination).toHaveBeenCalledWith("Lisbon, Portugal");
    expect(to.setStartDate).toHaveBeenCalledWith("2027-05-01");
    expect(to.setEndDate).toHaveBeenCalledWith("2027-05-02");
    expect(to.setPace).toHaveBeenCalledWith("relaxed");
    expect(to.setSelectedVibes).toHaveBeenCalledWith(["foodie"]);
    expect(to.setBudgetTier).toHaveBeenCalledWith("premium");
    expect(to.setTravelStyle).toHaveBeenCalledWith("backpacker");
    expect(to.setTripIntent).toHaveBeenCalledWith("group");
    expect(to.setFlexibleDates).toHaveBeenCalledWith(true);
    expect(to.setMustDos).toHaveBeenCalledWith(["Tram 28"]);
    expect(to.setDietary).toHaveBeenCalledWith(["vegan"]);
    expect(to.setGeneratedItinerary).toHaveBeenCalledWith(itinerary);
    expect(to.registerRestore).toHaveBeenCalledWith({
      destination: "Lisbon, Portugal",
      startDate: "2027-05-01",
      endDate: "2027-05-02",
      dayCount: 2,
      itinerary,
      pace: "relaxed",
      vibes: ["foodie"],
      budgetTier: "premium",
      travelStyle: "backpacker",
      anchors: [],
      mustDos: ["Tram 28"],
      dietary: ["vegan"],
      tripIntent: "group",
      flexibleDates: true,
    });
  });

  it("replaces what the plan does not carry, where a draft would keep it", () => {
    const to = keptTargets();
    const bare: KeptPlan = { destination: "Porto", startDate: "2027-06-01", endDate: "2027-06-03", itinerary };
    applyKeptPlan(bare, to, current);
    expect(to.setAnchors).toHaveBeenCalledWith([]);
    expect(to.setDestinationCoords).toHaveBeenCalledWith(null);
    expect(to.setMultiCityMode).toHaveBeenCalledWith(false);
    expect(to.setTravelStyle).toHaveBeenCalledWith("classic");
    expect(to.setFlexibleDates).toHaveBeenCalledWith(false);
    expect(to.setMustDos).toHaveBeenCalledWith([]);
    expect(to.setDietary).toHaveBeenCalledWith([]);
  });

  it("keeps the wizard's pace, vibes and budget when the plan has none, and names them for the tray", () => {
    const to = keptTargets();
    const bare: KeptPlan = { destination: "Porto", startDate: "2027-06-01", endDate: "2027-06-03", itinerary, vibes: [] };
    applyKeptPlan(bare, to, current);
    expect(to.setPace).not.toHaveBeenCalled();
    expect(to.setSelectedVibes).not.toHaveBeenCalled();
    expect(to.setBudgetTier).not.toHaveBeenCalled();
    expect(to.setTripIntent).not.toHaveBeenCalled();
    expect(to.registerRestore).toHaveBeenCalledWith(
      expect.objectContaining({ pace: "moderate", vibes: [], budgetTier: "balanced", travelStyle: "classic", tripIntent: "solo" })
    );
  });
});

describe("applyAnswers", () => {
  it("sets every answer, as Start Over does with a fresh wizard's", () => {
    const { setGeneratedItinerary: _itinerary, registerRestore: _tray, ...to } = targets();
    applyAnswers(FRESH_ANSWERS, to);
    for (const [name, fn] of Object.entries(to)) expect(fn, name).toHaveBeenCalledTimes(1);
    expect(to.setDestination).toHaveBeenCalledWith("");
    expect(to.setPace).toHaveBeenCalledWith("moderate");
    expect(to.setBudgetTier).toHaveBeenCalledWith("balanced");
    expect(to.setTravelStyle).toHaveBeenCalledWith("classic");
    expect(to.setTripIntent).toHaveBeenCalledWith("unspecified");
    expect(to.setFlexibleDates).toHaveBeenCalledWith(false);
  });
});

describe("applySessionTrip", () => {
  const trayTargets = () => ({ ...targets(), setDestinationCoords: vi.fn(), setMultiCityMode: vi.fn() });
  const entry: SessionTripSnapshot = {
    id: "s1",
    createdAt: 1,
    destination: "Lisbon, Portugal",
    startDate: "2027-05-01",
    endDate: "2027-05-02",
    dayCount: 2,
    itinerary,
    pace: "relaxed",
    vibes: ["foodie"],
    budgetTier: "premium",
    travelStyle: "backpacker",
    anchors,
    mustDos: ["Tram 28"],
    dietary: ["vegan"],
    tripIntent: "group",
    flexibleDates: true,
  };

  it("puts the plan back with its own answers, in one city with no coordinates", () => {
    const to = trayTargets();
    applySessionTrip(entry, to);
    expect(to.setDestination).toHaveBeenCalledWith("Lisbon, Portugal");
    expect(to.setStartDate).toHaveBeenCalledWith("2027-05-01");
    expect(to.setEndDate).toHaveBeenCalledWith("2027-05-02");
    expect(to.setPace).toHaveBeenCalledWith("relaxed");
    expect(to.setSelectedVibes).toHaveBeenCalledWith(["foodie"]);
    expect(to.setBudgetTier).toHaveBeenCalledWith("premium");
    expect(to.setTravelStyle).toHaveBeenCalledWith("backpacker");
    expect(to.setAnchors).toHaveBeenCalledWith(anchors);
    expect(to.setMustDos).toHaveBeenCalledWith(["Tram 28"]);
    expect(to.setDietary).toHaveBeenCalledWith(["vegan"]);
    expect(to.setTripIntent).toHaveBeenCalledWith("group");
    expect(to.setFlexibleDates).toHaveBeenCalledWith(true);
    expect(to.setGeneratedItinerary).toHaveBeenCalledWith(itinerary);
    expect(to.setDestinationCoords).toHaveBeenCalledWith(null);
    expect(to.setMultiCityMode).toHaveBeenCalledWith(false);
  });

  it("sets every answer, so nothing of the plan it replaces stays", () => {
    const to = trayTargets();
    applySessionTrip(entry, to);
    const unused = Object.entries(to).filter(([, fn]) => fn.mock.calls.length === 0).map(([name]) => name);
    expect(unused).toEqual(["registerRestore"]);
  });

  it("gives an older entry's missing answers a fresh wizard's values", () => {
    const to = trayTargets();
    const { anchors: _a, mustDos: _m, dietary: _d, tripIntent: _t, flexibleDates: _f, travelStyle: _s, ...older } = entry;
    applySessionTrip(older, to);
    expect(to.setTravelStyle).toHaveBeenCalledWith("classic");
    expect(to.setAnchors).toHaveBeenCalledWith([]);
    expect(to.setMustDos).toHaveBeenCalledWith([]);
    expect(to.setDietary).toHaveBeenCalledWith([]);
    expect(to.setTripIntent).toHaveBeenCalledWith("unspecified");
    expect(to.setFlexibleDates).toHaveBeenCalledWith(false);
  });
});
