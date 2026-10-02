/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import TodayView from "./TodayView";
import type { TripDayState } from "@/lib/trip/live";

/**
 * Today reads and writes through whichever routes its page gives it: the
 * share link's for guests, the members' for the trip page. Without either it
 * is read-only.
 */

const calls = vi.hoisted(() => ({ actions: [] as unknown[][], expenses: [] as unknown[][], feed: [] as unknown[][] }));
// The chips' channel also refreshes the expense panel.
const refetchExpenses = vi.hoisted(() => async () => undefined);

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
  useTodayActions: (...args: unknown[]) => {
    calls.actions.push(args);
    return { actions: [], busy: false, error: null, apply: vi.fn(), undo: vi.fn() };
  },
}));
vi.mock("@/lib/expenses/useTripExpenses", () => ({
  useTripExpenses: (...args: unknown[]) => {
    calls.expenses.push(args);
    return { expenses: [], summary: null, busy: false, error: null, add: vi.fn(), remove: vi.fn(), refetch: refetchExpenses };
  },
}));
vi.mock("@/lib/feed/useTripFeed", () => ({
  useTripFeed: (...args: unknown[]) => {
    calls.feed.push(args);
    return { events: [], refetch: vi.fn() };
  },
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

function renderToday(apiBase?: string) {
  render(
    <TodayView
      itinerary={[{ day_number: 1, date: "2026-10-01", theme: "", activities: [] } as never]}
      dayState={dayState}
      onViewFullItinerary={vi.fn()}
      tripId="trip-1"
      apiBase={apiBase}
    />,
  );
}

beforeEach(() => {
  calls.actions.length = 0;
  calls.expenses.length = 0;
  calls.feed.length = 0;
});

describe("Today's routes", () => {
  it("uses the members' routes on the trip page, share link or not", () => {
    renderToday("/api/trips/trip-1/today");
    expect(calls.actions[0]).toEqual(["/api/trips/trip-1/today", "trip-1", true, refetchExpenses]);
    expect(calls.expenses[0]).toEqual(["/api/trips/trip-1/today", true]);
    expect(calls.feed[0]).toEqual(["/api/trips/trip-1/today", true]);
  });

  it("uses the share link's routes for guests", () => {
    renderToday("/api/shared/token-1");
    expect(calls.actions[0]).toEqual(["/api/shared/token-1", "trip-1", true, refetchExpenses]);
  });

  it("is read-only without routes", () => {
    renderToday(undefined);
    expect(calls.actions[0]?.[2]).toBe(false);
    expect(calls.expenses[0]?.[1]).toBe(false);
    expect(calls.feed[0]?.[1]).toBe(false);
  });
});
