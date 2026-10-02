/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import TodayView from "./TodayView";
import { weatherCondition } from "@/lib/trips/weather-note";
import type { TripDayState } from "@/lib/trip/live";

/**
 * Today shows the weather as a condition, never the note's figures: the note
 * is model prose, and its temperatures are invented (lib/trips/weather-note).
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/components/ActivityCard", () => ({ default: () => null }));
vi.mock("@/components/trip/TodayPacking", () => ({ default: () => null }));
vi.mock("@/components/trip/TodayExpenses", () => ({ default: () => null }));
vi.mock("@/components/trip/TodayFeed", () => ({ default: () => null }));
vi.mock("@/components/trip/ExpenseQuickAdd", () => ({ default: () => null }));
vi.mock("@/lib/today/useTodayActions", () => ({
  useTodayActions: () => ({ actions: [], busy: false, error: null, apply: vi.fn(), undo: vi.fn() }),
}));
vi.mock("@/lib/expenses/useTripExpenses", () => ({ useTripExpenses: () => ({ expenses: [], summary: null, add: vi.fn() }) }));
vi.mock("@/lib/feed/useTripFeed", () => ({ useTripFeed: () => ({ events: [], refetch: vi.fn() }) }));

const dayState: TripDayState = {
  phase: "live",
  isLive: true,
  dayNumber: 1,
  totalDays: 1,
  todayLocalDate: "2026-10-01",
  daysUntilStart: 0,
  timeZone: "Europe/Lisbon",
  timeZoneSource: "stored",
};

describe("Today's weather", () => {
  it("names the condition and drops the invented figure", () => {
    const { container } = render(
      <TodayView
        itinerary={[{ day_number: 1, date: "2026-10-01", theme: "", activities: [] } as never]}
        dayState={dayState}
        weatherNote="Expect sunny days with temperatures around 20-25°C."
        onViewFullItinerary={vi.fn()}
      />
    );
    expect(container.textContent).toContain("destination.weather.sunny");
    expect(container.textContent).not.toContain("20-25°C");
    expect(container.textContent).not.toContain("Expect sunny days");
  });

  it.each([
    ["Light showers most afternoons, 14°C", "rainy", "🌧️"],
    ["Overcast and 9-12°C", "cloudy", "☁️"],
    ["Snow likely, -3°C", "cold", "❄️"],
    ["Mild spring weather", "pleasant", "🌤️"],
  ] as const)("reads %s as %s", (note, key, icon) => {
    expect(weatherCondition(note)).toMatchObject({ conditionKey: key, icon });
  });
});
