/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { askForReading, readingQuestion } from "./read-request";

describe("readingQuestion", () => {
  it("quotes the request, dates it and asks for names in the traveller's language", () => {
    const q = readingQuestion("Recife 6 dias com a família", "2026-11-10", "pt");
    expect(q).toContain('"""\nRecife 6 dias com a família\n"""');
    expect(q).toContain("Today is 2026-11-10, a Tuesday.");
    expect(q).toContain("as Google Maps names it in Portuguese");
  });
});

describe("askForReading", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("asks nothing without a model key", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    await expect(askForReading("Recife 6 dias com a família", "2026-11-10", "pt")).resolves.toEqual({ answer: null, costUsd: 0 });
  });
});
