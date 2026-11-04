// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig } from "@/lib/ai/config";

const recordUsage = vi.fn();
const incrementUsage = vi.fn();
vi.mock("@/lib/ai/usage", () => ({ recordUsage: (u: unknown) => recordUsage(u) }));
vi.mock("@/lib/usage-limits", () => ({ incrementUsage: (...args: unknown[]) => incrementUsage(...args) }));

const { recordTurnUsage } = await import("./turn-usage");

const chatModel = { id: "chat-model", costPer1kTokens: 2 } as ModelConfig;
const who = { userId: "user-1", tripId: "trip-1" };
const engine = { model: "engine-model", costUsd: 0.5 };
const chat = { prompt: "p".repeat(4000), text: "t".repeat(1001) };

beforeEach(() => {
  recordUsage.mockReset();
  incrementUsage.mockReset();
});

describe("a turn's usage", () => {
  it("is the engine's own report when its words were the reply", async () => {
    const spent = await recordTurnUsage({ ...who, action: "apply_draft", engine, chatModel, chat: null });
    expect(spent).toEqual({ inputTokens: 0, outputTokens: 0, costCents: 50 });
    expect(recordUsage).toHaveBeenCalledWith({ ...who, modelId: "engine-model", action: "apply_draft", ...spent });
  });

  it("is estimated from the chat call's text when the engine did not run", async () => {
    const spent = await recordTurnUsage({ ...who, action: undefined, engine: null, chatModel, chat });
    // 4,000 and 1,001 characters are 1,000 and 251 tokens, at 2 cents per 1,000.
    expect(spent).toEqual({ inputTokens: 1000, outputTokens: 251, costCents: 2.502 });
    expect(recordUsage).toHaveBeenCalledWith({ ...who, modelId: "chat-model", action: "answer_question", ...spent });
  });

  it("adds the engine's cost to a chat call that followed it, under the chat's model", async () => {
    const spent = await recordTurnUsage({ ...who, action: "add_day", engine, chatModel, chat });
    expect(spent.costCents).toBeCloseTo(52.502);
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ modelId: "chat-model", action: "add_day" }));
  });

  it("counts one assistant message toward the limit, once the usage is recorded", async () => {
    const order: string[] = [];
    recordUsage.mockImplementation(async () => order.push("recorded"));
    incrementUsage.mockImplementation(async () => order.push("counted"));
    await recordTurnUsage({ ...who, action: undefined, engine: null, chatModel, chat });
    expect(incrementUsage).toHaveBeenCalledWith("user-1", "aiAssistantMessages", 1);
    expect(order).toEqual(["recorded", "counted"]);
  });
});
