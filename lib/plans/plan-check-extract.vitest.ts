// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A pasted plan read by the model: nothing it answers is taken on trust. */

const s = vi.hoisted(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  return { reply: "" as string, fails: null as Error | null, asked: [] as string[] };
});

vi.mock("@/lib/ai/genai-compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async (request: unknown) => {
          s.asked.push(JSON.stringify(request));
          if (s.fails) throw s.fails;
          return { response: { text: () => s.reply, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } } };
        },
      };
    }
  },
}));

const { extractPastedPlan, isPastedPlanError, readPastedPlan, MAX_PLAN_TEXT_CHARS } = await import("./plan-check-extract");

const TEXT = "Day 1: Colosseum, then lunch at Da Enzo in Trastevere.";

beforeEach(() => {
  s.reply = JSON.stringify({ destination: "Rome", days: [{ label: "Day 1", stops: [{ name: "Colosseum", where: "", type: "landmark", minutes: 0 }] }] });
  s.fails = null;
  s.asked = [];
});

describe("asking the model", () => {
  it("answers the plan it read", async () => {
    expect(await extractPastedPlan(TEXT)).toEqual({
      destination: "Rome",
      days: [{ label: "Day 1", stops: [{ name: "Colosseum", where: "", type: "landmark", minutes: null }] }],
    });
    expect(s.asked[0]).toContain("Da Enzo");
  });

  it("makes no call for what's too short to be a plan", async () => {
    expect(await extractPastedPlan("  Rome  ")).toEqual({ error: "too_short" });
    expect(s.asked).toEqual([]);
  });

  it("sends at most what it reads", async () => {
    await extractPastedPlan("x".repeat(MAX_PLAN_TEXT_CHARS + 500));
    expect(s.asked[0]).toContain("x".repeat(MAX_PLAN_TEXT_CHARS));
    expect(s.asked[0]).not.toContain("x".repeat(MAX_PLAN_TEXT_CHARS + 1));
  });

  it("says nothing was found when the text has no plan", async () => {
    s.reply = JSON.stringify({ destination: "", days: [] });
    expect(await extractPastedPlan(TEXT)).toEqual({ error: "nothing_found" });
  });

  it("says the read failed on an answer that isn't JSON", async () => {
    s.reply = "not json";
    expect(await extractPastedPlan(TEXT)).toEqual({ error: "extract_failed" });
  });

  it("says the read failed when the call does", async () => {
    s.fails = new Error("503 model overloaded");
    expect(await extractPastedPlan(TEXT)).toEqual({ error: "extract_failed" });
  });

  it("says the model is out of credit when it is", async () => {
    s.fails = new Error('Failed: AI service unavailable (root: {"error":{"code":402,"message":"Your prepayment credits are depleted"}})');
    expect(await extractPastedPlan(TEXT)).toEqual({ error: "model_outage" });
  });

  it("tells an error from a plan", () => {
    expect(isPastedPlanError({ error: "too_short" })).toBe(true);
    expect(isPastedPlanError({ destination: "", days: [] })).toBe(false);
  });
});

describe("what's taken from the answer", () => {
  it("nothing from something that isn't a plan", () => {
    for (const raw of [null, undefined, "x", 3, [], { days: "x" }, { days: [null, 3, { stops: "x" }] }]) {
      expect(readPastedPlan(raw)).toEqual({ destination: "", days: [] });
    }
  });

  it("drops stops with no name and days with no stops", () => {
    const plan = readPastedPlan({
      days: [
        { label: "Empty", stops: [] },
        { label: "Day 2", stops: [{ name: "  " }, null, { name: "Colosseum" }] },
      ],
    });
    expect(plan.days).toEqual([{ label: "Day 2", stops: [{ name: "Colosseum", where: "", type: "", minutes: null }] }]);
  });

  it("bounds what a long answer can hold", () => {
    const stops = Array.from({ length: 40 }, () => ({ name: "n".repeat(500), where: "w".repeat(500), type: "t".repeat(50), minutes: 99_999 }));
    const plan = readPastedPlan({
      destination: "d".repeat(500),
      days: Array.from({ length: 40 }, () => ({ label: "l".repeat(100), stops })),
    });
    expect(plan.destination).toHaveLength(120);
    expect(plan.days).toHaveLength(21);
    expect(plan.days[0].label).toHaveLength(40);
    expect(plan.days[0].stops).toHaveLength(15);
    expect(plan.days[0].stops[0]).toEqual({ name: "n".repeat(120), where: "w".repeat(160), type: "t".repeat(20), minutes: 1440 });
  });

  it("takes a time only when it's a real one", () => {
    const minutesOf = (minutes: unknown) => readPastedPlan({ days: [{ label: "", stops: [{ name: "x", minutes }] }] }).days[0].stops[0].minutes;
    expect(minutesOf(90.4)).toBe(90);
    for (const none of [0, -5, "90", null]) expect(minutesOf(none)).toBeNull();
  });
});
