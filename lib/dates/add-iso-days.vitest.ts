import { describe, it, expect } from "vitest";
import { addIsoDays } from "./iso-date";
import { addDaysISO as assistantAddDays } from "@/lib/ai/assistant/structural";
import { addDaysISO as multiCityAddDays, MultiCityError } from "@/lib/ai/multi-city-core";

describe("addIsoDays", () => {
  it("crosses month, year and leap-day boundaries in UTC", () => {
    expect(addIsoDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addIsoDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addIsoDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addIsoDays("2026-05-10", 0)).toBe("2026-05-10");
  });

  it("does not lose a day across the spring daylight-saving change", () => {
    expect(addIsoDays("2026-03-28", 2)).toBe("2026-03-30");
  });

  it("truncates a fractional day count", () => {
    expect(addIsoDays("2026-05-10", 2.9)).toBe("2026-05-12");
  });

  it("returns null for anything that is not a real YYYY-MM-DD date", () => {
    for (const bad of ["20220-05-01", "2026-02-31", "2026-5-1", "", "not a date"]) {
      expect(addIsoDays(bad, 1), bad).toBeNull();
    }
    expect(addIsoDays("2026-05-10", Number.NaN)).toBeNull();
  });
});

describe("the two callers keep their own error handling", () => {
  it("the assistant helper answers null for a missing or unparseable date", () => {
    expect(assistantAddDays(null, 1)).toBeNull();
    expect(assistantAddDays("nope", 1)).toBeNull();
    expect(assistantAddDays("2026-05-10", 3)).toBe("2026-05-13");
  });

  it("the multi-city helper throws its own error for a bad date", () => {
    expect(() => multiCityAddDays("20220-05-01", 1)).toThrow(MultiCityError);
    expect(multiCityAddDays("2026-05-10", 3)).toBe("2026-05-13");
  });
});
