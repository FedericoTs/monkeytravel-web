import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { GeneratedItinerary } from "@/types";

/**
 * A plan on a phone, as rows: a plan of three days was more than nine screens of tall cards, each with buttons
 * almost nobody pressed, and the first screen showed no stop. The rows put a day on a screen.
 */

vi.mock("next-intl", () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key) }));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (n: number) => ({ formatted: String(n) }), format: (n: number) => String(n) }),
}));
vi.mock("next/dynamic", () => ({
  default: (load: () => Promise<unknown>) => {
    const source = load.toString();
    const name = source.includes("TripMap") ? "map" : source.includes("ValuePropositionBanner") ? "save-banner" : "card";
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
vi.mock("@/components/trip/StopRow", () => ({
  default: ({ activity, currency }: { activity: { name: string }; currency: string }) => (
    <li data-testid="row" data-currency={currency}>
      {activity.name}
    </li>
  ),
  StopRows: ({ children, label }: { children: ReactNode; label: string }) => <ol aria-label={label}>{children}</ol>,
}));
vi.mock("@/components/wizard/ResultSections", () => ({
  ResultStats: () => <div data-testid="stats" />,
  ResultBookingLinks: () => <div data-testid="booking-links" />,
  ResultPacking: ({ plain }: { plain?: boolean }) => <div data-testid="packing" data-plain={String(Boolean(plain))} />,
}));

import ResultItinerary, { MAP_SECTION_ID } from "./ResultItinerary";

type Props = ComponentProps<typeof ResultItinerary>;

const itinerary = {
  days: [
    { day_number: 1, activities: [{ id: "a1", name: "Market" }, { id: "a2", name: "Castle" }] },
    { day_number: 2, activities: [{ id: "a3", name: "Museum" }] },
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
      onAskAssistant={vi.fn()}
      phoneRows
      {...props}
    />,
  );

/** Whether `a` comes before `b` on the page. */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const day = (n: number) => `wizard.result.dayLabel {"n":${n}}`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a plan on a phone, as rows", () => {
  it("opens with the days in a row to jump between, and the map after them", () => {
    const setShowMap = vi.fn();
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function scroll(this: Element) {
      scrolled.push(this.id);
    };
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => (run(0), 0));
    show({ setShowMap });
    const jump = screen.getByRole("navigation", { name: "wizard.result.dayByDay" });
    const links = within(jump).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#day-1", "#day-2", `#${MAP_SECTION_ID}`]);
    expect(links.map((a) => a.textContent)).toEqual([day(1), day(2), "wizard.result.showMap"]);
    fireEvent.click(links[1]);
    expect(scrolled).toEqual(["day-2"]);
    expect(setShowMap).not.toHaveBeenCalled();
    // The map is asked to show before the page goes to it.
    fireEvent.click(links[2]);
    expect(setShowMap).toHaveBeenCalledWith(true);
    expect(scrolled).toEqual(["day-2", MAP_SECTION_ID]);
    // The desktop's controls aren't there too.
    expect(screen.queryByRole("button", { name: "wizard.result.showMap" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("draws each day as one list of rows named for the day, in the plan's currency, and no card", () => {
    show();
    const first = screen.getByRole("list", { name: day(1) });
    expect(within(first).getAllByTestId("row").map((row) => row.textContent)).toEqual(["Market", "Castle"]);
    expect(within(screen.getByRole("list", { name: day(2) })).getAllByTestId("row")).toHaveLength(1);
    expect(screen.getAllByTestId("row").every((row) => row.getAttribute("data-currency") === "EUR")).toBe(true);
    expect(screen.queryByTestId("card")).toBeNull();
    expect(document.getElementById("day-1")!.contains(first)).toBe(true);
  });

  it("stays rows whatever the page's view was set to", () => {
    show({ resultViewMode: "timeline" });
    expect(screen.queryByTestId("timeline")).toBeNull();
    expect(screen.getAllByTestId("row")).toHaveLength(3);
  });

  it("offers a day's route after its rows, where the day has been read", () => {
    show();
    const route = screen.getAllByRole("link", { name: "day.route" });
    expect(route).toHaveLength(1);
    expect(document.getElementById("day-1")!.contains(route[0])).toBe(true);
    expect(before(screen.getByRole("list", { name: day(1) }), route[0])).toBe(true);
  });

  it("puts what the page gives it under the first day, before the second", () => {
    show({ afterFirstDay: <div data-testid="assistant" /> });
    const slot = screen.getByTestId("assistant");
    expect(before(screen.getByRole("list", { name: day(1) }), slot)).toBe(true);
    expect(before(slot, document.getElementById("day-2")!)).toBe(true);
    expect(screen.getAllByTestId("assistant")).toHaveLength(1);
  });

  it("leaves out the numbers the header already says, and lists the packing plainly", () => {
    show();
    expect(screen.queryByTestId("stats")).toBeNull();
    expect(screen.getByTestId("packing").getAttribute("data-plain")).toBe("true");
    expect(screen.getByTestId("booking-links")).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy();
  });
});

describe("the same plan when it isn't a phone's rows", () => {
  it("is as before: the cards, the page's controls, the numbers, and no row to jump along", () => {
    show({ phoneRows: false, afterFirstDay: undefined });
    expect(screen.queryByRole("navigation", { name: "wizard.result.dayByDay" })).toBeNull();
    expect(screen.getByRole("button", { name: "wizard.result.showMap" })).toBeTruthy();
    expect(screen.getAllByTestId("card")).toHaveLength(3);
    expect(screen.queryByTestId("row")).toBeNull();
    expect(screen.getByTestId("stats")).toBeTruthy();
    expect(screen.getByTestId("packing").getAttribute("data-plain")).toBe("false");
    // The day's route keeps its place under the day's heading, above the cards.
    const route = screen.getByRole("link", { name: "day.route" });
    expect(before(route, screen.getAllByTestId("card")[0])).toBe(true);
  });
});
