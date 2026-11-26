import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "./trip-prompt";
import type { TripCreationParams } from "@/types";

/** A long trip's part is told the whole outline: each day's places, and where it has lunch and dinner. */

const params = {
  destination: "Rome, Italy",
  startDate: "2027-05-01",
  endDate: "2027-05-08",
  budgetTier: "balanced",
  pace: "moderate",
  vibes: ["cultural"],
  interests: [],
} as TripCreationParams;

const outline = [
  { day_number: 1, theme: "Ancient Rome", area: "Monti", places: ["Colosseum", "Roman Forum"], lunch: "La Taverna dei Fori Imperiali", dinner: "Ai Tre Scalini" },
  { day_number: 2, theme: "The Vatican", area: "Prati", places: ["Vatican Museums"], lunch: "Pizzarium", dinner: "" },
  { day_number: 3, theme: "Trastevere", area: "Trastevere", places: ["Santa Maria in Trastevere"] },
];

describe("a part of a long trip", () => {
  const prompt = buildUserPrompt(params, { part: { from: 2, to: 3, outline } });

  it("is told every day's places and its lunch and dinner, and only what a day has", () => {
    expect(prompt).toContain("- Day 1: Ancient Rome (Monti): Colosseum; Roman Forum; lunch at La Taverna dei Fori Imperiali; dinner at Ai Tre Scalini\n");
    expect(prompt).toContain("- Day 2: The Vatican (Prati): Vatican Museums; lunch at Pizzarium\n");
    expect(prompt).toContain("- Day 3: Trastevere (Trastevere): Santa Maria in Trastevere\n");
  });

  it("builds its days with their lunch and dinner, and never uses another day's place or restaurant", () => {
    expect(prompt).toContain("with lunch and dinner where the day has them. Never use a place or a restaurant listed for another day.");
  });
});
