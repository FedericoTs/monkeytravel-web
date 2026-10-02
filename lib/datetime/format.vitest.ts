/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDateFull, formatDateRange, formatDateRangeWithWeekdays, formatDateShort, formatDateWithWeekday } from "./format";

describe("formatDateRange", () => {
  it("names the month in the page's language", () => {
    expect(formatDateRange("2026-11-24", "2026-11-25", "en")).toBe("Nov 24-25, 2026");
    expect(formatDateRange("2026-11-24", "2026-11-25", "it")).toBe("nov 24-25, 2026");
    expect(formatDateRange("2026-10-30", "2026-11-02", "en")).toBe("Oct 30 - Nov 2, 2026");
  });

  it("shows a one-day trip as its day", () => {
    expect(formatDateRange("2026-09-30", "2026-09-30", "en")).toBe("Sep 30, 2026");
    expect(formatDateRange("2026-09-30", "2026-09-30", "it")).toBe("set 30, 2026");
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
  });

  it("still read full timestamps as instants", () => {
    expect(formatDateShort("2026-10-01T03:00:00Z")).toBe("Sep 30");
  });
});
