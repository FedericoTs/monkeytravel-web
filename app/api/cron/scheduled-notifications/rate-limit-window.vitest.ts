/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { rateLimitWindowStart } from "./route";

/**
 * One email per trip per CALENDAR DAY, not per rolling 24 hours. The cron
 * runs once a day at 07:00 UTC; a rolling window sees yesterday's 07:00:30
 * send from today's 07:00:20 run as "within 24h" and suppresses today's row.
 * Measured 2026-09-13..16: 31 of 37 rate-limit suppressions were exactly
 * that, 28 of them the in-trip digests, which are daily by design.
 */
describe("rateLimitWindowStart", () => {
  it("is midnight UTC of the run's own day", () => {
    expect(rateLimitWindowStart(new Date("2026-09-15T07:00:20Z"))).toBe("2026-09-15T00:00:00.000Z");
  });

  it("excludes yesterday's run even when it finished a few seconds later in the day", () => {
    const yesterdaysSend = "2026-09-14T07:00:30.000Z";
    const start = rateLimitWindowStart(new Date("2026-09-15T07:00:20Z"));
    expect(yesterdaysSend >= start).toBe(false);
  });

  it("still includes a send earlier in the same day", () => {
    const earlierToday = "2026-09-15T07:00:05.000Z";
    const start = rateLimitWindowStart(new Date("2026-09-15T07:00:20Z"));
    expect(earlierToday >= start).toBe(true);
  });

  it("uses the UTC date, not the machine's local date", () => {
    // 23:30 UTC on the 14th is already the 15th in UTC+2; the window must
    // still start on the 14th because the queue is stamped in UTC.
    expect(rateLimitWindowStart(new Date("2026-09-14T23:30:00Z"))).toBe("2026-09-14T00:00:00.000Z");
  });
});
