import { describe, expect, it } from "vitest";
import {
  TRIP_VIEW_SOURCES,
  clientIp,
  isUuid,
  parseTripViewSource,
  resolveViewSessionId,
  utcDay,
} from "./trip-view";

/**
 * The dedupe itself is enforced by the database — UNIQUE
 * (trip_id, session_id, viewed_on), migration 20260904120000 — and the route
 * treats 23505 as "already counted today". What can go wrong in application
 * code is the KEY that unique sees: the wrong source vocabulary, a session id
 * that changes within a day (double-counting) or never changes across days
 * (under-counting), or raw ip/ua leaking into a column anon can read.
 */

describe("parseTripViewSource", () => {
  it("accepts exactly the renderer vocabulary", () => {
    for (const s of TRIP_VIEW_SOURCES) expect(parseTripViewSource(s)).toBe(s);
  });

  it("rejects the old free-text values and non-strings", () => {
    // "direct" was the previous writer's default; it must not survive.
    for (const bad of ["direct", "SHARED", "", null, undefined, 1, {}, ["shared"]]) {
      expect(parseTripViewSource(bad)).toBeNull();
    }
  });
});

describe("resolveViewSessionId", () => {
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
  const ip = "203.0.113.42";

  it("uses the mt_session_id cookie verbatim (lower-cased) when it is a UUID", () => {
    const r = resolveViewSessionId("3F2504E0-4F89-11D3-9A0C-0305E82C3301", ip, ua);
    expect(r).toEqual({ sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", fromCookie: true });
  });

  it("ignores a cookie that is not a UUID (an attacker cannot pick the key)", () => {
    const r = resolveViewSessionId("owner-session-please", ip, ua);
    expect(r.fromCookie).toBe(false);
    expect(r.sessionId.startsWith("nocookie:")).toBe(true);
  });

  it("is stable within a UTC day without a cookie, so the per-day unique still dedupes", () => {
    const morning = new Date("2026-09-04T06:00:00Z");
    const evening = new Date("2026-09-04T23:59:59Z");
    expect(resolveViewSessionId(null, ip, ua, morning).sessionId).toBe(
      resolveViewSessionId(undefined, ip, ua, evening).sessionId,
    );
  });

  it("changes across UTC days without a cookie, so a Day-3 open is a new row", () => {
    const day1 = new Date("2026-09-04T12:00:00Z");
    const day3 = new Date("2026-09-06T12:00:00Z");
    expect(resolveViewSessionId(null, ip, ua, day1).sessionId).not.toBe(
      resolveViewSessionId(null, ip, ua, day3).sessionId,
    );
  });

  it("never carries the raw ip or user-agent (the old writer base64-encoded both)", () => {
    const r = resolveViewSessionId(null, ip, ua);
    expect(r.sessionId).not.toContain(ip);
    expect(r.sessionId).not.toContain("iPhone");
    expect(Buffer.from(r.sessionId.replace("nocookie:", ""), "hex").toString()).not.toContain(ip);
  });

  it("fits the previous writer's 64-char budget", () => {
    expect(resolveViewSessionId(null, ip, ua).sessionId.length).toBeLessThanOrEqual(64);
  });
});

describe("utcDay", () => {
  it("formats the UTC calendar day, matching the column default", () => {
    expect(utcDay(new Date("2026-09-04T23:30:00-05:00"))).toBe("2026-09-05");
  });
});

describe("isUuid / clientIp", () => {
  it("guards the route param before it reaches the database", () => {
    expect(isUuid("0af8e266-0000-4000-8000-000000000000")).toBe(true);
    expect(isUuid("lisbon-trip-0af8e266")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it("takes the first forwarded hop only", () => {
    expect(clientIp("198.51.100.7, 10.0.0.1")).toBe("198.51.100.7");
    expect(clientIp(undefined)).toBeNull();
    expect(clientIp("")).toBeNull();
  });
});
