import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Activity, ItineraryDay } from "@/types";

const connectors = vi.fn();
const summaries = vi.fn();
vi.mock("./TravelConnector", () => ({
  default: (props: Record<string, unknown>) => {
    connectors(props);
    return <div data-testid="leg" />;
  },
}));
vi.mock("./DaySummary", () => ({
  default: (props: Record<string, unknown>) => {
    summaries(props);
    return <div data-testid="summary" />;
  },
}));

import { DayTimeline } from "./DayTimeline";

const activity = (id: string, name: string, extra: Partial<Activity> = {}) =>
  ({ id, name, start_time: "09:00", duration_minutes: 60, description: `${name} today`, location: "Centro", type: "museum", ...extra }) as Activity;
const day = {
  day_number: 3,
  date: "2026-11-03",
  activities: [activity("a1", "Museum", { address: "Via Roma 1" }), activity("a2", "Lunch"), activity("a3", "Walk")],
} as ItineraryDay;
const leg = { fromActivityId: "a1", toActivityId: "a2", distanceMeters: 900, durationSeconds: 660, distanceText: "0.9 km", durationText: "11 min", mode: "walking" };

function show(extra?: (a: Activity) => React.ReactNode, travelLoading = false) {
  connectors.mockClear();
  summaries.mockClear();
  return render(
    <DayTimeline
      day={day}
      travel={{ segments: [leg], isLoading: false } as never}
      travelLoading={travelLoading}
      pace="relaxed"
      typeLabel={(t) => `type:${t}`}
      price={(a) => (a.id === "a2" ? "€15" : null)}
      extra={extra}
    />
  );
}

describe("a day as a timeline", () => {
  it("lists each activity with its time, place, price and type", () => {
    show();
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Museum", "Lunch", "Walk"]);
    expect(screen.getByText("Via Roma 1")).toBeTruthy();
    expect(screen.getAllByText("Centro")).toHaveLength(2);
    expect(screen.getByText("€15")).toBeTruthy();
    expect(screen.getAllByText("type:museum")).toHaveLength(3);
    expect(screen.getAllByText("60 min")).toHaveLength(3);
  });

  it("puts a compact travel leg between activities, with the leg the day's travel has", () => {
    show();
    expect(screen.getAllByTestId("leg")).toHaveLength(2);
    expect(connectors.mock.calls[0][0]).toMatchObject({ distanceMeters: 900, durationText: "11 min", mode: "walking", compact: true, isLoading: false });
    expect(connectors.mock.calls[1][0]).toMatchObject({ distanceMeters: undefined, compact: true });
  });

  it("shows the legs as loading while the trip's travel is", () => {
    show(undefined, true);
    expect(connectors.mock.calls.every(([p]) => p.isLoading === true)).toBe(true);
  });

  it("ends with the day's summary at the trip's pace", () => {
    show();
    expect(summaries).toHaveBeenCalledWith(expect.objectContaining({ dayNumber: 3, segments: [leg], pace: "relaxed", className: "mt-4" }));
  });

  it("adds what the page shows under an activity", () => {
    show((a) => (a.id === "a1" ? <p>2 votes</p> : null));
    expect(screen.getByText("2 votes")).toBeTruthy();
  });
});
