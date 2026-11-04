// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/**
 * The trip assistant's chat model answers JSON, mostly. A reply that isn't
 * becomes the summary, cut to 200 characters, so the chat still shows it.
 */

const logCacheMetrics = vi.fn();
vi.mock("@/lib/ai/cache-metrics", () => ({ logCacheMetrics: (...args: unknown[]) => logCacheMetrics(...args) }));

const { askChatModel } = await import("./chat-model");

const models: string[] = [];
const genAI = (text: string) =>
  ({
    getGenerativeModel: ({ model }: { model: string }) => {
      models.push(model);
      return { generateContent: async () => ({ response: { text: () => text, usageMetadata: { cachedContentTokenCount: 3 } } }) };
    },
  }) as never;

describe("the chat model's reply", () => {
  it("is read as the assistant's JSON, from the model asked, with its cache use logged", async () => {
    const text = 'Here you go: {"summary": "Day 2 is free-entry museums.", "cards": []}';
    const { reply, text: raw } = await askChatModel(genAI(text), "gemini-2.5-flash", "prompt");
    expect(reply).toEqual({ summary: "Day 2 is free-entry museums.", cards: [] });
    expect(raw).toBe(text);
    expect(models.at(-1)).toBe("gemini-2.5-flash");
    expect(logCacheMetrics).toHaveBeenCalledWith("ai.assistant.chat", { cachedContentTokenCount: 3 });
  });

  it("is its first 200 characters when it is not JSON, or not valid JSON", async () => {
    const long = "Sure! ".repeat(60);
    expect((await askChatModel(genAI(long), "m", "p")).reply).toEqual({ summary: long.slice(0, 200), cards: [] });
    expect((await askChatModel(genAI("{ summary: oops }"), "m", "p")).reply).toEqual({ summary: "{ summary: oops }", cards: [] });
  });
});
