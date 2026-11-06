/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { ItineraryDay } from "@/types";
import ReadOnlyItinerary from "./ReadOnlyItinerary";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/i18n/activity-type", () => ({ useActivityTypeLabel: () => (type: string) => type }));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (value: number, currency: string) => ({ formatted: `${value} ${currency}` }) }),
}));
vi.mock("@/components/ActivityCard", () => ({
  default: ({ activity, currency }: { activity: { name: string }; currency?: string }) => (
    <div data-testid="card" data-currency={currency ?? "none"}>
      {activity.name}
    </div>
  ),
}));
vi.mock("@/components/ui/DaySlider", () => ({
  default: ({ days, onSelectDay }: { days: ItineraryDay[]; onSelectDay: (n: number | null) => void }) => (
    <div>
      {days.map((d) => (
        <button key={d.day_number} onClick={() => onSelectDay(d.day_number)}>{`Day ${d.day_number}`}</button>
      ))}
    </div>
  ),
}));
vi.mock("./TravelConnector", () => ({ default: () => <div data-testid="connector" /> }));
vi.mock("./DaySummary", () => ({ default: ({ dayNumber }: { dayNumber: number }) => <div data-testid={`summary-${dayNumber}`} /> }));

const activity = (id: string, cost?: { amount: number; currency?: string }) =>
  ({ id, name: `Sight ${id}`, type: "attraction", start_time: "09:00", duration_minutes: 60, description: "", location: "Lisbon", estimated_cost: cost }) as never;
const DAYS = [
  { day_number: 1, date: "2026-10-10", theme: "Alfama", activities: [activity("a1"), activity("a2", { amount: 7 })] },
  { day_number: 2, date: "2026-10-11", theme: "Belém", activities: [activity("b1")] },
] as unknown as ItineraryDay[];

function show(props: Partial<ComponentProps<typeof ReadOnlyItinerary>> & { picked?: number | null } = {}) {
  const { picked = null, ...rest } = props;
  return render(
    <ReadOnlyItinerary
      days={DAYS}
      selectedDay={picked}
      onSelectDay={() => {}}
      viewMode="cards"
      travelData={new Map()}
      travelLoading={false}
      currency={undefined}
      fallbackCurrency="EUR"
      pace="moderate"
      dayTitle={(day) => `Title ${day.day_number}`}
      budgetLabel="Budget"
      formatDayBudget={() => "40 EUR"}
      emptyTitle="Nothing planned"
      emptyMessage="This trip has no days yet."
      {...rest}
    />
  );
}

afterEach(cleanup);

describe("ReadOnlyItinerary", () => {
  it("shows every day's activities as cards, with a connector between each pair and the day's summary", () => {
    show();
    expect(screen.getAllByTestId("card").map((c) => c.textContent)).toEqual(["Sight a1", "Sight a2", "Sight b1"]);
    expect(screen.getAllByTestId("connector")).toHaveLength(1);
    expect(screen.getByTestId("summary-1")).toBeTruthy();
    expect(screen.getByText("Title 2")).toBeTruthy();
  });

  it("offers a day with at least two stops its route in Google Maps", () => {
    show();
    const links = screen.getAllByRole("link", { name: "day.route" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toContain("origin=Sight%20a1%2C%20Lisbon");
    expect(links[0].getAttribute("href")).toContain("destination=Sight%20a2%2C%20Lisbon");
  });

  it("shows only the picked day", () => {
    show({ picked: 2 });
    expect(screen.getAllByTestId("card").map((c) => c.textContent)).toEqual(["Sight b1"]);
    expect(screen.queryByText("Title 1")).toBeNull();
  });

  it("hands the day picker's choice back", () => {
    const onSelectDay = vi.fn();
    show({ onSelectDay });
    fireEvent.click(screen.getByText("Day 2"));
    expect(onSelectDay).toHaveBeenCalledWith(2);
  });

  it("prices the timeline in the trip's currency, or the fallback when it has none", () => {
    const { unmount } = show({ viewMode: "timeline" });
    expect(screen.getByText("7 EUR")).toBeTruthy();
    unmount();
    show({ viewMode: "timeline", currency: "GBP" });
    expect(screen.getByText("7 GBP")).toBeTruthy();
  });

  it("leaves the cards' currency unset when the trip has none", () => {
    show();
    expect(screen.getAllByTestId("card")[0].dataset.currency).toBe("none");
  });

  it("puts what the page adds under the activities it is for, in both views", () => {
    const extra = (a: { id?: string }) => (a.id === "a1" ? <span>votes for a1</span> : null);
    const { unmount } = show({ activityExtra: extra });
    expect(screen.getAllByText(/^votes for/)).toHaveLength(1);
    expect(within(screen.getByText("votes for a1").parentElement!.parentElement!).getByText("Sight a1")).toBeTruthy();
    unmount();
    show({ activityExtra: extra, viewMode: "timeline" });
    expect(screen.getAllByText(/^votes for/)).toHaveLength(1);
  });

  it("says when the trip has no days", () => {
    show({ days: [] });
    expect(screen.getByText("Nothing planned")).toBeTruthy();
    expect(screen.getByText("This trip has no days yet.")).toBeTruthy();
    expect(screen.queryByTestId("card")).toBeNull();
  });
});
