/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

const generateContent = vi.fn();
vi.mock("@/lib/ai/gemini-call", () => ({
  genAI: { getGenerativeModel: () => ({ generateContent: (prompt: unknown) => generateContent(prompt) }) },
  withTimeout: <T,>(p: Promise<T>) => p,
}));
vi.mock("@/lib/ai/gemini-cost", () => ({ geminiCostUsd: () => 0.0004, recordGeminiUsage: () => {} }));

const { askForRoute, planDays, routeOfferReply, routeQuestion, stopsOfDays } = await import("./route-reading");

// Lisbon days 1-7, Porto 8-14, from the trip's first date.
const trip = Array.from({ length: 14 }, (_, i) => ({
  day_number: i + 1,
  date: `2027-03-${String(10 + i).padStart(2, "0")}`,
  city: i < 7 ? "Lisboa" : "Porto",
  activities: [],
})) as unknown as ItineraryDay[];
const answer = (days: unknown) => ({ response: { text: () => JSON.stringify({ days }), usageMetadata: {} } });
const each = (...runs: Array<[string, number]>) => runs.flatMap(([city, n]) => Array.from({ length: n }, () => city));

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
});
afterEach(() => {
  delete process.env.GOOGLE_AI_API_KEY;
});

describe("the question about the route", () => {
  it("gives each day its date and city, the message, and the trip's length", () => {
    expect(planDays(trip).slice(6, 8)).toEqual(["Day 7 (2027-03-16): Lisboa", "Day 8 (2027-03-17): Porto"]);
    const q = routeQuestion("voltamos para lisboa em 18/03", trip, "2027-03-10", "pt");
    expect(q).toContain("voltamos para lisboa em 18/03");
    expect(q).toContain("from day 1 to day 14");
    expect(q).toContain("Google Maps names it in Portuguese");
  });

  it("dates days from the trip's start when they carry none", () => {
    const undated = trip.map(({ date: _date, ...d }) => d) as unknown as ItineraryDay[];
    expect(planDays(undated, "2027-03-10")[1]).toBe("Day 2 (2027-03-11): Lisboa");
  });
});

describe("stopsOfDays", () => {
  it("makes stops of the days, each with its country", () => {
    expect(stopsOfDays(each(["Lisboa, Portugal", 4], ["Porto, Portugal", 4], ["Lisboa, Portugal", 6]), 14)).toEqual([
      { name: "Lisboa", country: "Portugal", days: 4 },
      { name: "Porto", country: "Portugal", days: 4 },
      { name: "Lisboa", country: "Portugal", days: 6 },
    ]);
  });

  it("is no answer when it isn't one entry per day", () => {
    expect(stopsOfDays(each(["Lisboa, Portugal", 13]), 14)).toBeNull();
    expect(stopsOfDays([...each(["Lisboa, Portugal", 13]), ""], 14)).toBeNull();
    expect(stopsOfDays("Lisboa", 14)).toBeNull();
  });
});

describe("askForRoute", () => {
  it("offers the route a message tells, as stops with their days", async () => {
    generateContent.mockResolvedValueOnce(answer(each(["Lisboa, Portugal", 7], ["Porto, Portugal", 4], ["Lisboa, Portugal", 3])));
    const out = await askForRoute({ message: "the last 3 days back in Lisbon", days: trip, startDate: "2027-03-10" });
    expect(out.route.map((s) => [s.name, s.days])).toEqual([["Lisboa", 7], ["Porto", 4], ["Lisboa", 3]]);
    expect(out.costUsd).toBeGreaterThan(0);
  });

  it("offers nothing for the plan's own route, no days, or an answer it can't read", async () => {
    generateContent.mockResolvedValueOnce(answer(each(["Lisboa, Portugal", 7], ["Porto, Portugal", 7])));
    expect((await askForRoute({ message: "make day 9 relaxed", days: trip })).route).toEqual([]);
    generateContent.mockResolvedValueOnce(answer([]));
    expect((await askForRoute({ message: "how many days in Porto?", days: trip })).route).toEqual([]);
    generateContent.mockResolvedValueOnce({ response: { text: () => "not json", usageMetadata: {} } });
    expect((await askForRoute({ message: "back to Lisbon", days: trip })).route).toEqual([]);
  });

  it("reads as no new route when the question fails, or with no key", async () => {
    generateContent.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await askForRoute({ message: "back to Lisbon", days: trip })).toEqual({ route: [], costUsd: 0 });
    delete process.env.GOOGLE_AI_API_KEY;
    expect(await askForRoute({ message: "back to Lisbon", days: trip })).toEqual({ route: [], costUsd: 0 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

describe("routeOfferReply", () => {
  const route = [
    { name: "Lisboa", country: "Portugal", days: 7 },
    { name: "Porto", country: "Portugal", days: 1 },
  ];

  it("names each stop with its days, in the planner's language", () => {
    expect(routeOfferReply("en", route)).toBe(
      "Your new route: Lisboa (7 days) → Porto (1 day). Tap the button below and I'll plan the whole trip that way, for the same dates.",
    );
    expect(routeOfferReply("pt", route)).toContain("Lisboa (7 dias) → Porto (1 dia)");
    expect(routeOfferReply("es", route)).toContain("Lisboa (7 días) → Porto (1 día)");
    expect(routeOfferReply("it", route)).toContain("Lisboa (7 giorni) → Porto (1 giorno)");
  });
});
