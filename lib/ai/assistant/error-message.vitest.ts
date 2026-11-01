import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { assistantErrorMessage } from "./error-message";

/**
 * The trip assistant panel showed the routes' English error text to everyone.
 * It now shows a message from the catalog, picked by status and code.
 */

describe("assistantErrorMessage", () => {
  it("a usage limit names its period", () => {
    expect(assistantErrorMessage(429, { code: "RATE_LIMIT", usage: { periodType: "monthly" } })).toEqual({ key: "limitMonth" });
    expect(assistantErrorMessage(429, { code: "RATE_LIMIT", usage: { periodType: "daily" } })).toEqual({ key: "limitDay" });
    expect(assistantErrorMessage(429, null)).toEqual({ key: "limitDay" });
  });

  it("maps each route code to its message", () => {
    expect(assistantErrorMessage(403, { code: "NOT_ALLOWED" })).toEqual({ key: "notAllowed" });
    expect(assistantErrorMessage(403, { code: "DATES_OWNER_ONLY" })).toEqual({ key: "datesOwnerOnly" });
    expect(assistantErrorMessage(404, { code: "OUTDATED" })).toEqual({ key: "outdated" });
    expect(assistantErrorMessage(400, { code: "TOO_MANY_DAYS", max: 14 })).toEqual({ key: "tooManyDays", values: { max: 14 } });
  });

  it("names up to three fixed plans", () => {
    expect(assistantErrorMessage(400, { code: "LOCKED", names: ["Wedding", "Flight", "Hotel", "Dinner", 7] })).toEqual({
      key: "locked",
      values: { names: "Wedding, Flight, Hotel" },
    });
  });

  it("anything else gets the generic message", () => {
    expect(assistantErrorMessage(500, { error: "Failed to save changes" })).toBeNull();
    expect(assistantErrorMessage(400, { error: "Missing required fields" })).toBeNull();
    expect(assistantErrorMessage(400, { code: "TOO_MANY_DAYS" })).toBeNull();
    expect(assistantErrorMessage(502, "Bad gateway")).toBeNull();
  });

  it("every message key exists in all four languages", () => {
    const keys = ["limitDay", "limitMonth", "notAllowed", "datesOwnerOnly", "outdated", "locked", "tooManyDays", "applyFailed", "undoFailed"];
    for (const locale of ["en", "es", "it", "pt"]) {
      const assistant = JSON.parse(readFileSync(`messages/${locale}/common.json`, "utf8")).ai.assistant;
      for (const key of keys) expect(assistant.errors?.[key], `${locale} errors.${key}`).toBeTruthy();
      expect(assistant.tryDifferent, `${locale} tryDifferent`).toContain("{message}");
    }
  });
});
