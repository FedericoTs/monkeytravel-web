/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDateFull, formatDateRange, formatDateRangeWithWeekdays, formatDateShort, formatDateWithWeekday } from "./format";

describe("formatDateRange", () => {
  it("names the month in the page's language", () => {
    expect(formatDateRange("2026-11-24", "2026-11-25", "en")).toBe("Nov 24 – 25, 2026");
    expect(formatDateRange("2026-11-24", "2026-11-25", "it")).toBe("24–25 nov 2026");
    expect(formatDateRange("2026-10-30", "2026-11-02", "en")).toBe("Oct 30 – Nov 2, 2026");
  });

  // Every locale used to get English order: "ott 31 - nov 2, 2026".
  it("puts day, month and year in the locale's order", () => {
    expect(formatDateRange("2026-10-31", "2026-11-02", "it")).toBe("31 ott – 2 nov 2026");
    expect(formatDateRange("2026-10-31", "2026-11-02", "es")).toBe("31 oct – 2 nov 2026");
    expect(formatDateRange("2026-10-31", "2026-11-02", "pt")).toBe("31 de out. – 2 de nov. de 2026");
    expect(formatDateRange("2026-12-30", "2027-01-02", "it")).toBe("30 dic 2026 – 2 gen 2027");
  });

  it("shows a one-day trip as its day", () => {
    expect(formatDateRange("2026-09-30", "2026-09-30", "en")).toBe("Sep 30, 2026");
    expect(formatDateRange("2026-09-30", "2026-09-30", "it")).toBe("30 set 2026");
  });

  it("never throws on a date it can't read", () => {
    expect(formatDateRange("not-a-date", "2026-10-04", "it")).toBe("");
    expect(formatDateRange("2026-10-01", "not-a-date", "it")).toBe("1 ott 2026");
    expect(formatDateRange("2026-10-04", "2026-10-01", "it")).toBe("4 ott 2026");
  });
});

// A trip date is a calendar day. West of UTC, reading "2026-10-01" as UTC
// midnight printed it a day early.
describe("trip days west of UTC", () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Chicago";
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it("keep their day", () => {
    expect(formatDateWithWeekday("2026-10-01")).toBe("Thu, Oct 1");
    expect(formatDateFull("2026-10-01")).toBe("Thu, Oct 1, 2026");
    expect(formatDateShort("2026-10-01")).toBe("Oct 1");
    expect(formatDateRangeWithWeekdays("2026-10-01", "2026-10-04")).toBe("Thu, Oct 1 - Sun, Oct 4");
    expect(formatDateRange("2026-10-01", "2026-10-04", "it")).toBe("1–4 ott 2026");
    expect(formatDateRange("2026-10-31", "2026-11-02", "en")).toBe("Oct 31 – Nov 2, 2026");
  });

  it("still read full timestamps as instants", () => {
    expect(formatDateShort("2026-10-01T03:00:00Z")).toBe("Sep 30");
  });
});
