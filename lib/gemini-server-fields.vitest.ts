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

const { generateItineraryStream, parseStreamedItinerary } = await import("./gemini");
const { bookingLinksFor, withServerFields } = await import("./ai/server-fields");

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
  it("builds the links the model used to copy from the templates", () => {
    const links = bookingLinksFor(params);
    expect(links.flights.map((l) => l.url)).toEqual([
      "https://www.skyscanner.com/transport/flights/nyc/paris/2027-05-01",
      "https://www.google.com/travel/flights?q=flights+to+Paris%2C%20France",
    ]);
    expect(links.hotels.map((l) => l.url)).toEqual([
      "https://www.booking.com/searchresults.html?ss=Paris%2C%20France&checkin=2027-05-01&checkout=2027-05-04",
      "https://www.airbnb.com/s/Paris%2C%20France/homes?checkin=2027-05-01&checkout=2027-05-04",
    ]);
    expect(links.flights.map((l) => l.provider)).toEqual(["Skyscanner", "Google Flights"]);
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
