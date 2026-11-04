// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * "Add a day" on the trip page, when the edit engine can't: the next day,
 * planned around the trip's days for the user to confirm, moving the end date
 * with it. Nothing is generated for an editor (the dates are the owner's), past
 * the 14-day cap, or for a length the trip already has.
 */

const regenerateSingleDay = vi.fn();
vi.mock("@/lib/gemini", () => ({ regenerateSingleDay: (input: unknown) => regenerateSingleDay(input) }));
vi.mock("@/lib/places/places-to-eat", () => ({ placesToEatCheck: () => null }));

const { prepareAddDay } = await import("./add-day");

const day = (n: number, city?: string) =>
  ({ day_number: n, date: `2027-03-${String(10 + n).padStart(2, "0")}`, ...(city ? { city } : {}), activities: [] }) as unknown as ItineraryDay;
const trip = { end_date: "2027-03-13", budget: { tier: "budget" }, tags: ["foodie", "not-a-vibe"], trip_meta: { travel_style: "backpacker", dietary: ["vegan"] } };
const ask = (over: Partial<Parameters<typeof prepareAddDay>[0]> = {}) =>
  prepareAddDay({
    days: [day(1), day(2), day(3, "Howth")],
    requestedTotal: undefined,
    role: "owner",
    trip,
    destination: "Dublin, Ireland",
    message: "add a day to see Howth",
    language: "en",
    userId: "u1",
    ...over,
  });

beforeEach(() => {
  regenerateSingleDay.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("adding a day", () => {
  it("plans the next day around the trip's days, in the last day's city, and moves the end date", async () => {
    regenerateSingleDay.mockResolvedValue({ day_number: 4, date: "2027-03-14", activities: [] });
    const { action } = await ask();
    expect(regenerateSingleDay).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "Howth",
        dayNumber: 4,
        date: "2027-03-14",
        budgetTier: "budget",
        vibes: ["foodie"],
        travelStyle: "backpacker",
        profilePreferences: { dietaryPreferences: ["vegan"] },
        instructions: "add a day to see Howth",
      })
    );
    expect(action).toEqual({
      type: "add_day",
      applied: false,
      dayNumber: 4,
      newDay: { day_number: 4, date: "2027-03-14", activities: [], city: "Howth" },
      newEndDate: "2027-03-14",
    });
  });

  it("says why when the generation fails", async () => {
    regenerateSingleDay.mockRejectedValue(new Error("model down"));
    expect(await ask()).toEqual({ error: "Failed to generate the new day: model down" });
  });

  it("has nothing to extend on a trip without days", async () => {
    expect(await ask({ days: [] })).toEqual({ error: "This trip has no itinerary days yet, so there is nothing to extend" });
  });
});

describe("no day is added", () => {
  it("for an editor: the trip's dates are the owner's", async () => {
    const { note } = await ask({ role: "editor" });
    expect(note).toMatch(/Only the trip owner can add days/);
    expect(regenerateSingleDay).not.toHaveBeenCalled();
  });

  it("past the 14-day cap, asked or already there", async () => {
    expect((await ask({ requestedTotal: 20 })).note).toMatch(/extend the trip to 20 days, but trips are capped at 14 days\./);
    const fourteen = Array.from({ length: 14 }, (_, i) => day(i + 1));
    expect((await ask({ days: fourteen })).note).toMatch(/capped at 14 days and this trip already has 14/);
    expect(regenerateSingleDay).not.toHaveBeenCalled();
  });

  it("for a length the trip already has", async () => {
    expect((await ask({ requestedTotal: 3 })).note).toMatch(/asked for a 3-day trip but this trip already has 3 days/);
    expect(regenerateSingleDay).not.toHaveBeenCalled();
  });
});
