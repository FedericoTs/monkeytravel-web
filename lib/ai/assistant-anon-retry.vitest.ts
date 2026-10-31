/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * A 503 "high demand" from Gemini used to fail the wizard assistant outright.
 * It now gets one retry on the sibling model; other errors still fail fast.
 */

const generateContent = vi.fn();
const modelsAsked: string[] = [];

vi.mock("@/lib/ai/genai-compat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/genai-compat")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel({ model }: { model: string }) {
        return {
          generateContent: (req: unknown) => {
            modelsAsked.push(model);
            return generateContent(req);
          },
        };
      }
    },
  };
});

vi.mock("@/lib/gemini", () => ({ logCacheMetrics: vi.fn() }));

const overloaded = () => Object.assign(new Error("This model is currently experiencing high demand."), { status: 503 });
const answer = () => ({ response: { text: () => JSON.stringify({ reply: "Done.", edits: [] }) } });
const day = (n: number) =>
  ({ day_number: n, date: `2027-11-1${n}`, activities: [{ name: `Day ${n} thing`, time_slot: "morning" }] }) as unknown as ItineraryDay;
const input = { message: "What is on day 1?", destination: "Rome, Italy", tripTitle: "Rome", days: [day(1), day(2)], locale: "en" };

let mod: typeof import("./assistant-anon");

beforeEach(async () => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
  modelsAsked.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  mod = await import("./assistant-anon");
});

afterEach(() => {
  vi.useRealTimers();
});

async function run(i = input) {
  const p = mod.assistTrip(i);
  // Handled by the caller's expect; marked here so it isn't reported early.
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

describe("assistTrip on an overloaded model", () => {
  it("answers from the sibling model after a 503", async () => {
    generateContent.mockRejectedValueOnce(overloaded()).mockResolvedValueOnce(answer());
    const out = await run();
    expect(modelsAsked).toEqual(["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
    expect(out.meta.model).toBe("gemini-2.5-flash-lite");
  });

  it("fails after one retry when both models are overloaded", async () => {
    generateContent.mockRejectedValue(overloaded());
    await expect(run()).rejects.toThrow("high demand");
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry an error that is the request's own", async () => {
    generateContent.mockRejectedValueOnce(Object.assign(new Error("Invalid argument"), { status: 400 }));
    await expect(run()).rejects.toThrow("Invalid argument");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

const edited = (n: number, names: string[]) => ({
  response: { text: () => JSON.stringify({ reply: "Done.", edits: [{ day_number: n, activities: names.map((name) => ({ name })) }] }) },
});

describe("assistTrip on a reply that breaks a rule", () => {
  const onDay1 = { ...input, message: "add a gelato stop on day 1" };
  const onDay2 = edited(2, ["Day 2 thing", "Gelato at Giolitti"]);

  it("asks once more with the rule spelled out and keeps the better reply", async () => {
    generateContent.mockResolvedValueOnce(onDay2).mockResolvedValueOnce(edited(1, ["Day 1 thing", "Gelato at Giolitti"]));
    const out = await run(onDay1);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("CORRECTION: The traveller named Day 1.");
    expect(out.edits.map((e) => e.day_number)).toEqual([1]);
  });

  it("keeps the first reply when the second try fails, with no third call", async () => {
    generateContent.mockResolvedValueOnce(onDay2).mockRejectedValueOnce(overloaded());
    const out = await run(onDay1);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(out.edits.map((e) => e.day_number)).toEqual([2]);
  });

  it("keeps the first reply when the request is already slow", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(30_000);
    generateContent.mockResolvedValueOnce(onDay2);
    const out = await run(onDay1);
    now.mockRestore();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out.edits.map((e) => e.day_number)).toEqual([2]);
  });
});

describe("assistTrip on a change about more days than one reply holds", () => {
  const days = Array.from({ length: 9 }, (_, i) => ({
    ...day(i + 1),
    activities: [{ name: `Day ${i + 1} thing`, time_slot: "morning", start_time: "09:00" }],
  })) as unknown as ItineraryDay[];
  const long = { ...input, message: "im gluten free", days };
  const daysReply = (days: number[], more: number[] = []) => ({
    response: {
      text: () =>
        JSON.stringify({
          reply: "Every day is gluten-free now.",
          more_days: more,
          edits: days.map((n) => ({ day_number: n, summary: `GF day ${n}`, activities: [{ name: `GF place ${n}` }] })),
        }),
    },
  });

  it("asks for the other days together and returns every day", async () => {
    generateContent.mockResolvedValueOnce(daysReply([1, 2, 3, 4, 5, 6], [7, 8, 9])).mockResolvedValueOnce(daysReply([7, 8, 9]));
    const out = await run(long);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(generateContent.mock.calls[1][0])).toContain("Now return Days 7, 8, 9");
    expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.reply).toBe("Every day is gluten-free now.");
  });

  it("names the days a part didn't bring back", async () => {
    generateContent.mockResolvedValueOnce(daysReply([1, 2, 3, 4, 5, 6], [7, 8, 9])).mockRejectedValueOnce(overloaded());
    const out = await run(long);
    expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.reply).toContain("Days 7, 8, 9 aren't changed yet");
  });

  it("keeps a day a part left as it was out of the change", async () => {
    const same = { response: { text: () => JSON.stringify({ reply: "ok", edits: [{ day_number: 7, activities: [{ name: "Day 7 thing", time_slot: "morning" }] }] }) } };
    generateContent.mockResolvedValueOnce(daysReply([1, 2, 3, 4, 5, 6], [7])).mockResolvedValueOnce(same);
    const out = await run(long);
    expect(out.edits.map((e) => e.day_number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.reply).toBe("Every day is gluten-free now.");
  });

  it("doesn't start the rest when the request is already slow, and says so", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(40_000);
    generateContent.mockResolvedValueOnce(daysReply([1, 2, 3, 4, 5, 6], [7, 8, 9]));
    const out = await run(long);
    now.mockRestore();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out.reply).toContain("Days 7, 8, 9 aren't changed yet");
  });
});

describe("isModelOverloaded", () => {
  it("is true only for 429, 500 and 503", () => {
    expect([429, 500, 503].map((status) => mod.isModelOverloaded({ status }))).toEqual([true, true, true]);
    expect([400, 401, 404].map((status) => mod.isModelOverloaded({ status }))).toEqual([false, false, false]);
    expect(mod.isModelOverloaded(new Error("no status"))).toBe(false);
    expect(mod.isModelOverloaded(null)).toBe(false);
  });
});
