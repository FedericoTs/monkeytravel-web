/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { META_DESCRIPTION_MAX, clipMetaDescription } from "./meta-description";

/** 55 of 82 public trips had a description over 160 characters. */
describe("clipMetaDescription", () => {
  it("leaves a short description alone, whitespace aside", () => {
    expect(clipMetaDescription("  Five days in   Rome,\nslowly. ")).toBe("Five days in Rome, slowly.");
  });

  it("cuts a long one at a word boundary, within the limit", () => {
    const long = "A week across Kyoto and Osaka with temples at dawn, ".repeat(6);
    const out = clipMetaDescription(long);
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
    expect(out).not.toMatch(/[\s,]…$/);
  });

  it("still cuts text with no spaces", () => {
    const out = clipMetaDescription("x".repeat(300));
    expect(out.length).toBe(META_DESCRIPTION_MAX);
  });
});
