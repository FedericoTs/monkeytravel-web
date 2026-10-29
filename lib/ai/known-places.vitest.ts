import { describe, expect, it } from "vitest";
import type { TripCreationParams } from "@/types";
import { knownPlacesUsed, pickKnownPlaces, rowsForDestination, type KnownPlaceRow } from "./known-places";

/** The places a new plan is built from first: the destination's, fitting the trip's settings. */

const row = (name: string, more: Partial<KnownPlaceRow> = {}): KnownPlaceRow => ({
  destination: "paris, france",
  place_key: name.toLowerCase().replace(/[^a-z0-9]/g, ""),
  name,
  type: "attraction",
  tier: "moderate",
  users: 3,
  plans: 2,
  vibes: {},
  ...more,
});

const trip = (more: Partial<TripCreationParams> = {}) =>
  ({
    destination: "Paris, France",
    startDate: "2027-05-01",
    endDate: "2027-05-03",
    budgetTier: "balanced",
    pace: "moderate",
    vibes: ["cultural"],
    interests: [],
    ...more,
  }) as TripCreationParams;

const names = (rows: KnownPlaceRow[], more?: Partial<TripCreationParams>, days = 3) =>
  pickKnownPlaces(rows, trip(more), days).map((p) => p.name);

const PARIS = [
  row("Louvre Museum", { type: "museum", users: 6, plans: 4, vibes: { cultural: 8 } }),
  row("Musée d'Orsay", { type: "museum", users: 5, plans: 4, vibes: { cultural: 7 } }),
  row("Sainte-Chapelle", { type: "landmark", users: 3, plans: 1, vibes: { cultural: 4 } }),
  row("Marché des Enfants Rouges", { type: "market", tier: "budget", users: 6, plans: 5, vibes: { foodie: 9 } }),
  row("Le Consulat", { type: "restaurant", users: 6, plans: 5, vibes: { foodie: 5, cultural: 4 } }),
  row("L'As du Fallafel", { type: "restaurant", tier: "budget", users: 3, plans: 2, vibes: { foodie: 4 } }),
  row("Du Pain et des Idées", { type: "cafe", tier: "budget", users: 3, plans: 3, vibes: { foodie: 5 } }),
  row("Parc des Buttes-Chaumont", { type: "park", tier: "free", users: 1, plans: 2, vibes: { nature: 3 } }),
];

describe("rowsForDestination", () => {
  it("joins the ways the destination is written", () => {
    const rows = [row("A", { destination: "paris" }), row("B", { destination: "paris, france" })];
    expect(rowsForDestination(rows, "Paris").map((r) => r.name)).toEqual(["A", "B"]);
    expect(rowsForDestination(rows, "Paris, France").map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("leaves out a namesake in another country", () => {
    const rows = [
      row("Spain", { destination: "valencia, spain", users: 9 }),
      row("Bare", { destination: "valencia" }),
      row("Venezuela", { destination: "valencia, venezuela", users: 1 }),
    ];
    expect(rowsForDestination(rows, "Valencia, Venezuela").map((r) => r.name)).toEqual(["Venezuela"]);
    expect(rowsForDestination(rows, "Valencia").map((r) => r.name)).toEqual(["Spain", "Bare"]);
  });

  it("never gives a place's places to a place that only starts the same", () => {
    expect(rowsForDestination([row("Louvre")], "Paris, Texas")).toEqual([]);
  });
});

describe("pickKnownPlaces", () => {
  it("offers one place for its spellings, named as most plans named it", () => {
    const rows = [
      row("Louvre Museum", { type: "museum", users: 8, plans: 3 }),
      row("Musée du Louvre", { type: "museum", users: 0, plans: 3 }),
      row("Ghibli Museum (Mitaka)", { type: "museum", plans: 4 }),
      row("Ghibli Museum", { type: "museum", plans: 2 }),
      row("Sainte-Chapelle", { type: "landmark" }),
      row("Sainte Chapelle", { type: "landmark", users: 0 }),
      row("Tegallalang Rice Terraces", { type: "nature", users: 0, vibes: { cultural: 2 } }),
      row("Tegalalang Rice Terrace", { type: "nature", users: 0, plans: 1, vibes: { cultural: 2 } }),
      row("Shibuya", { type: "attraction", users: 0 }),
      row("Shibuya Sky", { type: "attraction", users: 0, plans: 1 }),
    ];
    expect(names(rows)).toEqual([
      "Louvre Museum",
      "Ghibli Museum (Mitaka)",
      "Sainte-Chapelle",
      "Tegallalang Rice Terraces",
      "Shibuya",
      "Shibuya Sky",
    ]);
  });

  it("knows a place by the other name it gives in brackets, but not by a description", () => {
    const rows = [
      row("Sacred Monkey Forest Sanctuary", { type: "nature", users: 5 }),
      row("Ubud Monkey Forest (Sacred Monkey Forest Sanctuary)", { type: "nature" }),
      row("Jatiluwih Rice Terraces (UNESCO World Heritage Site)", { type: "nature" }),
      row("Besakih Temple (UNESCO World Heritage Site)", { type: "landmark", vibes: { nature: 4 } }),
    ];
    expect(names(rows, { vibes: ["nature"] }).sort()).toEqual([
      "Besakih Temple (UNESCO World Heritage Site)",
      "Jatiluwih Rice Terraces (UNESCO World Heritage Site)",
      "Sacred Monkey Forest Sanctuary",
    ]);
  });

  it("offers the places of the trip's vibes", () => {
    const foodie = names(PARIS, { vibes: ["foodie"] });
    expect(foodie[0]).toBe("Marché des Enfants Rouges");
    expect(foodie).not.toContain("Louvre Museum");
    expect(foodie).not.toContain("Parc des Buttes-Chaumont");
    const cultural = names(PARIS, { vibes: ["cultural"] });
    expect(cultural.slice(0, 2)).toEqual(["Louvre Museum", "Musée d'Orsay"]);
    expect(cultural).not.toContain("Parc des Buttes-Chaumont");
  });

  it("keeps a budget trip's meals cheap and a premium trip's meals no cheap eats", () => {
    const rows = [
      ...PARIS,
      row("Le Jules Verne", { type: "restaurant", tier: "premium", users: 4, plans: 4, vibes: { foodie: 6 } }),
    ];
    const budget = names(rows, { vibes: ["foodie"], budgetTier: "budget" });
    expect(budget).toContain("L'As du Fallafel");
    expect(budget).not.toContain("Le Consulat");
    expect(budget).not.toContain("Le Jules Verne");
    const premium = names(rows, { vibes: ["foodie"], budgetTier: "premium" });
    expect(premium).toContain("Le Jules Verne");
    expect(premium).not.toContain("L'As du Fallafel");
    expect(names(rows, { vibes: ["foodie"], travelStyle: "backpacker" })).not.toContain("Le Jules Verne");
  });

  it("offers about half of what the pace fills the days with, a known meal a day at most", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      row(`Place ${String.fromCharCode(65 + (i % 26))}${i}`, { type: i % 2 ? "restaurant" : "museum", vibes: { cultural: 3 } })
    );
    // Half the activities: 4 at least, 10 for 4 active days, 20 at most.
    expect(names(many, { pace: "relaxed" }, 2)).toHaveLength(4);
    expect(names(many, { pace: "moderate" }, 2)).toHaveLength(4);
    expect(names(many, { pace: "active" }, 4)).toHaveLength(10);
    expect(names(many, {}, 14)).toHaveLength(20);
    const picked = pickKnownPlaces(many, trip(), 2);
    expect(picked.filter((p) => p.type === "restaurant").length).toBeLessThanOrEqual(2);
  });

  it("offers nothing to an off-the-beaten-path trip, and half as much when it is a touch", () => {
    expect(names(PARIS, { vibes: ["offbeat"] })).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => row(`Sight ${i}`, { type: "museum", vibes: { cultural: 3 } }));
    expect(names(many, { vibes: ["cultural", "offbeat"] }, 3)).toHaveLength(3);
  });

  it("offers a fairytale trip only places fairytale trips had", () => {
    const rows = [
      row("Château de Vincennes", { type: "landmark", vibes: { fairytale: 2 } }),
      row("Louvre Museum", { type: "museum", users: 9, plans: 9 }),
      row("Sainte-Chapelle", { type: "landmark", vibes: { fairytale: 1 } }),
      row("Shakespeare and Company", { type: "shopping", vibes: { fairytale: 2 } }),
    ];
    expect(names(rows, { vibes: ["fairytale"] })).not.toContain("Louvre Museum");
  });

  it("leaves out what the traveller already asked for, areas, and comings and goings", () => {
    const rows = [
      ...PARIS,
      row("Dinner in Saint-Germain-des-Prés", { type: "restaurant", users: 9 }),
      row("Departure from Paris", { type: "transportation", users: 9 }),
      row("Check-in and Explore Le Marais", { type: "attraction", users: 9 }),
    ];
    const picked = names(rows, { mustDos: ["see the Louvre"] });
    expect(picked).not.toContain("Louvre Museum");
    expect(picked.join()).not.toMatch(/Dinner in|Departure|Check-in/);
  });

  it("offers nothing when too few places are known", () => {
    expect(names(PARIS.slice(0, 2))).toEqual([]);
  });
});

describe("knownPlacesUsed", () => {
  it("counts the plan's activities that are places it was offered", () => {
    const days = [
      { activities: [{ name: "Dinner at Le Consulat" }, { name: "Musée du Louvre" }, { name: "Arc de Triomphe" }] },
      { activities: [{ name: "Sainte Chapelle" }] },
    ];
    const offered = [
      { name: "Le Consulat", type: "restaurant" as const },
      { name: "Louvre Museum", type: "museum" as const },
      { name: "Sainte-Chapelle", type: "landmark" as const },
    ];
    expect(knownPlacesUsed(days, offered)).toBe(3);
  });
});
