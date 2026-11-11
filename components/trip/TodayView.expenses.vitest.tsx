/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TodayView from "./TodayView";
import type { TripDayState } from "@/lib/trip/live";

/**
 * "Who paid?" on the day follows the trip's expense switch, as the ledger and
 * Settle up do: with it off, the day neither offers expenses nor reads them.
 */

const expenseReads = vi.hoisted(() => [] as unknown[][]);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/components/ActivityCard", () => ({ default: () => null }));
vi.mock("@/components/trip/TodayPacking", () => ({ default: () => null }));
vi.mock("@/components/trip/TodayFeed", () => ({ default: () => null }));
vi.mock("@/components/trip/TodayExpenses", () => ({ default: () => <section aria-label="the day's expenses" /> }));
vi.mock("@/components/trip/ExpenseQuickAdd", () => ({ default: () => <button type="button">who paid for this stop</button> }));
vi.mock("@/lib/today/useTodayActions", () => ({
  useTodayActions: () => ({ actions: [], busy: false, error: null, apply: vi.fn(), undo: vi.fn() }),
}));
vi.mock("@/lib/expenses/useTripExpenses", () => ({
  useTripExpenses: (...args: unknown[]) => {
    expenseReads.push(args);
    return { expenses: [], summary: null, busy: false, error: null, add: vi.fn(), remove: vi.fn(), refetch: vi.fn() };
  },
}));
vi.mock("@/lib/feed/useTripFeed", () => ({
  useTripFeed: () => ({ events: [], refetch: vi.fn() }),
}));

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

function renderToday() {
  render(
    <TodayView
      itinerary={[
        {
          day_number: 1,
          date: "2026-10-01",
          theme: "",
          activities: [
            { id: "a", name: "Market", start_time: "09:00" },
            { id: "b", name: "Museum", start_time: "11:00" },
          ],
        } as never,
      ]}
      dayState={dayState}
      onViewFullItinerary={vi.fn()}
      tripId="trip-1"
      apiBase="/api/trips/trip-1/today"
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  expenseReads.length = 0;
});

describe("Who paid? on the day", () => {
  it("is not offered, and no expenses are read, with expenses switched off", () => {
    vi.stubEnv("NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED", "false");
    renderToday();
    expect(screen.queryAllByRole("button", { name: "who paid for this stop" })).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "the day's expenses" })).toBeNull();
    expect(expenseReads[0]).toEqual(["/api/trips/trip-1/today", false]);
  });

  it("is offered on each stop and for the day, with expenses switched on", () => {
    vi.stubEnv("NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED", "true");
    renderToday();
    expect(screen.getAllByRole("button", { name: "who paid for this stop" })).toHaveLength(2);
    expect(screen.getByRole("region", { name: "the day's expenses" })).toBeTruthy();
    expect(expenseReads[0]).toEqual(["/api/trips/trip-1/today", true]);
  });
});
