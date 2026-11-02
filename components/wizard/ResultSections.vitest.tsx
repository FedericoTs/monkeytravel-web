import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Activity, GeneratedItinerary } from "@/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, currency: string) => ({ formatted: `${currency} ${amount}` }) }),
}));
vi.mock("@/lib/i18n/pace", () => ({ usePaceLabel: () => (pace: unknown) => `pace:${String(pace)}` }));
vi.mock("@/lib/i18n/activity-type", () => ({ useActivityTypeLabel: () => (type?: string) => (type ? `type:${type}` : "") }));

import { ResultBookingLinks, ResultPacking, ResultStats, ResultTimeline } from "./ResultSections";

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
  it("shows the trip's length, budget in the visitor's currency, activity count and pace", () => {
    const { container } = render(<ResultStats itinerary={itinerary} pace="relaxed" />);
    expect([...container.querySelectorAll(".text-xl")].map((v) => v.textContent)).toEqual([
      'wizard.result.days {"count":2}',
      "EUR 900",
      "3",
      "pace:relaxed",
    ]);
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

describe("a day in the result view's timeline", () => {
  it("gives each row the id a map pin scrolls to, from the activity's id or else its name", () => {
    const { container } = render(
      <ResultTimeline
        activities={[activity({ id: "a1" }), activity({ name: "Café de Flore!" }), activity({ name: "" })]}
        currency="EUR"
      />
    );
    expect([...container.querySelectorAll("[id]")].map((row) => row.id)).toEqual([
      "activity-a1",
      "activity-caf-de-flore-",
      "activity-unknown",
    ]);
  });

  it("pins a locked activity and prefers its address to its area", () => {
    render(<ResultTimeline activities={[activity({ locked: true, address: "Rue de Rivoli", location: "1er" })]} currency="EUR" />);
    expect(screen.getByLabelText("wizard.anchors.lockedBadge").textContent).toBe("📌");
    expect(screen.getByText("Rue de Rivoli")).toBeTruthy();
    expect(screen.queryByText("1er")).toBeNull();
  });

  it("prices an activity in its own currency, else the trip's, and leaves out a price it does not know", () => {
    render(
      <ResultTimeline
        activities={[
          activity({ name: "A", estimated_cost: { amount: 22, currency: "GBP" } as Activity["estimated_cost"] }),
          activity({ name: "B", estimated_cost: { amount: 0 } as Activity["estimated_cost"] }),
          activity({ name: "C", estimated_cost: { amount: null } as unknown as Activity["estimated_cost"] }),
        ]}
        currency="EUR"
      />
    );
    expect(screen.getByText("GBP 22")).toBeTruthy();
    expect(screen.getByText("EUR 0")).toBeTruthy();
    expect(screen.getAllByText("type:museum")).toHaveLength(2);
  });

  it("shows the start time and how long it lasts", () => {
    render(<ResultTimeline activities={[activity({})]} currency="EUR" />);
    expect(screen.getByText("09:00")).toBeTruthy();
    expect(screen.getByText("90 min")).toBeTruthy();
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
