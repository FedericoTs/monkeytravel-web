import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import TripDayDigestEmail, {
  tripDayDigestEmailText,
  tripDayDigestSubject,
  type TripDayDigestEmailProps,
} from "./TripDayDigest";
import type { ContextBlock } from "../trip-context";
import {
  verifyRenderedEmail,
  blockingDefects,
  summarizeDefects,
} from "../verify-render";

/**
 * The in-trip day digest template (Phase 4.1) + its containment contract.
 *
 * The email's body is tomorrow's plan, read from the trip's own itinerary, so
 * these tests pin two things the cron relies on: the plan actually renders, and
 * the shared verify gate passes it — with the "+N more" line kept OUTSIDE the
 * context block, because that line is UI copy the containment check would
 * otherwise (correctly) reject as not-from-this-trip.
 */

const blocks: ContextBlock[] = [
  {
    label: "Alfama & the Castle",
    items: [
      { text: "Jerónimos Monastery", meta: "09:00" },
      { text: "Lunch at Clara", meta: "13:00" },
    ],
  },
];

const ownStrings = ["Alfama & the Castle", "Jerónimos Monastery", "09:00", "Lunch at Clara", "13:00"];

const base: TripDayDigestEmailProps = {
  day: 3,
  destination: "Lisbon",
  heading: "Tomorrow: Day 3",
  intro: "Here's what tomorrow looks like.",
  blocks,
  andMore: "+1 more",
  ctaLabel: "See tomorrow's plan",
  tripUrl: "https://monkeytravel.app/trips/abc123?slot=in_trip_day_3",
  locale: "en",
};

describe("TripDayDigestEmail", () => {
  it("renders the day plan, destination and CTA", async () => {
    const html = await render(TripDayDigestEmail(base));
    expect(html).toContain("Tomorrow: Day 3");
    expect(html).toContain("Lisbon");
    expect(html).toContain("Jerónimos Monastery");
    expect(html).toContain("09:00");
    expect(html).toContain("+1 more");
    expect(html).toContain("in_trip_day_3"); // CTA deep link carries the slot
    // No unresolved ICU placeholders survived into the body.
    expect(html).not.toMatch(/\{(day|count|destination)\}/);
  });

  it("passes the shared verify gate (containment included)", async () => {
    const html = await render(TripDayDigestEmail(base));
    const subject = tripDayDigestSubject({ heading: base.heading, destination: base.destination });
    const defects = blockingDefects(
      verifyRenderedEmail({
        subject,
        html,
        destination: base.destination,
        ctaUrl: base.tripUrl,
        contextBlocks: base.blocks,
        ownStrings,
      })
    );
    expect(summarizeDefects(defects)).toBe("");
    expect(defects).toHaveLength(0);
  });

  it("shows the empty line when tomorrow has no activities", async () => {
    const html = await render(
      TripDayDigestEmail({ ...base, blocks: [], andMore: undefined, emptyLine: "Nothing planned for day 3 yet." })
    );
    expect(html).toContain("Nothing planned for day 3 yet.");
    expect(html).not.toContain("Jerónimos Monastery");
  });

  it("subject appends the destination, once", () => {
    expect(tripDayDigestSubject({ heading: "Tomorrow: Day 3", destination: "Lisbon" })).toBe(
      "Tomorrow: Day 3 — Lisbon"
    );
    // If a heading already names the place, it is not doubled.
    expect(tripDayDigestSubject({ heading: "Tomorrow in Lisbon", destination: "Lisbon" })).toBe(
      "Tomorrow in Lisbon"
    );
  });

  it("plain-text fallback carries the plan and the link", () => {
    const text = tripDayDigestEmailText(base);
    expect(text).toContain("Jerónimos Monastery");
    expect(text).toContain(base.tripUrl);
    expect(text).toContain("+1 more");
  });

  describe("the group box", () => {
    // No apostrophes: the HTML escapes them.
    const groupSend = {
      text: "Travelling together? Send the plan to your group chat.",
      label: "Send the plan to the group",
      url: "https://monkeytravel.app/day/abc/2026-10-15?k=1.x&slot=in_trip_day_3&s=1.y&share=group",
    };

    it("renders below the main button when given, and not otherwise", async () => {
      const html = await render(TripDayDigestEmail({ ...base, groupSend }));
      expect(html).toContain(groupSend.text);
      expect(html).toContain(groupSend.label);
      expect(html).toContain("share=group");
      expect(html.indexOf(base.tripUrl)).toBeGreaterThan(-1);
      expect(html.indexOf(base.tripUrl)).toBeLessThan(html.indexOf(groupSend.label));

      const without = await render(TripDayDigestEmail(base));
      expect(without).not.toContain(groupSend.label);
      expect(without).not.toContain("share=group");
    });

    it("is in the plain text too", () => {
      const text = tripDayDigestEmailText({ ...base, groupSend });
      expect(text).toContain(groupSend.text);
      expect(text).toContain(`${groupSend.label}: ${groupSend.url}`);
      expect(tripDayDigestEmailText(base)).not.toContain(groupSend.label);
    });

    it("still passes the verify gate", async () => {
      const html = await render(TripDayDigestEmail({ ...base, groupSend }));
      const subject = tripDayDigestSubject({ heading: base.heading, destination: base.destination });
      const defects = blockingDefects(
        verifyRenderedEmail({ subject, html, destination: base.destination, ctaUrl: base.tripUrl, contextBlocks: base.blocks, ownStrings })
      );
      expect(summarizeDefects(defects)).toBe("");
    });
  });
});
