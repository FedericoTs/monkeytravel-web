/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { classifyGenerationFailure, failureDetail, validationFix, validationFixStep } from "./generation-failure";

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

  it("recognises anchor validation from lib/ai/anchors-core.ts", () => {
    expect(
      classifyGenerationFailure(new Error('anchor "a1" (2026-10-02) falls outside the trip (2026-10-03 to 2026-10-06)'))
    ).toBe("validation");
    expect(classifyGenerationFailure(new Error("anchored trips support at most 14 days (got 20)"))).toBe("validation");
  });

  it("prefers validation when a message could match two buckets", () => {
    // "model" would otherwise pull this into upstream; the actionable half is
    // that we sent a destination the server refuses.
    expect(classifyGenerationFailure(new Error("Destination name too long for the model"))).toBe("validation");
  });
});

describe("server messages that used to fall through to unknown", () => {
  it("labels the rest of validateTripParams and validateAnchors as validation", () => {
    for (const message of [
      "Invalid characters in destination",
      "Invalid characters in requirements",
      "Invalid characters in must-dos",
      "Invalid input detected",
      "Requirements text too long (max 500 characters)",
      "Must-dos must be a list of at most 10 items",
      "Each must-do must be 1-80 characters",
      "Invalid destinations",
      "trip end (2026-10-01) is before trip start (2026-10-03)",
      'trip start: date must be YYYY-MM-DD (got "tomorrow")',
      'trip end: "2026-02-30" is not a valid calendar date',
    ]) {
      expect(classifyGenerationFailure(new Error(message))).toBe("validation");
    }
  });
});

describe("validationFix: what to change, and on which step", () => {
  it("sends date, length, destination and fixed-plan problems back to step 1", () => {
    expect(validationFix("Start date cannot be in the past")).toBe("dates");
    expect(validationFix("End date must be after start date")).toBe("dates");
    expect(validationFix("trip end (2026-10-01) is before trip start (2026-10-03)")).toBe("dates");
    expect(validationFix("Maximum trip duration is 14 days")).toBe("duration");
    expect(validationFix("anchored trips support at most 14 days (got 20)")).toBe("duration");
    expect(validationFix("Destination contains invalid characters")).toBe("destination");
    expect(validationFix("Invalid characters in destination")).toBe("destination");
    expect(validationFix('anchor "a1" (2026-10-02) falls outside the trip (2026-10-03 to 2026-10-06)')).toBe("fixed_plans");
    for (const fix of ["dates", "duration", "destination", "fixed_plans", "other"] as const) {
      expect(validationFixStep(fix)).toBe(1);
    }
  });

  it("sends notes and must-do problems to step 2, where those fields are", () => {
    expect(validationFix("Requirements text too long (max 500 characters)")).toBe("notes");
    expect(validationFix("Each must-do must be 1-80 characters")).toBe("notes");
    expect(validationFix("Invalid input detected")).toBe("notes");
    expect(validationFixStep("notes")).toBe(2);
  });

  it("falls back to other for a rule it does not know", () => {
    expect(validationFix("Budget tier must be one of budget, balanced, premium")).toBe("other");
  });
});

describe("failureDetail: the server's words, without what the traveller typed", () => {
  it("is recorded only for the buckets that need it", () => {
    expect(failureDetail(new Error("Something odd"), "unknown")).toBe("Something odd");
    expect(failureDetail(new Error("Start date cannot be in the past"), "validation")).toBe(
      "Start date cannot be in the past"
    );
    expect(failureDetail(new Error("Failed to fetch"), "network")).toBeUndefined();
    expect(failureDetail(new Error("AI service unavailable"), "upstream")).toBeUndefined();
  });

  it("blanks quoted values, which can be a hotel or a person's name", () => {
    const err = new Error('two overnight stays on 2026-10-05 ("Casa Maria" and "Hotel Sol") — a night can only end in one place');
    const detail = failureDetail(err, "validation") as string;
    expect(detail).not.toContain("Maria");
    expect(detail).not.toContain("Sol");
    expect(detail.startsWith('two overnight stays on 2026-10-05 ("" and "")')).toBe(true);
  });

  it("stays short and single-line, and says nothing when there is nothing to say", () => {
    expect(failureDetail(new Error("x".repeat(300)), "unknown")).toHaveLength(80);
    expect(failureDetail(new Error("line one\n  line two"), "unknown")).toBe("line one line two");
    expect(failureDetail(new Error(""), "unknown")).toBeUndefined();
    expect(failureDetail({ weird: true }, "unknown")).toBeUndefined();
  });
});
