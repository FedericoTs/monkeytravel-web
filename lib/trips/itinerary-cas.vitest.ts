// @vitest-environment node
import { describe, it, expect } from "vitest";
import { casUpdateItinerary, type ItineraryRow } from "./itinerary-cas";

/**
 * Server read-modify-write of the itinerary (regenerate-day, enrichment):
 * written only on top of the version the change was computed from, else
 * recomputed on the fresh copy.
 */

type Row = ItineraryRow & { user_id: string };

function fakeDb(start: Row, opts: { bumpBetween?: number; refuse?: boolean } = {}) {
  let row = { ...start };
  let bumpsLeft = opts.bumpBetween ?? 0;
  const log: Array<{ kind: "write" | "read"; filters: Array<[string, unknown]> }> = [];
  const db = {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const q = {
          eq: (c: string, v: unknown) => {
            filters.push([c, v]);
            return q;
          },
          select: async () => {
            log.push({ kind: "write", filters });
            // Someone else saves right before this write lands.
            if (bumpsLeft > 0) {
              bumpsLeft--;
              row = { ...row, itinerary: [{ day_number: 1, activities: [{ id: "x", name: `other-${bumpsLeft}` }] }], itinerary_version: row.itinerary_version + 1 };
            }
            const v = filters.find(([c]) => c === "itinerary_version")?.[1];
            if (opts.refuse || v !== row.itinerary_version) return { data: [], error: null };
            row = { ...row, ...(values as object), itinerary_version: row.itinerary_version + 1 } as Row;
            return { data: [{ itinerary_version: row.itinerary_version }], error: null };
          },
        };
        return q;
      },
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const q = {
          eq: (c: string, v: unknown) => {
            filters.push([c, v]);
            return q;
          },
          maybeSingle: async () => {
            log.push({ kind: "read", filters });
            return { data: { ...row }, error: null };
          },
        };
        return q;
      },
    }),
  };
  return { db: db as never, log, current: () => row };
}

const start: Row = { user_id: "u1", itinerary: [{ day_number: 1, activities: [] }], itinerary_version: 7, trip_meta: {} };
const mark = (row: ItineraryRow, label: string) => ({
  itinerary: [...(row.itinerary as never[]), { day_number: 99, date: "", activities: [], theme: label }] as never,
});

describe("casUpdateItinerary", () => {
  it("writes on the version it read, and reports both versions", async () => {
    const { db, log } = fakeDb(start);
    const out = await casUpdateItinerary(db, { tripId: "t1", from: start, change: (row) => mark(row, "mine") });
    expect(out).toMatchObject({ status: "written", fromVersion: 7, itineraryVersion: 8 });
    expect(log[0].filters).toContainEqual(["itinerary_version", 7]);
  });

  it("recomputes on the fresh copy after someone else wrote", async () => {
    const { db, current } = fakeDb(start, { bumpBetween: 1 });
    const seen: number[] = [];
    const out = await casUpdateItinerary(db, {
      tripId: "t1",
      from: start,
      change: (row, attempt) => {
        seen.push(attempt);
        return mark(row, `attempt-${attempt}`);
      },
    });
    expect(seen).toEqual([0, 1]);
    expect(out).toMatchObject({ status: "written", fromVersion: 8, itineraryVersion: 9 });
    // The other person's change survived under ours.
    expect(JSON.stringify(current().itinerary)).toContain("other-0");
  });

  it("gives up cleanly when the change no longer applies", async () => {
    const { db, log } = fakeDb(start);
    const out = await casUpdateItinerary(db, { tripId: "t1", from: start, change: () => null });
    expect(out).toEqual({ status: "skipped" });
    expect(log).toHaveLength(0);
  });

  it("reports busy after three misses in a row", async () => {
    const { db } = fakeDb(start, { bumpBetween: 5 });
    expect(await casUpdateItinerary(db, { tripId: "t1", from: start, change: (r) => mark(r, "x") })).toEqual({ status: "busy" });
  });

  it("reports missing when the write is refused and nobody else wrote (RLS, not a race)", async () => {
    const { db } = fakeDb(start, { refuse: true });
    expect(await casUpdateItinerary(db, { tripId: "t1", from: start, change: (r) => mark(r, "x") })).toEqual({ status: "missing" });
  });

  it("scopes both the write and the re-read to the owner when asked", async () => {
    const { db, log } = fakeDb(start, { bumpBetween: 1 });
    await casUpdateItinerary(db, { tripId: "t1", ownerId: "u1", from: start, change: (r) => mark(r, "x") });
    for (const entry of log) expect(entry.filters).toContainEqual(["user_id", "u1"]);
  });
});
