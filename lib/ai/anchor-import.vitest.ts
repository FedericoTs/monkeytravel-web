import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Covers the parts of extractPlan that DON'T need a live model: the
 * pre-call guards (which decide whether we spend a Gemini call at all) and
 * the response handling (which decides what a malformed answer degrades to).
 *
 * The Gemini call itself is mocked — this suite is about our contract, not
 * Google's. anchor-import-core.vitest.ts already covers the normalization
 * that the route applies to whatever comes back.
 */

const generateContent = vi.fn();

vi.mock("@google/generative-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/generative-ai")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return { generateContent };
      }
    },
  };
});

const OPTS = {
  startDate: "2026-09-08",
  endDate: "2026-09-15",
  totalDays: 8,
  destination: "Venice, Italy",
};

function respond(payload: unknown) {
  generateContent.mockResolvedValueOnce({
    response: { text: () => JSON.stringify(payload) },
  });
}

let extractPlan: typeof import("./anchor-import").extractPlan;
let isPlanExtractError: typeof import("./anchor-import").isPlanExtractError;

beforeEach(async () => {
  generateContent.mockReset();
  const mod = await import("./anchor-import");
  extractPlan = mod.extractPlan;
  isPlanExtractError = mod.isPlanExtractError;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("extractPlan — guards before spending a model call", () => {
  it("rejects a too-short paste without calling Gemini", async () => {
    const r = await extractPlan("Venice", OPTS);
    expect(r).toEqual({ error: "too_short" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("rejects empty and whitespace-only input", async () => {
    for (const input of ["", "   ", "\n\n\t"]) {
      expect(await extractPlan(input, OPTS)).toEqual({ error: "too_short" });
    }
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("accepts a short but real plan — 25 chars is the floor, plans are terse", async () => {
    respond({ items: [{ date: "Day 1", title: "Land in Venice", type: "transport" }], undated: [] });
    const r = await extractPlan("Day 1 Venice, Day 5 fly home", OPTS);
    expect(isPlanExtractError(r)).toBe(false);
    expect(generateContent).toHaveBeenCalledOnce();
  });
});

describe("extractPlan — response handling degrades, never throws", () => {
  const PLAN = "Day 1: land in Venice 09:40. Day 4: night in Trieste. Day 8: fly home.";

  it("returns items and undated from a well-formed response", async () => {
    respond({
      items: [
        { date: "Day 1", title: "Land in Venice", type: "transport", time: "09:40" },
        { date: "Day 4", title: "Night in Trieste", type: "lodging" },
      ],
      undated: ["Uffizi at some point"],
    });
    const r = await extractPlan(PLAN, OPTS);
    if (isPlanExtractError(r)) throw new Error("expected success");
    expect(r.items).toHaveLength(2);
    expect(r.undated).toEqual(["Uffizi at some point"]);
  });

  it("maps a thrown Gemini call to extract_failed, not an exception", async () => {
    generateContent.mockRejectedValueOnce(new Error("503 model overloaded"));
    const r = await extractPlan(PLAN, OPTS);
    expect(r).toEqual({ error: "extract_failed" });
  });

  it("maps non-JSON output to extract_failed", async () => {
    generateContent.mockResolvedValueOnce({
      response: { text: () => "Sure! Here is your plan: ..." },
    });
    const r = await extractPlan(PLAN, OPTS);
    expect(r).toEqual({ error: "extract_failed" });
  });

  it("reports nothing_found when the model finds no plan at all", async () => {
    respond({ items: [], undated: [] });
    expect(await extractPlan(PLAN, OPTS)).toEqual({ error: "nothing_found" });
  });

  it("is NOT nothing_found when only undated items came back", async () => {
    // Undated-only is a real, useful outcome: those flow to the
    // requirements box. Treating it as failure would discard them.
    respond({ items: [], undated: ["see the Uffizi"] });
    const r = await extractPlan(PLAN, OPTS);
    if (isPlanExtractError(r)) throw new Error("expected success");
    expect(r.undated).toEqual(["see the Uffizi"]);
  });

  it("survives wrong-typed fields instead of throwing", async () => {
    respond({ items: "not an array", undated: { nope: true } });
    const r = await extractPlan(PLAN, OPTS);
    expect(r).toEqual({ error: "nothing_found" });
  });

  it("filters junk out of undated and caps the list", async () => {
    respond({
      items: [{ date: "Day 1", title: "Land", type: "transport" }],
      undated: ["  keep me  ", "", "   ", 42, null, "x".repeat(300), ...Array(30).fill("spam")],
    });
    const r = await extractPlan(PLAN, OPTS);
    if (isPlanExtractError(r)) throw new Error("expected success");
    expect(r.undated[0]).toBe("keep me");
    expect(r.undated.every((u) => typeof u === "string" && u.length > 0)).toBe(true);
    expect(r.undated.every((u) => u.length <= 120)).toBe(true);
    expect(r.undated.length).toBeLessThanOrEqual(20);
  });
});

describe("extractPlan — prompt context", () => {
  it("passes the trip range so the model can resolve 'Sept 11' and 'Day 4'", async () => {
    respond({ items: [], undated: ["something"] });
    await extractPlan("Day 1 Venice, Sept 11 Trieste, Day 8 home", OPTS);

    const call = generateContent.mock.calls[0][0];
    const userTurns = call.contents.filter((c: { role: string }) => c.role === "user");
    const context = userTurns[userTurns.length - 1].parts[0].text;
    expect(context).toContain("2026-09-08");
    expect(context).toContain("2026-09-15");
    expect(context).toContain("Venice, Italy");
  });
});
