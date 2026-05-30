import { describe, it, expect } from "vitest";
import { buildIcal, type IcalEvent } from "./ical";

/**
 * Tests for the inline RFC 5545 generator. We don't try to be a full
 * spec conformance suite — we cover the shapes the calendar-export
 * feature actually emits:
 *   1. A timed single-tz event (the common case).
 *   2. An all-day event (date-only VEVENT, no TZID).
 *   3. A multi-tz trip — verifies one VTIMEZONE per unique TZID.
 *
 * Plus the structural invariants we'd ship a broken file without:
 *   - CRLF line endings (RFC 5545 §3.1).
 *   - TEXT escaping (commas, newlines, backslashes).
 *   - Line folding at 75 octets, on a code-point boundary.
 */

const PRODID = "-//monkeytravel.app//Trip Export 1.0//EN";

function lines(ical: string): string[] {
  // Unfold first (continuation = CRLF + space), then split.
  const unfolded = ical.replace(/\r\n /g, "");
  return unfolded.split("\r\n");
}

describe("buildIcal", () => {
  it("emits a valid VCALENDAR envelope and required header props", () => {
    const out = buildIcal([], { calName: "My Trip" });
    const ls = lines(out);

    expect(ls[0]).toBe("BEGIN:VCALENDAR");
    expect(ls).toContain(`PRODID:${PRODID}`);
    expect(ls).toContain("VERSION:2.0");
    expect(ls).toContain("CALSCALE:GREGORIAN");
    expect(ls).toContain("METHOD:PUBLISH");
    expect(ls).toContain("X-WR-CALNAME:My Trip");
    expect(ls[ls.length - 2]).toBe("END:VCALENDAR");
    // RFC 5545 §3.1: every line, including the last, ends in CRLF.
    expect(out.endsWith("\r\n")).toBe(true);
  });

  describe("simple timed event", () => {
    const event: IcalEvent = {
      uid: "activity-abc123@monkeytravel.app",
      summary: "Coffee at Time Out Market",
      description: "Pastel de nata + bica",
      location: "Av. 24 de Julho 49, 1200-479 Lisboa",
      geo: { lat: 38.706667, lng: -9.146389 },
      dtstart: new Date(Date.UTC(2026, 5, 15, 9, 0, 0)), // 09:00 UTC == 10:00 local Lisbon (BST/WEST)
      dtend: new Date(Date.UTC(2026, 5, 15, 10, 30, 0)),
      tzid: "Europe/Lisbon",
    };

    it("renders DTSTART/DTEND with TZID and local wall-clock", () => {
      const ls = lines(buildIcal([event], { calName: "Lisbon" }));

      expect(ls).toContain("BEGIN:VEVENT");
      expect(ls).toContain("UID:activity-abc123@monkeytravel.app");
      expect(ls).toContain("SUMMARY:Coffee at Time Out Market");
      // 09:00 UTC on 2026-06-15 == 10:00 wall clock in Lisbon (DST).
      expect(ls).toContain("DTSTART;TZID=Europe/Lisbon:20260615T100000");
      expect(ls).toContain("DTEND;TZID=Europe/Lisbon:20260615T113000");
      // LOCATION + GEO + DESCRIPTION present.
      expect(ls).toContain("LOCATION:Av. 24 de Julho 49\\, 1200-479 Lisboa");
      expect(ls).toContain("GEO:38.706667;-9.146389");
      expect(ls).toContain("DESCRIPTION:Pastel de nata + bica");
      expect(ls).toContain("END:VEVENT");
    });

    it("emits exactly one VTIMEZONE for the event's TZID", () => {
      const ls = lines(buildIcal([event], { calName: "Lisbon" }));
      const tzOpens = ls.filter((l) => l === "BEGIN:VTIMEZONE").length;
      const tzCloses = ls.filter((l) => l === "END:VTIMEZONE").length;
      expect(tzOpens).toBe(1);
      expect(tzCloses).toBe(1);
      expect(ls).toContain("TZID:Europe/Lisbon");
    });

    it("escapes commas, semicolons, and newlines in TEXT values", () => {
      const tricky: IcalEvent = {
        uid: "tricky@monkeytravel.app",
        summary: "Dinner: pasta, wine; dessert\nthen show",
        // Backslash in path-like description — must double-escape.
        description: "Path C:\\Users\\notes",
        dtstart: new Date(Date.UTC(2026, 5, 15, 19, 0, 0)),
        dtend: new Date(Date.UTC(2026, 5, 15, 21, 0, 0)),
        tzid: "Europe/Lisbon",
      };
      const ls = lines(buildIcal([tricky], { calName: "x" }));
      expect(ls).toContain(
        "SUMMARY:Dinner: pasta\\, wine\\; dessert\\nthen show",
      );
      expect(ls).toContain("DESCRIPTION:Path C:\\\\Users\\\\notes");
    });
  });

  describe("all-day event", () => {
    it("emits VALUE=DATE form with no TZID", () => {
      const allDay: IcalEvent = {
        uid: "travel-day@monkeytravel.app",
        summary: "Travel day — flight to Lisbon",
        // Both endpoints at UTC midnight, no TZID → all-day per `isAllDay`.
        dtstart: new Date(Date.UTC(2026, 5, 15, 0, 0, 0)),
        dtend: new Date(Date.UTC(2026, 5, 16, 0, 0, 0)),
      };
      const ls = lines(buildIcal([allDay], { calName: "x" }));
      expect(ls).toContain("DTSTART;VALUE=DATE:20260615");
      expect(ls).toContain("DTEND;VALUE=DATE:20260616");
      // No VTIMEZONE because no TZID was used by any event.
      expect(ls).not.toContain("BEGIN:VTIMEZONE");
    });
  });

  describe("multi-timezone trip", () => {
    it("emits one VTIMEZONE block per unique TZID", () => {
      const events: IcalEvent[] = [
        {
          uid: "lisbon-1@monkeytravel.app",
          summary: "Arrive Lisbon",
          dtstart: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
          dtend: new Date(Date.UTC(2026, 5, 15, 13, 0, 0)),
          tzid: "Europe/Lisbon",
        },
        {
          uid: "lisbon-2@monkeytravel.app",
          summary: "Tram 28 ride",
          dtstart: new Date(Date.UTC(2026, 5, 16, 10, 0, 0)),
          dtend: new Date(Date.UTC(2026, 5, 16, 11, 0, 0)),
          tzid: "Europe/Lisbon",
        },
        {
          uid: "tokyo-1@monkeytravel.app",
          summary: "Shibuya crossing",
          dtstart: new Date(Date.UTC(2026, 5, 20, 9, 0, 0)),
          dtend: new Date(Date.UTC(2026, 5, 20, 10, 0, 0)),
          tzid: "Asia/Tokyo",
        },
      ];
      const out = buildIcal(events, { calName: "Lisbon + Tokyo" });
      const ls = lines(out);

      // 2 unique TZIDs → 2 VTIMEZONE blocks.
      expect(ls.filter((l) => l === "BEGIN:VTIMEZONE")).toHaveLength(2);
      expect(ls).toContain("TZID:Europe/Lisbon");
      expect(ls).toContain("TZID:Asia/Tokyo");

      // Tokyo is UTC+9 year-round (no DST) — single STANDARD block.
      // Sanity check: Tokyo event 09:00 UTC == 18:00 wall clock.
      expect(ls).toContain("DTSTART;TZID=Asia/Tokyo:20260620T180000");
    });
  });

  describe("line folding", () => {
    it("folds lines longer than 75 octets with CRLF + space", () => {
      const longSummary = "A".repeat(200);
      const ev: IcalEvent = {
        uid: "long@monkeytravel.app",
        summary: longSummary,
        dtstart: new Date(Date.UTC(2026, 5, 15, 9, 0, 0)),
        dtend: new Date(Date.UTC(2026, 5, 15, 10, 0, 0)),
        tzid: "Europe/Lisbon",
      };
      const out = buildIcal([ev], { calName: "x" });
      // Every physical line ≤ 75 bytes.
      for (const line of out.split("\r\n")) {
        expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      }
      // After unfolding, the SUMMARY round-trips intact.
      const unfolded = out.replace(/\r\n /g, "");
      expect(unfolded).toContain(`SUMMARY:${longSummary}`);
    });

    it("does not split a multibyte code point across a fold", () => {
      // 50 emoji (4 UTF-8 bytes each) = 200 bytes — must fold cleanly.
      const summary = "🌍".repeat(50);
      const ev: IcalEvent = {
        uid: "emoji@monkeytravel.app",
        summary,
        dtstart: new Date(Date.UTC(2026, 5, 15, 9, 0, 0)),
        dtend: new Date(Date.UTC(2026, 5, 15, 10, 0, 0)),
        tzid: "Europe/Lisbon",
      };
      const out = buildIcal([ev], { calName: "x" });
      const unfolded = out.replace(/\r\n /g, "");
      // No replacement characters introduced (would indicate mid-codepoint split).
      expect(unfolded).not.toContain("�");
      expect(unfolded).toContain(`SUMMARY:${summary}`);
    });
  });
});
