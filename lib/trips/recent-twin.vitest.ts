/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findRecentTwin } from "./recent-twin";

type Row = { id: string; title: string; trip_meta: unknown };

/** A query builder that records its filters and answers with the given rows. */
function fakeClient(rows: Row[] | null, error: unknown = null) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "gte", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return method === "limit" ? Promise.resolve({ data: rows, error }) : builder;
    };
  }
  const client = { from: (table: string) => (calls.push(["from", table]), builder) } as unknown as SupabaseClient;
  return { client, calls };
}

const TOKYO = { destination: "Tokyo, Japan", startDate: "2026-12-20", endDate: "2026-12-29" };

describe("findRecentTwin", () => {
  it("asks for this account's live, uncancelled trips on the same dates, however long ago they were saved", async () => {
    const { client, calls } = fakeClient([]);
    await findRecentTwin(client, "user-1", TOKYO);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["from", "trips"],
        ["eq", "user_id", "user-1"],
        ["is", "deleted_at", null],
        ["neq", "status", "cancelled"],
        ["eq", "start_date", "2026-12-20"],
        ["eq", "end_date", "2026-12-29"],
      ])
    );
    // No window: a re-plan twelve days later is still the same trip.
    expect(calls.some(([method]) => method === "gte")).toBe(false);
  });

  it("returns the trip for the same place, whatever the spelling", async () => {
    const { client } = fakeClient([
      { id: "kyoto", title: "Kyoto Trip", trip_meta: { destination: "Kyoto, Japan" } },
      { id: "tokyo", title: "Tokyo Trip", trip_meta: { destination: "tokyo" } },
    ]);
    expect(await findRecentTwin(client, "user-1", TOKYO)).toEqual({ id: "tokyo", title: "Tokyo Trip" });
  });

  it("finds nothing for another place, on an error, or without dates", async () => {
    const other = fakeClient([{ id: "kyoto", title: "Kyoto Trip", trip_meta: { destination: "Kyoto, Japan" } }]);
    expect(await findRecentTwin(other.client, "user-1", TOKYO)).toBeNull();
    const failing = fakeClient(null, { message: "boom" });
    expect(await findRecentTwin(failing.client, "user-1", TOKYO)).toBeNull();
    const untouched = fakeClient([{ id: "tokyo", title: "Tokyo Trip", trip_meta: { destination: "Tokyo" } }]);
    expect(await findRecentTwin(untouched.client, "user-1", { ...TOKYO, startDate: "" })).toBeNull();
    expect(untouched.calls).toEqual([]);
  });
});
