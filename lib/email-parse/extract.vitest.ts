import { beforeEach, describe, expect, it, vi } from "vitest";

/** A pasted booking when the model call fails: a refusal no try can fix is told from any other failure. */

const generateContent = vi.fn();
vi.mock("@/lib/ai/genai-compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent };
    }
  },
}));

import { extractBooking } from "./extract";

const EMAIL = "Your hotel booking at Hotel Roma is confirmed for 10 May 2027. Reference ABC123. ".repeat(3);

beforeEach(() => {
  generateContent.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("extractBooking when the model call fails", () => {
  it("says the model is out of service when the credit ran out", async () => {
    generateContent.mockRejectedValue(new Error(`{"error":{"code":402,"message":"Your prepayment credits are depleted."}}`));
    expect(await extractBooking(EMAIL)).toEqual({ error: "model_outage" });
  });

  it("says it couldn't parse for anything else", async () => {
    generateContent.mockRejectedValue(new Error("503 model overloaded"));
    expect(await extractBooking(EMAIL)).toEqual({ error: "parse_failed" });
  });
});
