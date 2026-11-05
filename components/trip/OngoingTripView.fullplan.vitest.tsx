/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ItineraryDay } from "@/types";
import OngoingTripView from "./OngoingTripView";

/** The Full Plan tab of a trip under way: it opens on today, and any day or all of them can be picked. */

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const plain = (tag: string) => function Plain({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) {
    const { initial, animate, exit, transition, ...dom } = rest;
    void [initial, animate, exit, transition];
    return React.createElement(tag, dom, children);
  };
  return {
    motion: new Proxy({}, { get: (_t, tag: string) => plain(tag) }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});
vi.mock("@/hooks/useNow", () => ({ useNow: () => new Date(2027, 4, 11, 12) }));
vi.mock("@/hooks/useActivityTimeline", () => ({
  useActivityTimeline: () => ({ completeActivity: vi.fn(), skipActivity: vi.fn(), getActivityStatus: () => "upcoming" }),
}));
vi.mock("@/hooks/useTravelDistances", () => ({
  useTravelDistances: () => ({ travelData: new Map(), isLoading: false }),
  segmentBetween: () => undefined,
}));
vi.mock("@/lib/analytics", () => ({ trackActivityCompleted: vi.fn() }));
vi.mock("@/components/trips/JourneyRibbon", () => ({ JourneyRibbon: () => null }));
vi.mock("./SwipeableActivityCard", () => ({ default: () => null }));
vi.mock("./TravelConnector", () => ({ default: () => null }));
vi.mock("./DaySummary", () => ({ default: () => null }));
vi.mock("@/components/ActivityCard", () => ({ default: ({ activity }: { activity: { name: string } }) => <div>{activity.name}</div> }));
vi.mock("@/components/ui/DaySlider", () => ({
  default: ({ selectedDay, onSelectDay }: { selectedDay: number | null; onSelectDay: (day: number | null) => void }) => (
    <div>
      <span data-testid="selected">{String(selectedDay)}</span>
      <button onClick={() => onSelectDay(null)}>all days</button>
      <button onClick={() => onSelectDay(3)}>day three</button>
    </div>
  ),
}));

const itinerary = [1, 2, 3].map((n) => ({
  day_number: n,
  date: `2027-05-${9 + n}`,
  theme: `Theme ${n}`,
  activities: [{ id: `a${n}`, name: `Activity of day ${n}`, type: "landmark", start_time: "10:00", duration_minutes: 60, description: "", location: "Porto" }],
})) as unknown as ItineraryDay[];

const shown = () => [1, 2, 3].filter((n) => screen.queryByText(`Activity of day ${n}`));

beforeEach(() => {
  render(<OngoingTripView tripId="trip-1" destination="Porto" startDate="2027-05-10" endDate="2027-05-12" itinerary={itinerary} />);
  fireEvent.click(screen.getAllByRole("button").find((b) => /fullPlan/i.test(b.textContent ?? ""))!);
});
afterEach(cleanup);

describe("the full plan of a trip under way", () => {
  it("opens on today", () => {
    expect(screen.getByTestId("selected").textContent).toBe("2");
    expect(shown()).toEqual([2]);
  });

  it("shows the day picked", () => {
    fireEvent.click(screen.getByText("day three"));
    expect(screen.getByTestId("selected").textContent).toBe("3");
    expect(shown()).toEqual([3]);
  });

  it("shows every day when all are picked", () => {
    fireEvent.click(screen.getByText("all days"));
    expect(screen.getByTestId("selected").textContent).toBe("null");
    expect(shown()).toEqual([1, 2, 3]);
  });
});
