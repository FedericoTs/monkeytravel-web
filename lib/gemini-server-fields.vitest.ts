import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripCreationParams } from "@/types";

/** What the model no longer writes (booking links, part of the day, booking flags) the server fills in. */

const prompts: string[] = [];
const histories: string[] = [];
vi.mock("@/lib/ai/genai-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/genai-compat")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return {
          startChat: ({ history }: { history: { parts: { text: string }[] }[] }) => {
            histories.push(history.map((h) => h.parts.map((p) => p.text).join("")).join("\n"));
            return {
              sendMessageStream: async (prompt: string) => {
                prompts.push(prompt);
                return { stream: (async function* () {})(), response: Promise.resolve({ text: () => "{}", usageMetadata: undefined }) };
              },
            };
          },
        };
      }
    },
  };
});
vi.mock("@/lib/prompts", () => ({ getPrompt: async () => "system", DEFAULT_PROMPTS: {} }));
vi.mock("@/lib/posthog/llm-analytics", () => ({ captureLLMGeneration: async () => {}, estimateCost: () => 0 }));

const { generateItineraryStream } = await import("./gemini");
const { parseStreamedItinerary } = await import("./ai/itinerary-text");
const { bookingLinksFor, placeDays, withServerFields } = await import("./ai/server-fields");

const params = {
  destination: "Paris, France",
  startDate: "2027-05-01",
  endDate: "2027-05-04",
  budgetTier: "balanced",
  pace: "moderate",
  vibes: ["cultural"],
  interests: [],
} as TripCreationParams;

beforeEach(() => {
  prompts.length = 0;
  histories.length = 0;
});

describe("bookingLinksFor", () => {
  it("builds a flight search for the trip's dates and stays for its nights", () => {
    const links = bookingLinksFor(params);
    expect(links.flights.map((l) => l.url)).toEqual([
      "https://www.google.com/travel/flights?q=Flights%20to%20Paris%2C%20France%20on%202027-05-01%20through%202027-05-04",
    ]);
    expect(links.hotels.map((l) => l.url)).toEqual([
      "https://www.booking.com/searchresults.html?ss=Paris%2C%20France&checkin=2027-05-01&checkout=2027-05-04",
      "https://www.airbnb.com/s/Paris%2C%20France/homes?checkin=2027-05-01&checkout=2027-05-04",
    ]);
    expect(links.flights.map((l) => l.provider)).toEqual(["Google Flights"]);
    expect(links.hotels.map((l) => l.provider)).toEqual(["Booking.com", "Airbnb"]);
  });
});

describe("withServerFields", () => {
  const plan = () => ({
    destination: { name: "Paris", country: "France", description: "" },
    days: [
      {
        day_number: 1,
        date: "2027-05-01",
        theme: "t",
        activities: [
          { name: "Louvre", start_time: "09:00", booking_required: true },
          { name: "Lunch", start_time: "13:30" },
          { name: "Dinner", start_time: "19:15", time_slot: "afternoon" },
          { name: "Free time", time_slot: "evening" },
        ],
      },
    ],
  });

  it("gives each activity its part of the day from its start time, and booking_required false unless it was true", () => {
    const out = withServerFields(plan() as never, params);
    const activities = out.days[0].activities as unknown as { time_slot?: string; booking_required?: boolean }[];
    expect(activities.map((a) => a.time_slot)).toEqual(["morning", "afternoon", "evening", "evening"]);
    expect(activities.map((a) => a.booking_required)).toEqual([true, false, false, false]);
    expect(out.booking_links).toEqual(bookingLinksFor(params));
  });

  describe("the days' numbers and dates", () => {
    const acrossMonths = { ...params, startDate: "2026-11-29", endDate: "2026-12-02" };
    const day = (day_number: number, date: string, theme = "t") => ({ day_number, date, theme, activities: [] });
    const written = (days: ReturnType<typeof day>[], dates = acrossMonths) =>
      withServerFields({ ...plan(), days } as never, dates).days.map((d) => [d.day_number, d.date, d.theme]);

    it("are the trip's, whatever the model wrote: a month it counted wrong, a day it repeated", () => {
      expect(written([day(1, "2026-11-29"), day(2, "2026-11-30"), day(3, "2026-11-31"), day(3, "2026-12-01")])).toEqual([
        [1, "2026-11-29", "t"],
        [2, "2026-11-30", "t"],
        [3, "2026-12-01", "t"],
        [4, "2026-12-02", "t"],
      ]);
    });

    it("stop at the trip's last day, as the user chose its dates", () => {
      const five = [1, 2, 3, 4, 5].map((n) => day(n, "x", `day ${n}`));
      expect(written(five).map(([, date, theme]) => [date, theme])).toEqual([
        ["2026-11-29", "day 1"],
        ["2026-11-30", "day 2"],
        ["2026-12-01", "day 3"],
        ["2026-12-02", "day 4"],
      ]);
    });

    it("keep a shorter plan as it is, numbered from the first day", () => {
      expect(written([day(7, "x")])).toEqual([[1, "2026-11-29", "t"]]);
    });

    it("are left to the model when the trip's dates cannot be read", () => {
      const unreadable = { ...params, startDate: "soon", endDate: "later" };
      expect(written([day(1, "2026-11-29"), day(2, "2026-11-30")], unreadable)).toEqual([
        [1, "2026-11-29", "t"],
        [2, "2026-11-30", "t"],
      ]);
    });

    it("keep the model's date when a day cannot be worked out from the start", () => {
      expect(placeDays([day(9, "2026-11-30")], { from: 1, to: 1 }, "soon")).toEqual([day(1, "2026-11-30")]);
    });

    it("hold for a streamed plan too", () => {
      const text = JSON.stringify({ ...plan(), days: [day(1, "2026-11-30"), day(1, "2026-11-31")], trip_summary: { highlights: [] } });
      const out = parseStreamedItinerary(text, { ...acrossMonths, startDate: "2026-11-30", endDate: "2026-12-01" });
      expect(out.days.map((d) => [d.day_number, d.date])).toEqual([[1, "2026-11-30"], [2, "2026-12-01"]]);
    });
  });

  it("keeps booking links a plan already has", () => {
    const own = { flights: [], hotels: [] };
    expect(withServerFields({ ...plan(), booking_links: own } as never, params).booking_links).toBe(own);
  });

  it("is applied to a streamed plan", () => {
    const text = JSON.stringify({ ...plan(), trip_summary: { highlights: [] } });
    const out = parseStreamedItinerary(text, params);
    expect(out.booking_links?.hotels).toHaveLength(2);
    expect(out.days[0].activities[1].time_slot).toBe("afternoon");
  });
});

describe("the plan's prompt", () => {
  it("no longer asks for booking links or the part of the day, and asks for booking_required only when true", async () => {
    for await (const chunk of generateItineraryStream(params, {})) void chunk;
    const spec = histories[0];
    expect(spec).not.toContain("booking_links");
    expect(spec).not.toContain("time_slot");
    expect(spec).toContain('"booking_required": true only on an activity that must be booked ahead');
    expect(prompts[0]).not.toContain("Booking Link Values");
    expect(prompts[0]).not.toContain("{DEST_SLUG}");
  });
});
