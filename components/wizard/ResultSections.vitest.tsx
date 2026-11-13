import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Activity, GeneratedItinerary } from "@/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
// The page's exchange rates, null until they load.
const fx = vi.hoisted(() => ({ rates: null as { base: string; rates: Record<string, number> } | null }));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, currency: string) => ({ formatted: `${currency} ${amount}` }), exchangeRates: fx.rates }),
}));
vi.mock("@/lib/i18n/pace", () => ({ usePaceLabel: () => (pace: unknown) => `pace:${String(pace)}` }));

import { ResultBookingLinks, ResultPacking, ResultStats } from "./ResultSections";

const activity = (extra: Partial<Activity>) =>
  ({ name: "Louvre", start_time: "09:00", duration_minutes: 90, type: "museum", ...extra }) as Activity;

const itinerary = {
  days: [
    { day_number: 1, activities: [activity({}), activity({ name: "Lunch" })] },
    { day_number: 2, activities: [activity({ name: "Orsay" })] },
  ],
  trip_summary: { total_estimated_cost: 900, currency: "EUR", highlights: [], packing_suggestions: [] },
} as unknown as GeneratedItinerary;

describe("the result view's stats", () => {
  const priced = {
    ...itinerary,
    days: [
      { day_number: 1, activities: [activity({ estimated_cost: { amount: 22, currency: "EUR" } as Activity["estimated_cost"] }), activity({ name: "Lunch", estimated_cost: { amount: 18, currency: "EUR" } as Activity["estimated_cost"] })] },
      { day_number: 2, activities: [activity({ name: "Orsay", estimated_cost: { amount: 16, currency: "EUR" } as Activity["estimated_cost"] })] },
    ],
  } as unknown as GeneratedItinerary;

  it("shows the trip's length, its stops' cost per person in the visitor's currency, activity count and pace", () => {
    const { container } = render(<ResultStats itinerary={priced} pace="relaxed" />);
    expect([...container.querySelectorAll(".text-xl")].map((v) => v.textContent)).toEqual([
      'wizard.result.days {"count":2}',
      "EUR 56",
      "3",
      "pace:relaxed",
    ]);
  });

  // A stop priced in another currency counts at the page's rates, never as its bare number.
  describe("for a plan whose stops are priced in two currencies", () => {
    const twoCurrencies = {
      ...itinerary,
      days: [
        { day_number: 1, activities: [activity({ estimated_cost: { amount: 22, currency: "EUR" } as Activity["estimated_cost"] }), activity({ name: "Afternoon tea", estimated_cost: { amount: 10, currency: "GBP" } as Activity["estimated_cost"] })] },
      ],
    } as unknown as GeneratedItinerary;

    it("adds each stop at the page's rates", () => {
      // 10 pounds are 12.50 euros at 0.8 pounds to the euro: 34.50 in all.
      fx.rates = { base: "EUR", rates: { GBP: 0.8 } };
      const { container } = render(<ResultStats itinerary={twoCurrencies} pace="relaxed" />);
      expect([...container.querySelectorAll(".text-xl")].map((v) => v.textContent)).toEqual(['wizard.result.days {"count":1}', "EUR 35", "2", "pace:relaxed"]);
      fx.rates = null;
    });

    it("shows no total until the rates load, rather than a wrong one", () => {
      fx.rates = null;
      const { container } = render(<ResultStats itinerary={twoCurrencies} pace="relaxed" />);
      expect([...container.querySelectorAll(".text-xl")].map((v) => v.textContent)).toEqual(['wizard.result.days {"count":1}', "2", "pace:relaxed"]);
    });
  });

  // The estimate the model wrote never moves after a change; with no stop priced there's no total to show.
  it("shows no total for a plan that prices nothing, whatever the model estimated", () => {
    const { container } = render(<ResultStats itinerary={itinerary} pace="relaxed" />);
    expect([...container.querySelectorAll(".text-xl")].map((v) => v.textContent)).toEqual(['wizard.result.days {"count":2}', "3", "pace:relaxed"]);
  });
});

describe("the result view's booking links", () => {
  const links = {
    flights: [{ provider: "Skyscanner", url: "https://flights.example/paris", label: "Flights", city: "Paris" }],
    hotels: [
      { provider: "Booking.com", url: "https://hotels.example/1", label: "Hotels" },
      { provider: "Booking.com", url: "https://hotels.example/2", label: "Hotels", city: "Lyon" },
    ],
  };

  it("names a hotel's city on a multi-city trip, never a flight's", () => {
    render(<ResultBookingLinks links={links} />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Skyscanner ↗", "Booking.com ↗", "Booking.com · Lyon ↗"]);
  });

  it("opens each provider in a new tab without handing it the page", () => {
    render(<ResultBookingLinks links={links} />);
    for (const a of screen.getAllByRole("link")) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "https://flights.example/paris",
      "https://hotels.example/1",
      "https://hotels.example/2",
    ]);
  });
});

describe("the result view's packing suggestions", () => {
  it("lists each item", () => {
    render(<ResultPacking items={["Shoes", "Umbrella"]} />);
    expect(screen.getByText("wizard.result.packingSuggestions")).toBeTruthy();
    expect(screen.getByText("Shoes")).toBeTruthy();
    expect(screen.getByText("Umbrella")).toBeTruthy();
  });
});
