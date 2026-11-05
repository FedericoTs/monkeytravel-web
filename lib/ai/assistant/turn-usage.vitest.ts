// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordUsage = vi.fn();
const incrementUsage = vi.fn();
vi.mock("@/lib/ai/usage", () => ({ recordUsage: (u: unknown) => recordUsage(u) }));
vi.mock("@/lib/usage-limits", () => ({ incrementUsage: (...args: unknown[]) => incrementUsage(...args) }));

const { recordTurnUsage } = await import("./turn-usage");

const who = { userId: "user-1", tripId: "trip-1" };
const engine = { model: "engine-model", costUsd: 0.5 };
const chat = {
  model: "gemini-2.5-flash",
  usage: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 51 },
};

beforeEach(() => {
  recordUsage.mockReset();
  incrementUsage.mockReset();
});

describe("a turn's usage", () => {
  it("is the engine's own report when its words were the reply", async () => {
    const spent = await recordTurnUsage({ ...who, action: "apply_draft", engine, chat: null });
    expect(spent).toEqual({ inputTokens: 0, outputTokens: 0, costCents: 50 });
    expect(recordUsage).toHaveBeenCalledWith({ ...who, modelId: "engine-model", action: "apply_draft", ...spent });
  });

  it("is priced from the tokens the chat call used when the engine did not run", async () => {
    const spent = await recordTurnUsage({ ...who, action: undefined, engine: null, chat });
    // 1,000 tokens in at $0.30 per million, 251 out (thinking included) at $2.50.
    expect(spent.inputTokens).toBe(1000);
    expect(spent.outputTokens).toBe(251);
    expect(spent.costCents).toBeCloseTo(0.09275);
    expect(recordUsage).toHaveBeenCalledWith({ ...who, modelId: "gemini-2.5-flash", action: "answer_question", ...spent });
  });

  it("adds the engine's cost to a chat call that followed it, under the chat's model", async () => {
    const spent = await recordTurnUsage({ ...who, action: "add_day", engine, chat });
    expect(spent.costCents).toBeCloseTo(50.09275);
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ modelId: "gemini-2.5-flash", action: "add_day" }));
  });

  it("counts one assistant message toward the limit, once the usage is recorded", async () => {
    const order: string[] = [];
    recordUsage.mockImplementation(async () => order.push("recorded"));
    incrementUsage.mockImplementation(async () => order.push("counted"));
    await recordTurnUsage({ ...who, action: undefined, engine: null, chat });
    expect(incrementUsage).toHaveBeenCalledWith("user-1", "aiAssistantMessages", 1);
    expect(order).toEqual(["recorded", "counted"]);
  });
});
