import { describe, expect, it } from "vitest";
import { isModelOutageResponse, isModelOutOfCredit, MODEL_OUTAGE_CODE } from "./model-outage";

/** What Google's refusal looks like by the time it reaches each generation route. */
const ANSWER = `{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}`;

describe("a model out of credit", () => {
  it.each([
    ["the SDK's own error", new Error(ANSWER)],
    ["the JSON route's wrapped error, cut to its first 200 characters", new Error(`Failed to generate itinerary: AI service unavailable (root: ${ANSWER.slice(0, 200)})`)],
    ["the stream's nested error", new Error(`parts failed: {"error":{"message":${JSON.stringify(JSON.stringify(JSON.parse(ANSWER), null, 2))},"code":402,"status":"Payment Required"}}`)],
    ["the code alone, should Google reword it", new Error(`{"error":{"code": 402,"message":"Payment required"}}`)],
    ["the words alone, should the code move", new Error("Your prepayment credits are depleted.")],
    ["a thrown string", ANSWER],
  ])("is recognised from %s", (_name, error) => {
    expect(isModelOutOfCredit(error)).toBe(true);
  });

  it.each([
    ["a rate limit, which passes by itself", new Error(`{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}`)],
    ["a server error", new Error(`{"error":{"code":500,"message":"Internal error"}}`)],
    ["a code that only starts the same", new Error(`{"error":{"code":4020}}`)],
    ["a plan's own text", new Error("Failed to parse: 402 steps to the top of the tower")],
    ["no error at all", undefined],
  ])("isn't confused with %s", (_name, error) => {
    expect(isModelOutOfCredit(error)).toBe(false);
  });
});

describe("a failed AI response", () => {
  it("says the model is out of service with the code", () => {
    expect(isModelOutageResponse({ error: "unavailable", code: MODEL_OUTAGE_CODE })).toBe(true);
  });

  it.each([
    ["another code", { code: "RATE_LIMIT" }],
    ["no code", { error: "unavailable" }],
    ["no body", null],
    ["nothing", undefined],
  ])("doesn't say so with %s", (_name, body) => {
    expect(isModelOutageResponse(body)).toBe(false);
  });
});
