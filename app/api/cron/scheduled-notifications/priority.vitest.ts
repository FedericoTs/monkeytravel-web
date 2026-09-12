/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { prioritizeDueRows } from "./route";

/**
 * Under TRIP_NOTIFICATIONS_SEND_CAP a run stops after N sends and leaves the
 * rest `pending` for tomorrow. Oldest-first spent that budget on the rows
 * that could wait ("One week out" is still true at six days) and deferred the
 * ones that could not — "Tomorrow — final checks", "Travel day", the
 * evening-before digest — which staleReason then rightly refused the next
 * morning. Two `morning_of` rows died that way on 2026-09-12.
 */

function row(slot: string, scheduled_for: string) {
  return { id: `${slot}@${scheduled_for}`, slot, scheduled_for };
}

describe("prioritizeDueRows", () => {
  it("sends the rows that are wrong tomorrow before the rows that can wait a day", () => {
    const rows = [
      row("pack_early_14d", "2026-09-10T06:00:00Z"),
      row("weather_3d", "2026-09-11T06:00:00Z"),
      row("morning_of", "2026-09-12T06:00:00Z"),
      row("confirm_1d", "2026-09-12T06:00:00Z"),
      row("in_trip_day_3", "2026-09-12T06:00:00Z"),
    ];
    expect(prioritizeDueRows(rows).map((r) => r.slot)).toEqual([
      "morning_of",
      "confirm_1d",
      "in_trip_day_3",
      "pack_early_14d",
      "weather_3d",
    ]);
  });

  it("keeps oldest-first inside a group and puts post-trip followups last", () => {
    const rows = [
      row("followup_return_3d", "2026-09-01T06:00:00Z"),
      row("visa_check_7d", "2026-09-12T06:00:00Z"),
      row("visa_check_7d", "2026-09-11T06:00:00Z"),
      row("confirm_1d", "2026-09-12T06:00:00Z"),
      row("confirm_1d", "2026-09-11T06:00:00Z"),
    ];
    expect(prioritizeDueRows(rows).map((r) => r.id)).toEqual([
      "confirm_1d@2026-09-11T06:00:00Z",
      "confirm_1d@2026-09-12T06:00:00Z",
      "visa_check_7d@2026-09-11T06:00:00Z",
      "visa_check_7d@2026-09-12T06:00:00Z",
      "followup_return_3d@2026-09-01T06:00:00Z",
    ]);
  });

  it("is stable for equal keys and does not mutate its input", () => {
    const rows = [
      row("morning_of", "2026-09-12T06:00:00Z"),
      row("in_trip_day_2", "2026-09-12T06:00:00Z"),
      row("confirm_1d", "2026-09-12T06:00:00Z"),
    ];
    const snapshot = rows.map((r) => r.id);
    expect(prioritizeDueRows(rows).map((r) => r.id)).toEqual(snapshot);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});
