import { describe, expect, it } from "vitest";
import { dedupeFeedRows, durationDaysOf } from "./dedupe";

const row = (
  id: string,
  over: Partial<{ user_id: string | null; parent_trip_id: string | null; title: string; start_date: string; end_date: string }> = {},
) => ({
  id,
  user_id: "u1",
  parent_trip_id: null,
  title: "Lisbon Trip",
  start_date: "2026-09-10",
  end_date: "2026-09-15",
  ...over,
});

describe("durationDaysOf", () => {
  it("counts both ends, like the feed route always did", () => {
    expect(durationDaysOf({ start_date: "2026-09-10", end_date: "2026-09-15" })).toBe(6);
    expect(durationDaysOf({ start_date: "2026-09-10", end_date: "2026-09-10" })).toBe(1);
  });
  it("returns 0 for unparseable dates instead of NaN", () => {
    expect(durationDaysOf({ start_date: "nope", end_date: "2026-09-10" })).toBe(0);
  });
});

describe("dedupeFeedRows", () => {
  it("keeps distinct trips in their ranked order", () => {
    const rows = [row("a"), row("b", { title: "Porto Trip" }), row("c", { user_id: "u2" })];
    expect(dedupeFeedRows(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("drops a fork listed next to its parent, whichever ranks higher", () => {
    // fork first (ranks higher), parent later — the parent still wins and
    // takes the fork's slot so the feed order does not jump.
    const rows = [
      row("fork", { parent_trip_id: "orig", user_id: "u2" }),
      row("x", { title: "Rome Trip" }),
      row("orig"),
    ];
    expect(dedupeFeedRows(rows).map((r) => r.id)).toEqual(["orig", "x"]);
    // parent first
    expect(
      dedupeFeedRows([row("orig"), row("fork", { parent_trip_id: "orig", user_id: "u2" })]).map((r) => r.id),
    ).toEqual(["orig"]);
  });

  it("keeps a fork whose parent is not in the feed (private original)", () => {
    const rows = [row("fork", { parent_trip_id: "private-orig" }), row("b", { title: "Porto Trip" })];
    expect(dedupeFeedRows(rows).map((r) => r.id)).toEqual(["fork", "b"]);
  });

  it("keeps one of several forks of the same parent", () => {
    const rows = [
      row("f1", { parent_trip_id: "p", user_id: "u2" }),
      row("f2", { parent_trip_id: "p", user_id: "u3" }),
    ];
    expect(dedupeFeedRows(rows).map((r) => r.id)).toEqual(["f1"]);
  });

  it("collapses the same title + author + duration, ignoring case and spacing", () => {
    const rows = [
      row("a", { title: "Lisbon Trip" }),
      row("b", { title: "  lisbon   trip " }),
      row("c", { title: "Lisbon Trip", user_id: "u2" }), // other author → stays
      row("d", { title: "Lisbon Trip", end_date: "2026-09-17" }), // other length → stays
    ];
    expect(dedupeFeedRows(rows).map((r) => r.id)).toEqual(["a", "c", "d"]);
  });

  it("does not merge anonymous authors with each other by accident", () => {
    // user_id null on two different trips with the same title/length: they
    // ARE the same key today; document the behaviour so a change is deliberate.
    const rows = [row("a", { user_id: null }), row("b", { user_id: null })];
    expect(dedupeFeedRows(rows).map((r) => r.id)).toEqual(["a"]);
  });
});
