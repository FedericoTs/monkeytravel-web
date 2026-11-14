/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ItineraryDay } from "@/types";

/**
 * "Delete everything" empties every day, as "leave day 2 free" empties one,
 * also when it is asked first and agreed to after: "Delete everything?" "Yes".
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

const day = (n: number) =>
  ({
    day_number: n,
    date: `2027-11-1${n}`,
    activities: [{ name: `Day ${n} sight`, time_slot: "morning", start_time: "10:00", duration_minutes: 90, location: "Rome" }],
  }) as unknown as ItineraryDay;
const days = [day(1), day(2)];
const emptied = (reply: string) => ({
  response: { text: () => JSON.stringify({ reply, edits: [{ day_number: 1, activities: [] }, { day_number: 2, activities: [] }] }) },
});
const base = { destination: "Rome, Italy", tripTitle: "Rome", days, locale: "it" };

let mod: typeof import("./engine");

beforeEach(async () => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  mod = await import("./engine");
});

afterEach(() => {
  vi.useRealTimers();
});

async function run(i: Parameters<typeof mod.assistTrip>[0]) {
  const p = mod.assistTrip(i);
  p.catch(() => {});
  await vi.runAllTimersAsync();
  return p;
}

describe("clearing the whole plan", () => {
  it("empties every day when asked to delete everything", async () => {
    generateContent.mockResolvedValue(emptied("Ho cancellato tutto il viaggio."));
    const out = await run({ ...base, message: "cancella tutto" });
    expect(out.edits.map((e) => [e.day_number, e.activities.length])).toEqual([
      [1, 0],
      [2, 0],
    ]);
    expect(out.reply).toContain("Ho cancellato tutto il viaggio.");
    expect(out.reply).not.toMatch(/Non ho modificato/);
  });

  it("empties every day on a yes to 'delete everything?'", async () => {
    generateContent.mockResolvedValue(emptied("Ho cancellato tutto il viaggio."));
    const history = [
      { role: "user" as const, text: "cancella tutto" },
      { role: "assistant" as const, text: "Vuoi cancellare tutto il viaggio?" },
    ];
    const out = await run({ ...base, message: "sì", history });
    expect(out.edits.map((e) => [e.day_number, e.activities.length])).toEqual([
      [1, 0],
      [2, 0],
    ]);
    // Not when what came before asked for nothing of the kind.
    const other = [
      { role: "user" as const, text: "aggiungi un museo il giorno 2" },
      { role: "assistant" as const, text: "Quale museo?" },
    ];
    const kept = await run({ ...base, message: "sì", history: other });
    expect(kept.edits).toEqual([]);
    expect(kept.reply).toMatch(/^Non ho modificato il tuo piano/);
  });
});
