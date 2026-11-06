import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { GeneratedItinerary } from "@/types";

/**
 * Someone who asked for a plan gets the plan first. Only about one person in five
 * who gets one clicks Save, and the first day used to start two screens down, under
 * the map, the numbers and the booking links.
 */

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (n: number) => ({ formatted: String(n) }), format: (n: number) => String(n) }),
}));
vi.mock("next/dynamic", () => ({
  default: (load: () => Promise<unknown>) => {
    const source = load.toString();
    const name = source.includes("TripMap") ? "map" : source.includes("ValuePropositionBanner") ? "save-banner" : "activity";
    return function Dynamic() {
      return <div data-testid={name} />;
    };
  },
}));
vi.mock("@/components/trip/DayHeader", () => ({
  default: ({ title }: { title: string }) => <h3>{title}</h3>,
  DayBudget: () => null,
}));
vi.mock("@/components/trip/DayTimeline", () => ({ DayTimeline: () => <div data-testid="timeline" /> }));
vi.mock("@/components/wizard/ResultSections", () => ({
  ResultStats: () => <div data-testid="stats" />,
  ResultBookingLinks: () => <div data-testid="booking-links" />,
  ResultPacking: () => <div data-testid="packing" />,
}));

import ResultItinerary from "./ResultItinerary";

type Props = ComponentProps<typeof ResultItinerary>;

const itinerary = {
  days: [
    { day_number: 1, activities: [{ id: "a1", name: "Market" }] },
    { day_number: 2, activities: [{ id: "a2", name: "Museum" }] },
  ],
  booking_links: { flights: [], hotels: [] },
  trip_summary: { currency: "EUR", packing_suggestions: ["Shoes"] },
} as unknown as GeneratedItinerary;

const show = (props: Partial<Props> = {}) =>
  render(
    <ResultItinerary
      generatedItinerary={itinerary}
      fullDestination="Lisbon, Portugal"
      pace="moderate"
      resultViewMode="cards"
      setResultViewMode={vi.fn()}
      showMap={true}
      setShowMap={vi.fn()}
      travelData={new Map()}
      travelLoading={false}
      handleSaveTrip={vi.fn()}
      loading={false}
      {...props}
    />
  );

/** Whether `a` comes before `b` on the page. */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the plan on the result page", () => {
  it("offers a day with at least two stops its route in Google Maps", () => {
    const twoStops = {
      ...itinerary,
      days: [
        { day_number: 1, activities: [{ id: "a1", name: "Market" }, { id: "a2", name: "Museum" }] },
        { day_number: 2, activities: [{ id: "a3", name: "Park" }] },
      ],
    } as unknown as GeneratedItinerary;
    show({ generatedItinerary: twoStops });
    const links = screen.getAllByRole("link", { name: "day.route" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toContain("origin=Market");
    expect(document.getElementById("day-1")!.contains(links[0])).toBe(true);
  });

  it("starts with the days, ahead of the map, the numbers and the booking links", () => {
    show();
    const dayOne = screen.getAllByText("wizard.result.dayLabel")[0];
    for (const later of ["map", "stats", "booking-links", "packing"]) {
      expect(before(dayOne, screen.getByTestId(later)), later).toBe(true);
    }
  });

  it("asks to save after the first day, not before it, and only once", () => {
    show();
    const banner = screen.getByTestId("save-banner");
    const days = screen.getAllByTestId("activity");
    expect(before(days[0], banner)).toBe(true);
    expect(before(banner, days[1])).toBe(true);
    expect(screen.getAllByTestId("save-banner")).toHaveLength(1);
  });

  it("keeps the map, then the numbers, the links and the packing list, after the days", () => {
    show();
    const order = ["map", "stats", "booking-links", "packing"].map((id) => screen.getByTestId(id));
    const lastDay = screen.getAllByTestId("activity").at(-1)!;
    expect(before(lastDay, order[0])).toBe(true);
    for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i])).toBe(true);
  });

  it("takes you to the map from above the days, opening it if it was hidden", () => {
    const setShowMap = vi.fn();
    const scrolledTo: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolledTo.push(this);
    };
    show({ showMap: false, setShowMap });
    expect(screen.queryByTestId("map")).toBeNull();
    const [goToMap] = screen.getAllByRole("button", { name: /wizard\.result\.showMap/ });
    // A phone has room for the word here, and an icon alone says little.
    expect(goToMap.querySelector("span")?.className ?? "").not.toContain("hidden");
    expect(before(goToMap, screen.getAllByText("wizard.result.dayLabel")[0])).toBe(true);
    fireEvent.click(goToMap);
    expect(setShowMap).toHaveBeenCalledWith(true);
    expect(scrolledTo[0]?.id).toBe("trip-overview");
  });

  it("can still hide the map where it is", () => {
    const setShowMap = vi.fn((update: boolean | ((shown: boolean) => boolean)) => update);
    show({ setShowMap });
    fireEvent.click(screen.getByRole("button", { name: /wizard\.result\.hideMap/ }));
    const update = setShowMap.mock.calls[0][0] as (shown: boolean) => boolean;
    expect(update(true)).toBe(false);
  });

  it("switches between cards and a timeline from above the days", () => {
    const setResultViewMode = vi.fn();
    show({ setResultViewMode });
    const timeline = screen.getByRole("button", { name: /wizard\.result\.viewTimeline/ });
    expect(before(timeline, screen.getAllByText("wizard.result.dayLabel")[0])).toBe(true);
    fireEvent.click(timeline);
    expect(setResultViewMode).toHaveBeenCalledWith("timeline");
  });
});
