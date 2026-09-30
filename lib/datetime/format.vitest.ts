/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { formatDateRange } from "./format";

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
