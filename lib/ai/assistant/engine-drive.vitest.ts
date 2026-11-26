/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * "Travel by car for the whole trip" on a trip through two cities got the drives once, a talk about driving the
 * next time, and twice "I can't keep details like that" from the model. The engine now makes the change itself, the
 * same every time, without asking the model; anything else about the car still goes to the model.
 */

const generateContent = vi.fn();
vi.mock("@/lib/ai/genai-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/genai-compat")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return { generateContent: (req: unknown) => generateContent(req) };
      }
    },
  };
});
vi.mock("@/lib/ai/cache-metrics", () => ({ logCacheMetrics: vi.fn() }));

const { assistTrip } = await import("./engine");

const LISBON = { lat: 38.7223, lng: -9.1393 };
const PORTO = { lat: 41.1579, lng: -8.6291 };
const stop = (id: string, name: string, start_time: string, coordinates: { lat: number; lng: number }, type = "attraction") => ({
  id,
  name,
  start_time,
  time_slot: "morning",
  duration_minutes: 90,
  type,
  coordinates,
});
const days = [
  { day_number: 1, date: "2027-04-01", city: "Lisbon", activities: [stop("a1", "Belém Tower", "10:00", LISBON)] },
  {
    day_number: 2,
    date: "2027-04-02",
    city: "Porto",
    activities: [
      { id: "r1", name: "Train to Porto", type: "transport", transport_mode: "train", start_time: "08:30", time_slot: "morning", duration_minutes: 180, location: "Lisbon" },
      stop("b1", "Livraria Lello", "16:00", PORTO),
    ],
  },
] as unknown as ItineraryDay[];
const input = { destination: "Lisbon & Porto", tripTitle: "Portugal", days, startDate: "2027-04-01", locale: "en" };
const talk = {
  response: { text: () => JSON.stringify({ reply: "Driving from Lisbon to Porto takes about three hours.", edits: [] }), usageMetadata: {} },
};

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
  generateContent.mockResolvedValue(talk);
});

describe("assistTrip told they'll go by car for the whole trip", () => {
  it("puts a drive in place of the train, without asking the model", async () => {
    const out = await assistTrip({ ...input, message: "travel by car for the whole trip" });
    expect(generateContent).not.toHaveBeenCalled();
    expect(out.edits.map((e) => e.day_number)).toEqual([2]);
    expect(out.edits[0].activities.map((a) => a.name)).toEqual(["Drive to Porto", "Livraria Lello"]);
    expect(out.reply).toMatch(/^Here are the rides between your cities as drives: Lisbon to Porto, about \d+ h/);
    expect(out.meta).toMatchObject({ model: "none", costUsd: 0 });
  });

  it("answers in the language the traveller wrote in", async () => {
    const out = await assistTrip({ ...input, message: "vamos de carro a viagem toda" });
    expect(out.edits[0].activities[0].name).toBe("De carro para Porto");
    expect(out.reply.startsWith("Aqui estão os trajetos entre suas cidades de carro: de Lisbon para Porto")).toBe(true);
  });

  it("leaves a car on one hop, or a car weighed up, to the model", async () => {
    await assistTrip({ ...input, message: "we'll drive from Lisbon to Porto instead" });
    await assistTrip({ ...input, message: "is it better to drive?" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("asks the model when the trip has no ride to replace", async () => {
    const oneCity = [days[0], { ...days[0], day_number: 2, date: "2027-04-02" }] as ItineraryDay[];
    const out = await assistTrip({ ...input, days: oneCity, message: "travel by car for the whole trip" });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out.edits).toEqual([]);
  });
});
