import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The small structured calls: two tries on the purpose's model, then one on its
 * sibling. A model out of credit isn't asked again: every model refuses alike.
 */

const s = vi.hoisted(() => ({ asked: [] as string[], answers: [] as Array<() => unknown> }));

vi.mock("@/lib/ai/genai-compat", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel({ model }: { model: string }) {
      return {
        generateContent: async () => {
          s.asked.push(model);
          return (s.answers.shift() ?? (() => ({ response: { text: () => "ok" } })))();
        },
      };
    }
  },
}));

import { generateContentResilient } from "./resilient";
import { getModelForPurpose, getSiblingModel } from "./model-router";

const fails = (message: string) => () => {
  throw new Error(message);
};
const call = () =>
  generateContentResilient({ purpose: "packing-list", generationConfig: {}, contents: [], label: "test" });
const primary = getModelForPurpose("packing-list");

beforeEach(() => {
  s.asked.length = 0;
  s.answers.length = 0;
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generateContentResilient", () => {
  it("answers from the first try", async () => {
    const answer = await call();
    expect(answer).toMatchObject({ modelUsed: primary, attempts: 1 });
    expect(s.asked).toEqual([primary]);
  });

  it("rides out failures: the same model again, then its sibling", async () => {
    s.answers.push(fails("503 overloaded"), fails("503 overloaded"));
    const running = call();
    await vi.runAllTimersAsync();
    expect(await running).toMatchObject({ modelUsed: getSiblingModel(primary), attempts: 3 });
    expect(s.asked).toEqual([primary, primary, getSiblingModel(primary)]);
  });

  it("gives the last failure when all three fail", async () => {
    s.answers.push(fails("first"), fails("second"), fails("third"));
    const running = call().catch((err: Error) => err.message);
    await vi.runAllTimersAsync();
    expect(await running).toBe("third");
  });

  it("stops at once when the model is out of credit", async () => {
    const refusal = `{"error":{"code":402,"message":"Your prepayment credits are depleted."}}`;
    s.answers.push(fails(refusal));
    await expect(call()).rejects.toThrow("prepayment credits");
    expect(s.asked).toEqual([primary]);
  });
});
