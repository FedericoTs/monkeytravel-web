/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
vi.mock("@/lib/ai/gemini-call", () => ({
  genAI: { getGenerativeModel: () => ({ generateContent: (prompt: unknown) => generateContent(prompt) }) },
  withTimeout: <T,>(p: Promise<T>) => p,
}));
vi.mock("@/lib/ai/gemini-cost", () => ({ geminiCostUsd: () => 0.0002, recordGeminiUsage: () => {} }));

const { askForTransfers } = await import("./transfer-question");

const answer = (hops: unknown) => ({ response: { text: () => JSON.stringify({ hops }), usageMetadata: {} } });

beforeEach(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  generateContent.mockReset();
});
afterEach(() => {
  delete process.env.GOOGLE_AI_API_KEY;
});

describe("the question of how travellers make each hop", () => {
  it("names the whole route and each hop in order", async () => {
    generateContent.mockResolvedValueOnce(answer([]));
    await askForTransfers(["Barcelona", "Madrid", "Seville"]);
    const question = generateContent.mock.calls[0][0] as string;
    expect(question).toContain("A trip goes Barcelona -> Madrid -> Seville.");
    expect(question).toContain("1. Barcelona to Madrid\n2. Madrid to Seville");
    expect(question).toContain("train, flight, bus, car or ferry");
    expect(question).toContain("more than about 6 hours");
  });

  it("reads each hop by its number, and leaves out what isn't a way and a time", async () => {
    generateContent.mockResolvedValueOnce(
      answer([
        { n: 2, mode: "train", minutes: 165 },
        { n: 1, mode: "plane", minutes: 60 },
        { n: 3, mode: "bus", minutes: "about three hours" },
        { n: 2, mode: "flight", minutes: 70 },
        { n: 7, mode: "train", minutes: 60 },
        { n: 4, mode: "ferry", minutes: 119.6 },
      ])
    );
    const asked = await askForTransfers(["Barcelona", "Madrid", "Seville", "Granada", "Tangier"]);
    expect(asked.hops).toEqual([undefined, { mode: "train", minutes: 165 }, undefined, { mode: "ferry", minutes: 120 }]);
    expect(asked.costUsd).toBe(0.0002);
  });

  it("asks nothing for one city, or without a key", async () => {
    expect(await askForTransfers(["Rome"])).toEqual({ hops: [], costUsd: 0 });
    delete process.env.GOOGLE_AI_API_KEY;
    expect(await askForTransfers(["Rome", "Florence"])).toEqual({ hops: [], costUsd: 0 });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("leaves every hop to the estimate when the question fails or the answer can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    generateContent.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await askForTransfers(["Rome", "Florence"])).toEqual({ hops: [], costUsd: 0 });
    generateContent.mockResolvedValueOnce({ response: { text: () => "not json", usageMetadata: {} } });
    expect(await askForTransfers(["Rome", "Florence"])).toEqual({ hops: [], costUsd: 0 });
    generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify({ hops: "none" }), usageMetadata: {} } });
    expect((await askForTransfers(["Rome", "Florence"])).hops).toEqual([undefined]);
  });
});
