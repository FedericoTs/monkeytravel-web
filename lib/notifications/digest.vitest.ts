import { describe, it, expect } from "vitest";
import {
  digestSlot,
  parseDigestDay,
  digestDayCount,
  digestScheduledForUtc,
  plannedDigests,
  digestStaleReason,
  digestParticipantRecipients,
  DIGEST_MAX_DAY,
} from "./digest";

describe("digest slot names", () => {
  it("round-trips day ↔ slot", () => {
    expect(digestSlot(3)).toBe("in_trip_day_3");
    expect(parseDigestDay("in_trip_day_3")).toBe(3);
    expect(parseDigestDay("in_trip_day_21")).toBe(21);
  });
  it("rejects non-digest slots and day < 2", () => {
    expect(parseDigestDay("morning_of")).toBeNull();
    expect(parseDigestDay("followup_return_3d")).toBeNull();
    expect(parseDigestDay("in_trip_day_1")).toBeNull(); // day 1 has the pre-trip cascade
    expect(parseDigestDay("in_trip_day_x")).toBeNull();
  });
});

describe("digestDayCount", () => {
  it("counts inclusive days", () => {
    expect(digestDayCount("2026-09-10", "2026-09-16")).toBe(7);
    expect(digestDayCount("2026-09-10", "2026-09-10")).toBe(1);
  });
  it("clamps to the max and floors bad ranges", () => {
    expect(digestDayCount("2026-09-01", "2026-12-31")).toBe(DIGEST_MAX_DAY);
    expect(digestDayCount("2026-09-16", "2026-09-10")).toBe(0); // end before start
    expect(digestDayCount("nope", "2026-09-16")).toBe(0);
  });
  it("treats a null end_date as a single day", () => {
    expect(digestDayCount("2026-09-10", null)).toBe(1);
  });
});

describe("digestScheduledForUtc", () => {
  it("stamps 06:00 UTC on the day before day K", () => {
    // day 2 → start_date itself at 06:00 UTC; day 3 → +1 day; etc.
    expect(digestScheduledForUtc("2026-09-10", 2)).toBe("2026-09-10T06:00:00.000Z");
    expect(digestScheduledForUtc("2026-09-10", 3)).toBe("2026-09-11T06:00:00.000Z");
    expect(digestScheduledForUtc("2026-09-10", 7)).toBe("2026-09-15T06:00:00.000Z");
  });
  it("returns null for day < 2 or bad date", () => {
    expect(digestScheduledForUtc("2026-09-10", 1)).toBeNull();
    expect(digestScheduledForUtc("bad", 3)).toBeNull();
  });
});

describe("plannedDigests", () => {
  it("emits days 2..N that are still in the future", () => {
    const now = new Date("2026-09-09T12:00:00Z"); // day before a 2026-09-10 trip
    const out = plannedDigests("2026-09-10", "2026-09-13", now); // 4-day trip
    expect(out.map((d) => d.day)).toEqual([2, 3, 4]);
    expect(out[0]).toEqual({ day: 2, slot: "in_trip_day_2", scheduledForUtc: "2026-09-10T06:00:00.000Z" });
  });
  it("skips digests whose stamp has already passed (mid-trip create)", () => {
    const now = new Date("2026-09-11T12:00:00Z"); // trip on day 2, past day-3's 06:00 stamp
    const out = plannedDigests("2026-09-10", "2026-09-13", now);
    // day 2 (stamp 09-10) and day 3 (stamp 09-11 06:00) are past; only day 4 (stamp 09-12) remains
    expect(out.map((d) => d.day)).toEqual([4]);
  });
  it("is empty for a one-day trip", () => {
    expect(plannedDigests("2026-09-10", "2026-09-10", new Date("2026-09-01T00:00:00Z"))).toEqual([]);
  });
});

describe("digestStaleReason", () => {
  const start = "2026-09-10";
  it("sends when delivered before day K", () => {
    // day 3 is 2026-09-12; the day before is 09-11 — punctual
    expect(digestStaleReason(3, start, new Date("2026-09-11T07:00:00Z"))).toBeNull();
  });
  it("suppresses once day K has arrived", () => {
    expect(digestStaleReason(3, start, new Date("2026-09-12T07:00:00Z"))).toMatch(/stale_in_trip_day_3_0d_late/);
    expect(digestStaleReason(3, start, new Date("2026-09-14T07:00:00Z"))).toMatch(/stale_in_trip_day_3_2d_late/);
  });
});

describe("digestParticipantRecipients", () => {
  const rows = (xs: Array<[string | null, string | null, string | null]>) =>
    xs.map(([email, user_id, participant_cookie_id]) => ({ email, user_id, participant_cookie_id }));

  it("keeps emailed participants, carries user id + a stable key", () => {
    const out = digestParticipantRecipients(
      rows([["ana@x.com", "u-1", "c-1"], ["bob@x.com", null, "c-2"]]),
      "owner@x.com",
    );
    expect(out).toEqual([
      { email: "ana@x.com", userId: "u-1", key: "c-1" },
      { email: "bob@x.com", userId: null, key: "c-2" },
    ]);
  });

  it("drops the owner even if a participant joined with the owner's address", () => {
    const out = digestParticipantRecipients(rows([["Owner@X.com", null, "c-1"], ["ana@x.com", null, "c-2"]]), "owner@x.com");
    expect(out.map((r) => r.email)).toEqual(["ana@x.com"]);
  });

  it("lowercases + dedupes by email (two cookies, one address)", () => {
    const out = digestParticipantRecipients(rows([["Ana@X.com", null, "c-1"], ["ana@x.com", "u-9", "c-2"]]), "owner@x.com");
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("ana@x.com");
    expect(out[0].key).toBe("c-1"); // first wins
  });

  it("skips rows with no email; falls back key cookie→user→email", () => {
    const out = digestParticipantRecipients(rows([[null, "u-1", "c-1"], ["  ", null, "c-2"], ["cara@x.com", "u-3", null]]), "owner@x.com");
    expect(out).toEqual([{ email: "cara@x.com", userId: "u-3", key: "u-3" }]);
  });
});
