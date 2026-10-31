import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";

/** The outline a long trip is written from, and how the trip is split into parts. */

let answer = "";
const prompts: string[] = [];
vi.mock("@/lib/ai/genai-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/genai-compat")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return {
          generateContent: async (prompt: string) => {
            prompts.push(prompt);
            return { response: { text: () => answer, usageMetadata: undefined } };
          },
        };
      }
    },
  };
});

const { generateTripOutline, splitIntoParts } = await import("./trip-outline");

const params = {
  destination: "Rome, Italy",
  startDate: "2027-05-01",
  endDate: "2027-05-03",
  budgetTier: "balanced",
  pace: "moderate",
  vibes: ["cultural"],
  interests: [],
} as TripCreationParams;

const day = (n: number, places: string[]) => ({ day_number: n, theme: `Theme ${n}`, area: `Area ${n}`, places });

beforeEach(() => {
  prompts.length = 0;
});

describe("splitIntoParts", () => {
  it.each([
    [3, ["1-3"]],
    [6, ["1-3", "4-6"]],
    [7, ["1-4", "5-7"]],
    [10, ["1-4", "5-7", "8-10"]],
    [14, ["1-4", "5-8", "9-11", "12-14"]],
  ])("splits %i days into %j", (total, expected) => {
    expect(splitIntoParts(total).map((p) => `${p.from}-${p.to}`)).toEqual(expected);
  });
});

describe("generateTripOutline", () => {
  it("keeps a place the model put on two days on the first one only", async () => {
    answer = JSON.stringify({ days: [day(1, ["Colosseum", "Roman Forum"]), day(2, ["colosseum!", "Pantheon"]), day(3, ["Trastevere"])] });
    const outline = await generateTripOutline(params, 3);
    expect(outline?.days.map((d) => d.places)).toEqual([["Colosseum", "Roman Forum"], ["Pantheon"], ["Trastevere"]]);
  });

  it("gives up when the days don't match the trip, so the trip is written in one piece", async () => {
    answer = JSON.stringify({ days: [day(1, ["Colosseum"]), day(3, ["Pantheon"])] });
    expect(await generateTripOutline(params, 3)).toBeNull();
    answer = "not json";
    expect(await generateTripOutline(params, 3)).toBeNull();
  });

  it("asks for themes in the page's language", async () => {
    answer = JSON.stringify({ days: [day(1, ["a"]), day(2, ["b"]), day(3, ["c"])] });
    await generateTripOutline(params, 3, "it");
    expect(prompts[0]).toContain("Write each theme and area in Italian.");
    await generateTripOutline(params, 3, "en");
    expect(prompts[1]).not.toContain("Write each theme and area");
  });

  it("builds the days from the places travellers kept, when there are some", async () => {
    answer = JSON.stringify({ days: [day(1, ["a"]), day(2, ["b"]), day(3, ["c"])] });
    await generateTripOutline(params, 3, "en", [
      { name: "Colosseum", type: "landmark" },
      { name: "Roscioli", type: "restaurant" },
    ]);
    expect(prompts[0]).toContain("Places travellers kept here");
    expect(prompts[0]).toContain("Colosseum; Roscioli.");
    await generateTripOutline(params, 3, "en");
    expect(prompts[1]).not.toContain("Places travellers kept here");
  });

  it("keeps every place to eat to the trip's diet", async () => {
    answer = JSON.stringify({ days: [day(1, ["a"]), day(2, ["b"]), day(3, ["c"])] });
    await generateTripOutline({ ...params, profilePreferences: { dietaryPreferences: ["vegan", "gluten-free"] } }, 3);
    expect(prompts[0]).toContain("Diet: vegan, gluten-free. Every place to eat must suit it.");
    await generateTripOutline(params, 3);
    expect(prompts[1]).not.toContain("Diet:");
  });
});
