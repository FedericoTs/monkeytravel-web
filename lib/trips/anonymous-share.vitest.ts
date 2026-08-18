import { describe, it, expect } from "vitest";
import {
  validateAnonymousTripPayload,
  sanitizeCoverImageUrl,
  isIsoDate,
  claimExpiryFrom,
  MAX_TRIP_DAYS,
  CLAIM_WINDOW_DAYS,
} from "./anonymous-share";

const valid = {
  title: "Tokyo Trip",
  description: "Six days in Tokyo",
  destination: "Tokyo",
  startDate: "2026-09-01",
  endDate: "2026-09-06",
  itinerary: [{ day: 1 }, { day: 2 }],
  coverImageUrl: "https://images.example.com/tokyo.jpg",
};

describe("validateAnonymousTripPayload", () => {
  it("accepts a well-formed payload", () => {
    const r = validateAnonymousTripPayload(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe("Tokyo Trip");
      expect(r.value.itinerary).toHaveLength(2);
      expect(r.value.coverImageUrl).toBe("https://images.example.com/tokyo.jpg");
    }
  });

  it.each([null, undefined, 42, "string", []])("rejects non-object body: %p", (body) => {
    expect(validateAnonymousTripPayload(body).ok).toBe(false);
  });

  it("rejects a missing title", () => {
    const r = validateAnonymousTripPayload({ ...valid, title: "   " });
    expect(r).toEqual({ ok: false, error: "Missing trip title." });
  });

  it("rejects a missing destination", () => {
    const r = validateAnonymousTripPayload({ ...valid, destination: "" });
    expect(r).toEqual({ ok: false, error: "Missing trip destination." });
  });

  it("falls back to destination when description is absent (column is NOT NULL)", () => {
    const r = validateAnonymousTripPayload({ ...valid, description: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe("Tokyo");
  });

  it("rejects an end date before the start date", () => {
    const r = validateAnonymousTripPayload({
      ...valid,
      startDate: "2026-09-10",
      endDate: "2026-09-01",
    });
    expect(r).toEqual({ ok: false, error: "Trip ends before it starts." });
  });

  it("allows a single-day trip (start === end)", () => {
    const r = validateAnonymousTripPayload({
      ...valid,
      startDate: "2026-09-01",
      endDate: "2026-09-01",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an empty itinerary", () => {
    const r = validateAnonymousTripPayload({ ...valid, itinerary: [] });
    expect(r).toEqual({ ok: false, error: "Trip has no itinerary." });
  });

  it(`rejects more than ${MAX_TRIP_DAYS} days`, () => {
    const r = validateAnonymousTripPayload({
      ...valid,
      itinerary: Array.from({ length: MAX_TRIP_DAYS + 1 }, (_, i) => ({ day: i })),
    });
    expect(r.ok).toBe(false);
  });

  it(`accepts exactly ${MAX_TRIP_DAYS} days (boundary)`, () => {
    const r = validateAnonymousTripPayload({
      ...valid,
      itinerary: Array.from({ length: MAX_TRIP_DAYS }, (_, i) => ({ day: i })),
    });
    expect(r.ok).toBe(true);
  });

  it("truncates an overlong title rather than rejecting it", () => {
    const r = validateAnonymousTripPayload({ ...valid, title: "x".repeat(500) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.title).toHaveLength(200);
  });

  it("never trusts a client-supplied user_id or claim token", () => {
    const r = validateAnonymousTripPayload({
      ...valid,
      user_id: "11111111-1111-1111-1111-111111111111",
      claim_token: "attacker-chosen",
      share_token: "attacker-chosen",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The validated shape is a closed allow-list; injected fields cannot
      // reach the insert because the route only ever spreads `value`.
      expect(Object.keys(r.value).sort()).toEqual(
        [
          "coverImageUrl",
          "description",
          "destination",
          "endDate",
          "itinerary",
          "startDate",
          "title",
        ].sort()
      );
    }
  });
});

describe("isIsoDate", () => {
  it("accepts a real date", () => expect(isIsoDate("2026-09-01")).toBe(true));
  it.each(["2026-9-1", "01/09/2026", "Tuesday", "", "2026-09-01T00:00:00Z", null, 20260901])(
    "rejects %p",
    (v) => expect(isIsoDate(v)).toBe(false)
  );
  it("rejects a calendar-invalid date that still parses", () => {
    // Without the round-trip check this rolls forward to 2026-03-03.
    expect(isIsoDate("2026-02-31")).toBe(false);
  });
});

describe("sanitizeCoverImageUrl", () => {
  it("keeps an https URL", () => {
    expect(sanitizeCoverImageUrl("https://a.example/b.jpg")).toBe("https://a.example/b.jpg");
  });
  it.each([
    "http://insecure.example/b.jpg",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "not a url",
    "",
    null,
    123,
  ])("drops %p", (v) => expect(sanitizeCoverImageUrl(v)).toBeNull());
});

describe("claimExpiryFrom", () => {
  it(`is ${CLAIM_WINDOW_DAYS} days out`, () => {
    const now = new Date("2026-08-17T00:00:00.000Z");
    expect(claimExpiryFrom(now)).toBe("2026-09-16T00:00:00.000Z");
  });
});
