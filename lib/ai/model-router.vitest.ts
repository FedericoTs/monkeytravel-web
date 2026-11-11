import { afterEach, describe, expect, it } from "vitest";
import { ThinkingLevel } from "@/lib/ai/genai-compat";
import { getModelForPurpose, getSiblingModel, thinkingConfigFor, type GeminiModelId, type GeminiPurpose } from "./model-router";

/**
 * Each model gets the thinking setting it accepts: 2.5 models a token budget,
 * later ones a level (they refuse a budget or a level they don't have). The
 * override switches every purpose to a known model and ignores anything else.
 */

afterEach(() => {
  delete process.env.GEMINI_MODEL_OVERRIDE;
});

describe("thinkingConfigFor", () => {
  it("turns thinking off on 2.5 Flash and Flash-Lite", () => {
    expect(thinkingConfigFor("gemini-2.5-flash")).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfigFor("gemini-2.5-flash-lite")).toEqual({ thinkingBudget: 0 });
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
    expect(getModelForPurpose("trip-generation")).toBe("gemini-3.5-flash-lite");
    // 2.5 Pro is retired.
    process.env.GEMINI_MODEL_OVERRIDE = "gemini-2.5-pro";
    expect(getModelForPurpose("trip-generation")).toBe("gemini-3.5-flash-lite");
  });

  it("rolls back to 2.5 Flash, while it exists", () => {
    process.env.GEMINI_MODEL_OVERRIDE = "gemini-2.5-flash";
    expect(getModelForPurpose("trip-generation")).toBe("gemini-2.5-flash");
  });
});

describe("the models in use", () => {
  const purposes: GeminiPurpose[] = [
    "trip-generation",
    "day-regenerate",
    "activity-regenerate",
    "concierge",
    "packing-list",
    "email-parser",
    "trip-title",
    "activity-bank",
    "assistant-optimize",
    "assistant-edits",
    "assistant-chat",
    "anchor-import",
    "request-reading",
  ];
  // Both have no shutdown date. 3.1 Flash-Lite has one, and 2.5 Flash redirects
  // to 3.5 Flash-Lite with thinking settings it refuses.
  const lasting = ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];

  it("keeps every purpose, and its fallback, on a model with no shutdown date", () => {
    for (const purpose of purposes) {
      const model = getModelForPurpose(purpose);
      expect(lasting, purpose).toContain(model);
      expect(lasting, purpose).toContain(getSiblingModel(model));
    }
  });

  it("keeps a sibling a different model, which also falls back to a lasting one", () => {
    const models: GeminiModelId[] = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
    for (const model of models) expect(getSiblingModel(model)).not.toBe(model);
    expect(getSiblingModel("gemini-3.1-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(getSiblingModel("gemini-2.5-flash")).toBe("gemini-2.5-flash-lite");
  });
});
