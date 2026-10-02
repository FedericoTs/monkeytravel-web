/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { TripForExport } from "@/types";

/**
 * Saved activities can lack a field the type promises: a time, a name, a
 * duration, a description or a place. The basic PDF used to throw on any of
 * them, so the whole export failed for that trip.
 */

vi.mock("@/lib/locale/currency", () => ({
  getExchangeRates: async () => null,
  convertCurrency: (amount: number) => amount,
  formatCurrencyValue: (amount: number, currency: string) => `${amount} ${currency}`,
}));

const { generateTripPDF } = await import("./pdf");

const trip = (activity: Record<string, unknown>): TripForExport =>
  ({
    title: "Lisbon",
    startDate: "2026-10-20",
    endDate: "2026-10-20",
    itinerary: [
      {
        day_number: 1,
        date: "2026-10-20",
        theme: "Old town",
        activities: [
          { id: "a1", type: "attraction", name: "Castle", start_time: "09:00", duration_minutes: 90, description: "Views", location: "Alfama", estimated_cost: { amount: 15, currency: "EUR" } },
          { id: "a2", type: "activity", ...activity },
        ],
      },
    ],
  }) as unknown as TripForExport;

describe("generateTripPDF", () => {
  it("exports an activity that has no time, name, duration, description or place", async () => {
    const pdf = await generateTripPDF(trip({}));
    expect(pdf.size).toBeGreaterThan(0);
  });

  it("exports an activity with only a name", async () => {
    const pdf = await generateTripPDF(trip({ name: "Tram 28" }));
    expect(pdf.size).toBeGreaterThan(0);
  });
});
