import { describe, expect, it } from "vitest";
import { easterSunday } from "@/lib/ai/easter";

describe("Easter Sunday", () => {
  it("falls on the Western churches' date", () => {
    expect([2024, 2025, 2026, 2027, 2028, 2038].map((year) => easterSunday(year, "western"))).toEqual([
      "2024-03-31",
      "2025-04-20",
      "2026-04-05",
      "2027-03-28",
      "2028-04-16",
      "2038-04-25",
    ]);
  });

  it("falls on the Orthodox churches' date, in the Gregorian calendar", () => {
    expect([2024, 2025, 2026, 2027, 2028, 2029].map((year) => easterSunday(year, "orthodox"))).toEqual([
      "2024-05-05",
      "2025-04-20",
      "2026-04-12",
      "2027-05-02",
      "2028-04-16",
      "2029-04-08",
    ]);
  });
});
