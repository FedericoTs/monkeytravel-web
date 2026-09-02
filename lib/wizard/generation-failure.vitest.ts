/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { classifyGenerationFailure } from "./generation-failure";

describe("validation — the bucket that means WE sent something the server refuses", () => {
  it("recognises the exact server strings from lib/gemini.ts", () => {
    // These are copied from validateTripParams; if that copy changes, this
    // fails and the label stops silently drifting to "unknown".
    expect(classifyGenerationFailure(new Error("Destination name too long"))).toBe("validation");
    expect(classifyGenerationFailure(new Error("Destination is required"))).toBe("validation");
    expect(classifyGenerationFailure(new Error("Destination contains invalid characters"))).toBe("validation");
  });

  it("is case-insensitive and tolerates wrapping", () => {
    expect(classifyGenerationFailure(new Error("Error: DESTINATION NAME TOO LONG"))).toBe("validation");
  });
});

describe("the other buckets", () => {
  it("separates the anonymous cap from a real failure", () => {
    expect(classifyGenerationFailure(new Error("RATE_LIMIT"))).toBe("rate_limit");
    expect(classifyGenerationFailure(new Error("429 Too Many Requests"))).toBe("rate_limit");
    expect(classifyGenerationFailure(new Error("You have reached your daily limit"))).toBe("rate_limit");
  });

  it("recognises timeouts, including an aborted request", () => {
    expect(classifyGenerationFailure(new Error("The request timed out"))).toBe("timeout");
    const aborted = new Error("signal is aborted without reason");
    aborted.name = "AbortError";
    expect(classifyGenerationFailure(aborted)).toBe("timeout");
  });

  it("recognises the browser's own network failures", () => {
    expect(classifyGenerationFailure(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyGenerationFailure(new Error("NetworkError when attempting to fetch resource"))).toBe("network");
    expect(classifyGenerationFailure(new Error("Load failed"))).toBe("network");
  });

  it("recognises server and model failures", () => {
    expect(classifyGenerationFailure(new Error("500 Internal Server Error"))).toBe("upstream");
    expect(classifyGenerationFailure(new Error("503 Service Unavailable"))).toBe("upstream");
    expect(classifyGenerationFailure(new Error("Gemini returned no candidates"))).toBe("upstream");
  });
});

describe("it would rather say nothing than say the wrong thing", () => {
  it("leaves anything unrecognised as unknown", () => {
    expect(classifyGenerationFailure(new Error("Something went wrong"))).toBe("unknown");
    expect(classifyGenerationFailure(new Error("¯\\_(ツ)_/¯"))).toBe("unknown");
  });

  it("never throws on a non-Error, and treats an empty message as unknown", () => {
    expect(classifyGenerationFailure(undefined)).toBe("unknown");
    expect(classifyGenerationFailure(null)).toBe("unknown");
    expect(classifyGenerationFailure({ weird: true })).toBe("unknown");
    expect(classifyGenerationFailure(new Error(""))).toBe("unknown");
    expect(classifyGenerationFailure("   ")).toBe("unknown");
  });

  it("accepts a bare string, which is what a rejected promise sometimes carries", () => {
    expect(classifyGenerationFailure("Destination name too long")).toBe("validation");
  });

  it("prefers validation when a message could match two buckets", () => {
    // "model" would otherwise pull this into upstream; the actionable half is
    // that we sent a destination the server refuses.
    expect(classifyGenerationFailure(new Error("Destination name too long for the model"))).toBe("validation");
  });
});
