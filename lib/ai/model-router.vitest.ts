import { afterEach, describe, expect, it } from "vitest";
import { ThinkingLevel } from "@/lib/ai/genai-compat";
import { getModelForPurpose, getSiblingModel, thinkingConfigFor, type GeminiModelId } from "./model-router";

/**
 * Each model gets the thinking setting it accepts: 2.5 models a token budget,
 * later ones a level (they refuse a budget or a level they don't have). The
 * override switches every purpose to a known model and ignores anything else.
 */

afterEach(() => {
  delete process.env.GEMINI_MODEL_OVERRIDE;
});

describe("thinkingConfigFor", () => {
  it("turns thinking off on 2.5 Flash and Flash-Lite, and gives 2.5 Pro its minimum", () => {
    expect(thinkingConfigFor("gemini-2.5-flash")).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfigFor("gemini-2.5-flash-lite")).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfigFor("gemini-2.5-pro")).toEqual({ thinkingBudget: 128 });
    expect(thinkingConfigFor("gemini-2.5-flash", 1024)).toEqual({ thinkingBudget: 1024 });
  });

  it("gives later models their lowest level, and low when some thinking is wanted", () => {
    expect(thinkingConfigFor("gemini-3.5-flash-lite")).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(thinkingConfigFor("gemini-3.6-flash")).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(thinkingConfigFor("gemini-3.1-flash-lite")).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    // 3.8 Flash has no minimal level.
    expect(thinkingConfigFor("gemini-3.8-flash")).toEqual({ thinkingLevel: ThinkingLevel.LOW });
    expect(thinkingConfigFor("gemini-3.5-flash-lite", 1024)).toEqual({ thinkingLevel: ThinkingLevel.LOW });
  });
});

describe("GEMINI_MODEL_OVERRIDE", () => {
  it("switches every purpose to a known model, later ones included", () => {
    process.env.GEMINI_MODEL_OVERRIDE = "gemini-3.5-flash-lite";
    expect(getModelForPurpose("trip-generation")).toBe("gemini-3.5-flash-lite");
    expect(getModelForPurpose("concierge")).toBe("gemini-3.5-flash-lite");
  });

  it("ignores an unknown model", () => {
    process.env.GEMINI_MODEL_OVERRIDE = "gemini-9-ultra";
    expect(getModelForPurpose("trip-generation")).toBe("gemini-2.5-flash");
  });

  it("gives every model a sibling of the same generation", () => {
    const models: GeminiModelId[] = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
    for (const model of models) expect(getSiblingModel(model)).toMatch(/^gemini-3\./);
    expect(getSiblingModel("gemini-2.5-flash")).toBe("gemini-2.5-flash-lite");
  });
});
