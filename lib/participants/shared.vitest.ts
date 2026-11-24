import { describe, expect, it } from "vitest";
import {
  initialsOf,
  isParticipantCookieId,
  normalizeDisplayName,
  normalizeEmail,
  normalizePicks,
  parseJoinAction,
  parseParticipantSource,
  readPicks,
} from "./shared";

describe("normalizePicks", () => {
  it("trims, single-spaces and bounds each pick, drops empties and repeats, and keeps three", () => {
    expect(normalizePicks(["  teamLab   Planets ", "", "Ichiran ramen", "TEAMLAB planets", "Shibuya Sky", "Ghibli Museum"])).toEqual([
      "teamLab Planets",
      "Ichiran ramen",
      "Shibuya Sky",
    ]);
    expect(normalizePicks(["x".repeat(100)])).toEqual(["x".repeat(80)]);
  });
  it("is null when no list was sent, and empty when the list holds nothing", () => {
    expect(normalizePicks(undefined)).toBeNull();
    expect(normalizePicks("teamLab Planets")).toBeNull();
    expect(normalizePicks([])).toEqual([]);
    expect(normalizePicks(["  ", 42, null])).toEqual([]);
  });
});

describe("readPicks", () => {
  it("is a stored list's texts, and nothing for anything else", () => {
    expect(readPicks(["Ghibli Museum", 3, "Ichiran ramen"])).toEqual(["Ghibli Museum", "Ichiran ramen"]);
    expect(readPicks(null)).toEqual([]);
    expect(readPicks("Ghibli Museum")).toEqual([]);
  });
});

describe("normalizeDisplayName", () => {
  it("trims, collapses spaces and bounds the length", () => {
    expect(normalizeDisplayName("  Ana   Lima ")).toBe("Ana Lima");
    expect(normalizeDisplayName("x".repeat(80))).toHaveLength(60);
  });
  it("returns null for empty or non-string input", () => {
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName(42)).toBeNull();
    expect(normalizeDisplayName(undefined)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lower-cases a valid address", () => {
    expect(normalizeEmail(" Ana@Example.COM ")).toBe("ana@example.com");
  });
  it("distinguishes absent (null) from invalid (false)", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("not an email")).toBe(false);
    expect(normalizeEmail("a@b")).toBe(false);
    expect(normalizeEmail("a@b.c d")).toBe(false);
    expect(normalizeEmail("x".repeat(250) + "@e.com")).toBe(false);
  });
});

describe("initialsOf", () => {
  it("uses first and last initials", () => {
    expect(initialsOf("Ana Lima")).toBe("AL");
    expect(initialsOf("ana maria lima")).toBe("AL");
    expect(initialsOf("Ana")).toBe("A");
  });
  it("ignores tokens that do not start with a letter or digit", () => {
    expect(initialsOf("Federico (pane)")).toBe("F");
    expect(initialsOf("Ana - Lima")).toBe("AL");
    expect(initialsOf("Ana Lima 2")).toBe("A2");
  });
  it("falls back to a question mark", () => {
    expect(initialsOf(null)).toBe("?");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("(...)")).toBe("?");
  });
});

describe("parsers", () => {
  it("accept only the known values", () => {
    expect(parseParticipantSource("shared")).toBe("shared");
    expect(parseParticipantSource("crew_ask")).toBe("crew_ask");
    expect(parseParticipantSource("owner")).toBeNull();
    expect(parseJoinAction("join")).toBe("join");
    expect(parseJoinAction("delete")).toBeNull();
    expect(parseJoinAction(1)).toBeNull();
  });
});

describe("isParticipantCookieId", () => {
  it("accepts what the join route mints and the column allows", () => {
    expect(isParticipantCookieId("V1StGXR8_Z5jdHi6B-myT")).toBe(true);
    expect(isParticipantCookieId("x".repeat(60))).toBe(true);
  });
  it("rejects missing, short and oversized values", () => {
    expect(isParticipantCookieId(undefined)).toBe(false);
    expect(isParticipantCookieId("")).toBe(false);
    expect(isParticipantCookieId("x".repeat(9))).toBe(false);
    expect(isParticipantCookieId("x".repeat(61))).toBe(false);
  });
});
