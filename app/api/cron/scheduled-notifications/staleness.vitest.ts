/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { staleReason } from "./route";

/**
 * A pre-trip reminder whose moment has passed is not late — it is WRONG.
 *
 * Every pre-trip subject makes a claim about WHEN: "Two weeks to go", "One
 * week out", "Three days to Palermo", "Tomorrow — final checks", "Travel day".
 * Sent at the wrong time they do not read as delayed, they read as a product
 * that has no idea what it is talking about.
 *
 * This cannot fire while the queue is punctual. It exists for the release of a
 * held or backed-up batch, which has already happened: 670 rows were held
 * under `manual_hold_2026_08_27`, and on 2026-08-31 one live row was a
 * `morning_of` for a trip that had started the day before.
 */

const TODAY = new Date("2026-09-10T07:00:00Z");

/** A trip starting N days after TODAY. */
function startsIn(days: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("a reminder sent on time is sent", () => {
  it.each([
    ["pack_early_14d", 14],
    ["visa_check_7d", 7],
    ["weather_3d", 3],
    ["confirm_1d", 1],
    ["morning_of", 0],
  ])("%s at its intended offset", (slot, offset) => {
    expect(staleReason(slot, startsIn(offset), TODAY)).toBeNull();
  });

  it.each([
    ["pack_early_14d", 20],
    ["weather_3d", 9],
    ["confirm_1d", 5],
  ])("%s running EARLY is never stale", (slot, offset) => {
    // Early is not this guard's business — the queue does not send early, and
    // if it ever did, the copy would still be true later rather than never.
    expect(staleReason(slot, startsIn(offset), TODAY)).toBeNull();
  });

  it("one day late is forgiven for the slots whose copy survives it", () => {
    // The cron runs once daily and slots are stamped an hour earlier, so a
    // single missed run puts every row 24h behind. "Two weeks to go" at 13
    // days and "Three days to X" at 2 days are still true enough; failing
    // those would suppress mail after any one-off outage.
    expect(staleReason("weather_3d", startsIn(2), TODAY)).toBeNull();
    expect(staleReason("pack_early_14d", startsIn(13), TODAY)).toBeNull();
    expect(staleReason("visa_check_7d", startsIn(6), TODAY)).toBeNull();
  });

  it("gives NO grace to the slots that name a specific day", () => {
    // "Tomorrow — final checks" one day late means the trip is TODAY, and
    // "Travel day" one day late means they already left. Both are false, not
    // loose. A single global tolerance forgave exactly these in the first
    // draft — including the live row that prompted this guard.
    expect(staleReason("confirm_1d", startsIn(0), TODAY)).toBeTruthy();
    expect(staleReason("morning_of", startsIn(-1), TODAY)).toBeTruthy();
    // ...while the on-time cases still send.
    expect(staleReason("confirm_1d", startsIn(1), TODAY)).toBeNull();
    expect(staleReason("morning_of", startsIn(0), TODAY)).toBeNull();
  });
});

describe("a reminder whose moment has passed is suppressed", () => {
  it("does not tell someone their trip is tomorrow when it began yesterday", () => {
    // The live row found on 2026-08-31.
    expect(staleReason("morning_of", startsIn(-1), TODAY)).toMatch(/^stale_morning_of/);
  });

  it('does not send "Three days to X" after the trip started', () => {
    expect(staleReason("weather_3d", startsIn(-2), TODAY)).toMatch(/^stale_weather_3d/);
  });

  it.each([
    ["pack_early_14d", 5, "two weeks to go, nine days late"],
    ["visa_check_7d", 2, "one week out, five days late"],
    ["confirm_1d", -3, "tomorrow, four days late"],
  ])("%s: %s", (slot, offset) => {
    expect(staleReason(slot, startsIn(offset), TODAY)).toBeTruthy();
  });

  it("names the slot and how late it is, so the queue can be read back", () => {
    // skipped_reason is the only record of why a row did not send.
    expect(staleReason("confirm_1d", startsIn(-2), TODAY)).toBe("stale_confirm_1d_3d_late");
    expect(staleReason("morning_of", startsIn(-1), TODAY)).toBe("stale_morning_of_1d_late");
  });
});

describe("what the guard deliberately does not touch", () => {
  it.each([
    "followup_return_3d",
    "followup_next_21d",
    "followup_final_45d",
    "followup_dormant",
  ])("%s — post-trip slots fire AFTER the trip and cannot be overtaken by it", (slot) => {
    expect(staleReason(slot, startsIn(-40), TODAY)).toBeNull();
  });

  it("an unknown slot is never suppressed by this rule", () => {
    // A new slot must opt in by adding its offset, rather than being silently
    // blocked by a table it is not in.
    expect(staleReason("some_future_slot", startsIn(-99), TODAY)).toBeNull();
  });

  it("unusable dates are somebody else's problem", () => {
    expect(staleReason("morning_of", "not-a-date", TODAY)).toBeNull();
    expect(staleReason("morning_of", "", TODAY)).toBeNull();
  });
});
