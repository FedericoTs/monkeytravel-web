// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildContextBlocks, type ContextLabels } from "@/lib/email/trip-context";
import { blockingDefects, verifyRenderedEmail } from "@/lib/email/verify-render";
import { ownEnrichmentStrings } from "./slot-email";
import type { TripEmailRow } from "./slot-row";

/**
 * The travel-day email gained tomorrow's plan, and the gate that checks every
 * line of an email against the trip's own data knew day one only: it refused
 * a real travel-day email for listing day two's stops. Every line the email
 * shows must be in the trip's own strings.
 */

const LABELS: ContextLabels = {
  weather: "Weather",
  packing: "Packing",
  goingFor: "Going for",
  dayOne: "Day one",
  today: "Today's plan",
  tomorrow: "Tomorrow's plan",
  yourHighlights: "Highlights",
};

const day = (n: number, stops: Array<[string, string]>) => ({
  day_number: n,
  activities: stops.map(([name, start_time]) => ({ name, start_time })),
});
const day1 = day(1, [["Las Olas Boulevard", "10:00"], ["Coconuts", "13:00"]]);
const day2 = day(2, [["Fort Lauderdale Beach Park", "09:30"], ["Everglades Holiday Park Airboat Tours", "14:30"]]);
const trip = { day1, itinerary: [day1, day2], highlights: [], packing_suggestions: [], weather_note: null } as unknown as TripEmailRow;
const CTA = "https://monkeytravel.app/day/trip/2026-11-08";

describe("the travel-day email", () => {
  it("passes the gate with tomorrow's plan in it", () => {
    const contextBlocks = buildContextBlocks("morning_of", { day1, itinerary: trip.itinerary }, LABELS);
    expect(contextBlocks.map((b) => b.label)).toEqual(["Today's plan", "Tomorrow's plan"]);
    const html = `<p>Fort Lauderdale</p><a href="${CTA}">Open</a>${contextBlocks.flatMap((b) => b.items ?? []).map((i) => `<li>${i.text} ${i.meta ?? ""}</li>`).join("")}`;
    const defects = blockingDefects(
      verifyRenderedEmail({
        subject: "Travel day",
        html,
        destination: "Fort Lauderdale",
        ctaUrl: CTA,
        contextBlocks,
        ownStrings: ownEnrichmentStrings(trip),
      })
    );
    expect(defects).toEqual([]);
  });

  it("still refuses a line that isn't in this trip", () => {
    const contextBlocks = [{ label: "Tomorrow's plan", items: [{ text: "Louvre Museum", meta: "09:00" }] }];
    const defects = blockingDefects(
      verifyRenderedEmail({
        subject: "Travel day",
        html: `<p>Fort Lauderdale</p><a href="${CTA}">Open</a><li>Louvre Museum 09:00</li>`,
        destination: "Fort Lauderdale",
        ctaUrl: CTA,
        contextBlocks,
        ownStrings: ownEnrichmentStrings(trip),
      })
    );
    expect(defects.map((d) => d.check)).toContain("containment");
  });
});
