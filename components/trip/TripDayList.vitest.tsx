/** @vitest-environment jsdom */
import { useEffect, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MeasuringStrategy } from "@dnd-kit/core";
import type { Activity, ItineraryDay } from "@/types";
import TripDayList from "./TripDayList";

/**
 * The trip page's days. The cards, rows and day actions have tests of their own;
 * here they record what the list gave them, so a handler indexed by the wrong day
 * or a row with the wrong travel leg shows up.
 */

type Recorded = Record<string, unknown>;
const seen = vi.hoisted(() => ({
  drag: null as Recorded | null,
  rows: new Map<string, Recorded>(),
  sortable: new Map<string, Recorded>(),
  viewing: new Map<string, Recorded>(),
  summaries: new Map<number, Recorded>(),
  timelines: new Map<number, Recorded>(),
  mounts: { count: 0 },
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${ns}.${key} ${JSON.stringify(values)}` : `${ns}.${key}`,
}));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({
    convert: (amount: number, from: string) => ({ value: amount, currency: from }),
    format: (amount: number, currency: string) => `${currency} ${amount}`,
  }),
}));
vi.mock("@dnd-kit/core", async (original) => {
  const real = await original<typeof import("@dnd-kit/core")>();
  return {
    ...real,
    DndContext: (props: ComponentProps<typeof real.DndContext>) => {
      seen.drag = props as Recorded;
      return <real.DndContext {...props} />;
    },
  };
});
vi.mock("@/components/trip/TripNotices", () => ({
  NoItinerary: () => <p>no itinerary</p>,
  ReorderHint: () => <p>reorder hint</p>,
  RegeneratingDayOverlay: ({ dayNumber }: { dayNumber: number }) => <p>regenerating day {dayNumber}</p>,
}));
vi.mock("@/components/trip/DayActions", () => ({
  default: (p: { dayNumber: number; budget: string | null; onRegenerate: (() => void) | null; onOptimizeRoute: (() => void) | null }) => (
    <div>
      {p.budget && <span>budget of day {p.dayNumber}: {p.budget}</span>}
      {p.onRegenerate && <button onClick={p.onRegenerate}>regenerate day {p.dayNumber}</button>}
      {p.onOptimizeRoute && <button onClick={p.onOptimizeRoute}>optimize day {p.dayNumber}</button>}
    </div>
  ),
}));
vi.mock("@/components/trip/ActivityRow", () => ({
  default: (p: Recorded & { activityId: string; children: React.ReactNode }) => {
    seen.rows.set(p.activityId, p);
    return <div data-testid="row">{p.children}</div>;
  },
}));
vi.mock("@/components/trip/SortableActivityCard", () => ({
  default: (p: Recorded & { activity: Activity }) => {
    seen.sortable.set(p.activity.id!, p);
    return <div>sortable {p.activity.id}</div>;
  },
}));
vi.mock("@/components/trip/EditableActivityCard", () => {
  function ViewingCard(p: Recorded & { activity: Activity }) {
    seen.viewing.set(p.activity.id!, p);
    useEffect(() => {
      seen.mounts.count += 1;
    }, []);
    return <div>viewing {p.activity.id}</div>;
  }
  return { default: ViewingCard };
});
vi.mock("@/components/collaboration/proposals", () => ({
  InlineProposalCard: (p: { proposal: { id: string }; canVote: boolean; totalVoters: number; onTapToVote: () => void }) => (
    <button onClick={p.onTapToVote}>
      proposal {p.proposal.id} canVote={String(p.canVote)} voters={p.totalVoters}
    </button>
  ),
}));
vi.mock("@/components/trip/AddActivityButton", () => ({
  default: (p: { dayIndex: number; destination: string; onAdd: (a: Partial<Activity>) => void }) => (
    <button onClick={() => p.onAdd({ name: "New place" })}>
      add to index {p.dayIndex} in {p.destination}
    </button>
  ),
}));
vi.mock("@/components/trip/DaySummary", () => ({
  default: (p: Recorded & { dayNumber: number }) => {
    seen.summaries.set(p.dayNumber, p);
    return null;
  },
}));
vi.mock("@/components/trip/DayTimeline", () => ({
  DayTimeline: (p: Recorded & { day: ItineraryDay }) => {
    seen.timelines.set(p.day.day_number, p);
    return <div>timeline of day {p.day.day_number}</div>;
  },
}));

const place = (id: string, cost?: number) =>
  ({ id, name: id, ...(cost !== undefined ? { estimated_cost: { amount: cost, currency: "EUR" } } : {}) }) as unknown as Activity;
const threeDays = (): ItineraryDay[] =>
  [
    { day_number: 1, theme: "Old town", activities: [place("a1", 10), place("a2", 5), place("a3")] },
    { day_number: 2, theme: "Museums", activities: [place("b1")] },
    { day_number: 3, theme: "The coast", activities: [place("c1"), place("c2")] },
  ] as unknown as ItineraryDay[];

const moves = {
  preview: null as ItineraryDay[] | null,
  dragging: false,
  draggedActivity: null,
  moveToDay: vi.fn(),
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDragEnd: vi.fn(),
  onDragCancel: vi.fn(),
};
const handlers = {
  votingProps: vi.fn((id: string | undefined) => ({ votingEnabled: true, canVote: true, totalVoters: 4, votes: [{ id }] })),
  timelineOf: vi.fn(),
  onOpenProposal: vi.fn(),
  onRegenerateDay: vi.fn(),
  onOptimizeRoute: vi.fn(),
  onSuggestActivity: vi.fn(),
  onActivityDelete: vi.fn(),
  onActivityUpdate: vi.fn(),
  onActivityRegenerate: vi.fn(),
  onAddActivity: vi.fn(),
  onPhotoCapture: vi.fn(),
  onMakeRoom: vi.fn(),
};
const dayOptions = [{ dayNumber: 1 }];

type Props = ComponentProps<typeof TripDayList>;
const baseProps = (over: Partial<Props> = {}) =>
  ({
    days: threeDays(),
    selectedDay: null,
    renderEpoch: 0,
    viewMode: "cards",
    isEditMode: false,
    editingActive: false,
    destination: "Paris, France",
    currency: "EUR",
    pace: "relaxed",
    moves,
    focusedDay: null,
    aiUpdatedActivityId: null,
    regeneratingDayNumber: null,
    regeneratingActivityId: null,
    travelData: new Map(),
    travelLoading: false,
    crewVotes: null,
    availableDays: [1, 2, 3],
    dayOptions,
    canVote: false,
    voterCount: 4,
    ...handlers,
    ...over,
  }) as unknown as Props;
const show = (over: Partial<Props> = {}) => render(<TripDayList {...baseProps(over)} />);
const editing = { editingActive: true, isEditMode: true };
const dayBox = (n: number) => document.getElementById(`trip-day-${n}`)!;
const shownDays = () => [...document.querySelectorAll("[id^=trip-day-]")].map((el) => el.id);

beforeEach(() => {
  handlers.timelineOf.mockImplementation((dayNumber: number) =>
    (threeDays()[dayNumber - 1]?.activities ?? []).map((data, index) => ({ type: "activity", data, index }))
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  moves.preview = null;
  seen.drag = null;
  seen.rows.clear();
  seen.sortable.clear();
  seen.viewing.clear();
  seen.summaries.clear();
  seen.timelines.clear();
  seen.mounts.count = 0;
});

describe("a stop still on when the next one starts", () => {
  const timed = (id: string, start: string, duration: number, extra: Partial<Activity> = {}) =>
    ({ id, name: id, start_time: start, duration_minutes: duration, ...extra }) as unknown as Activity;
  const oneDay = (activities: Activity[]) => [{ day_number: 1, theme: "Old town", activities }] as unknown as ItineraryDay[];
  type Overlap = { minutes: number; nextName: string; onMakeRoom: (() => void) | null } | null;
  const overlapOf = (id: string) => (seen.rows.get(id) as unknown as { overlap: Overlap }).overlap;

  it("is noted for whoever is editing, with a way to make room unless the next one is fixed", () => {
    const train = timed("train", "12:30", 60, { booking_required: true });
    show({ ...editing, days: oneDay([timed("museum", "09:00", 240), timed("lunch", "12:00", 60), train]) });
    expect(overlapOf("museum")).toMatchObject({ minutes: 60, nextName: "lunch" });
    overlapOf("museum")!.onMakeRoom!();
    expect(handlers.onMakeRoom).toHaveBeenCalledWith("museum");
    expect(overlapOf("lunch")).toEqual({ minutes: 30, nextName: "train", onMakeRoom: null });
    expect(overlapOf("train")).toBeNull();
  });

  // The preview of a drag can put a card where it overlaps: a note coming and
  // going would move the days under the pointer, and the drop with them.
  it("isn't noted while a card is being dragged", () => {
    moves.dragging = true;
    try {
      show({ ...editing, days: oneDay([timed("museum", "09:00", 240), timed("lunch", "12:00", 60)]) });
      expect(overlapOf("museum")).toBeNull();
    } finally {
      moves.dragging = false;
    }
  });

  it("isn't noted for whoever is only looking", () => {
    const activities = [timed("museum", "09:00", 240), timed("lunch", "12:00", 60)];
    handlers.timelineOf.mockImplementation(() => activities.map((data, index) => ({ type: "activity", data, index })));
    show({ days: oneDay(activities) });
    expect(overlapOf("museum")).toBeNull();
  });
});

describe("a day's route in Google Maps", () => {
  it("is offered on each day with at least two stops", () => {
    show();
    const links = screen.getAllByRole("link", { name: "trips.day.route" });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toContain("origin=a1");
    expect(links[1].getAttribute("href")).toContain("origin=c1");
  });

  it("makes way while the trip is being edited", () => {
    show(editing);
    expect(screen.queryByRole("link", { name: "trips.day.route" })).toBeNull();
  });
});

describe("which days show", () => {
  it("says there is no plan when there are no days, whatever a drag holds", () => {
    moves.preview = threeDays();
    show({ days: [] });
    expect(screen.getByText("no itinerary")).toBeTruthy();
    expect(shownDays()).toEqual([]);
  });

  it("shows every day, under its own anchor, in order", () => {
    show();
    expect(shownDays()).toEqual(["trip-day-1", "trip-day-2", "trip-day-3"]);
    expect(screen.queryByText("no itinerary")).toBeNull();
  });

  it("shows only the day the slider picked", () => {
    show({ selectedDay: 2 });
    expect(shownDays()).toEqual(["trip-day-2"]);
  });

  it("shows where a dragged card hovers, instead of where it was", () => {
    moves.preview = [threeDays()[1]];
    show();
    expect(shownDays()).toEqual(["trip-day-2"]);
  });

  it("titles each day, with its theme", () => {
    show({ selectedDay: 3 });
    expect(within(dayBox(3)).getByText(/day\.label.*"number":3/)).toBeTruthy();
    expect(within(dayBox(3)).getByText("The coast")).toBeTruthy();
  });
});

describe("with a day picked, edits go to that day's place in the trip", () => {
  it("not to its place among the days shown", () => {
    show({ ...editing, selectedDay: 3 });
    expect(seen.sortable.get("c1")).toMatchObject({ currentDayIndex: 2 });
    (seen.sortable.get("c1")!.onRegenerate as () => void)();
    expect(handlers.onActivityRegenerate).toHaveBeenCalledWith("c1", 2);
    fireEvent.click(screen.getByRole("button", { name: /add to index 2/ }));
    expect(handlers.onAddActivity).toHaveBeenCalledWith(2, { name: "New place" });
  });
});

describe("the reorder hint", () => {
  it("shows once, on the first day shown, even when that isn't Day 1", () => {
    show({ ...editing, selectedDay: 2 });
    expect(within(dayBox(2)).getByText("reorder hint")).toBeTruthy();
  });

  it("shows on one day when all are shown", () => {
    show(editing);
    expect(screen.getAllByText("reorder hint")).toHaveLength(1);
    expect(within(dayBox(1)).getByText("reorder hint")).toBeTruthy();
  });

  it("doesn't show while viewing", () => {
    show();
    expect(screen.queryByText("reorder hint")).toBeNull();
  });
});

describe("a day the assistant points at", () => {
  it("is ringed, and only that day", () => {
    show({ focusedDay: { day: 2, pulse: false } });
    expect(dayBox(2).className).toContain("ring-2");
    expect(dayBox(2).className).not.toContain("animate-pulse-once");
    expect(dayBox(1).className).not.toContain("ring-2");
  });

  it("pulses when asked to", () => {
    show({ focusedDay: { day: 2, pulse: true } });
    expect(dayBox(2).className).toContain("animate-pulse-once");
  });
});

describe("a day being regenerated", () => {
  it("shows the overlay on that day only", () => {
    show({ regeneratingDayNumber: 2 });
    expect(within(dayBox(2)).getByText("regenerating day 2")).toBeTruthy();
    expect(screen.getAllByText(/regenerating day/)).toHaveLength(1);
  });
});

describe("a day's actions", () => {
  it("regenerate that day, for whoever may", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "regenerate day 3" }));
    expect(handlers.onRegenerateDay).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("offer no regenerate to whoever may not", () => {
    show({ onRegenerateDay: null });
    expect(screen.queryByRole("button", { name: /regenerate day/ })).toBeNull();
  });

  it("optimize the route while editing a day of three places or more, not before", () => {
    show({ editingActive: true });
    expect(screen.getByRole("button", { name: "optimize day 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "optimize day 3" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "optimize day 1" }));
    expect(handlers.onOptimizeRoute.mock.calls[0][0]).toBe(1);
    expect(handlers.onOptimizeRoute.mock.calls[0][1].map((a: Activity) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("offer no route while viewing", () => {
    show();
    expect(screen.queryByRole("button", { name: /optimize day/ })).toBeNull();
  });

  it("add up a day's budget only when something on it has a cost", () => {
    show();
    expect(screen.getByText("budget of day 1: EUR 15")).toBeTruthy();
    expect(screen.queryByText(/budget of day 2/)).toBeNull();
  });

  it("read an estimate with no currency in the trip's, and USD when the trip names none", () => {
    const uncoded = [{ day_number: 1, activities: [{ id: "x", name: "x", estimated_cost: { amount: 7 } }] }] as unknown as ItineraryDay[];
    show({ days: uncoded, currency: "JPY" });
    expect(screen.getByText("budget of day 1: JPY 7")).toBeTruthy();
    cleanup();
    show({ days: uncoded, currency: undefined });
    expect(screen.getByText("budget of day 1: USD 7")).toBeTruthy();
  });

  it("call nothing free when nothing on the day costs anything, with the common wording", () => {
    const free = [{ day_number: 1, activities: [{ id: "x", name: "x", estimated_cost: { amount: 0, currency: "EUR" } }] }] as unknown as ItineraryDay[];
    show({ days: free });
    expect(screen.getByText("budget of day 1: common.activity.free")).toBeTruthy();
  });
});

describe("while editing", () => {
  it("each place is a sortable card, and edits reach it by its id", () => {
    show(editing);
    const card = seen.sortable.get("a2")!;
    expect(screen.getByText("sortable a2")).toBeTruthy();
    expect(screen.queryByText("viewing a2")).toBeNull();
    expect(card).toMatchObject({ index: 1, isEditMode: true, availableDays: [1, 2, 3], dayOptions, currentDayIndex: 0 });
    (card.onDelete as () => void)();
    // With its name, for the message that says it was removed.
    expect(handlers.onActivityDelete).toHaveBeenCalledWith("a2", "a2");
    (card.onUpdate as (u: Partial<Activity>) => void)({ name: "Renamed" });
    expect(handlers.onActivityUpdate).toHaveBeenCalledWith("a2", { name: "Renamed" });
    (card.onMoveToDay as (d: number) => void)(2);
    expect(moves.moveToDay).toHaveBeenCalledWith("a2", 2);
    (card.onRegenerate as () => void)();
    expect(handlers.onActivityRegenerate).toHaveBeenCalledWith("a2", 0);
  });

  it("only the place being regenerated says so", () => {
    show({ ...editing, regeneratingActivityId: "a2" });
    expect(seen.sortable.get("a2")).toMatchObject({ isRegenerating: true });
    expect(seen.sortable.get("a1")).toMatchObject({ isRegenerating: false });
  });

  it("inline editing edits too, though edit mode is off", () => {
    show({ editingActive: true, isEditMode: false });
    expect(screen.getByText("sortable a1")).toBeTruthy();
    expect(seen.sortable.get("a1")).toMatchObject({ isEditMode: true });
  });

  it("a day can take a new place, in this trip's destination", () => {
    show({ ...editing, selectedDay: 2 });
    expect(screen.getByRole("button", { name: "add to index 1 in Paris, France" })).toBeTruthy();
  });

  it("the day's badge turns amber in edit mode, not while editing inline", () => {
    show(editing);
    expect(dayBox(1).querySelector(".from-amber-500")).toBeTruthy();
    cleanup();
    show({ editingActive: true, isEditMode: false });
    expect(dayBox(1).querySelector(".from-amber-500")).toBeNull();
  });
});

describe("while viewing", () => {
  it("each place is a plain card that edits nothing, in the day's timeline order", () => {
    show();
    const card = seen.viewing.get("a2")!;
    expect(screen.getByText("viewing a2")).toBeTruthy();
    expect(screen.queryByText("sortable a2")).toBeNull();
    expect(card).toMatchObject({ index: 1, isEditMode: false, availableDays: [], currentDayIndex: 0 });
    (card.onDelete as () => void)();
    (card.onUpdate as (u: Partial<Activity>) => void)({});
    (card.onMoveToDay as (d: number) => void)(0);
    (card.onRegenerate as () => void)();
    expect(handlers.onActivityDelete).not.toHaveBeenCalled();
    expect(handlers.onActivityUpdate).not.toHaveBeenCalled();
    expect(moves.moveToDay).not.toHaveBeenCalled();
    expect(handlers.onActivityRegenerate).not.toHaveBeenCalled();
  });

  it("the crew's proposals sit among the places, and a tap opens that one", () => {
    const proposal = { id: "p1" };
    handlers.timelineOf.mockImplementation((dayNumber: number) =>
      dayNumber === 1
        ? [
            { type: "activity", data: place("a1"), index: 0 },
            { type: "proposal", data: proposal },
            { type: "activity", data: place("a2"), index: 1 },
          ]
        : []
    );
    show({ canVote: true });
    fireEvent.click(screen.getByRole("button", { name: /proposal p1 canVote=true voters=4/ }));
    expect(handlers.onOpenProposal).toHaveBeenCalledExactlyOnceWith(proposal);
    expect(handlers.timelineOf).toHaveBeenCalledWith(1);
    const order = within(dayBox(1)).getAllByText(/viewing|proposal/).map((el) => el.textContent?.split(" ")[0]);
    expect(order).toEqual(["viewing", "proposal", "viewing"]);
  });

  it("nothing can be added", () => {
    show();
    expect(screen.queryByRole("button", { name: /add to index/ })).toBeNull();
  });
});

describe("both ways, a place's card and row", () => {
  it.each([
    ["editing", editing, seen.sortable],
    ["viewing", {}, seen.viewing],
  ] as const)("%s: the card gets the trip's currency, its votes, and no photo fetch of its own", (_name, mode, cards) => {
    show(mode);
    expect(cards.get("a1")).toMatchObject({
      activity: expect.objectContaining({ id: "a1" }),
      index: 0,
      currency: "EUR",
      showGallery: true,
      disableAutoFetch: true,
      onPhotoCapture: handlers.onPhotoCapture,
      votingEnabled: true,
      votes: [{ id: "a1" }],
    });
    expect(handlers.votingProps).toHaveBeenCalledWith("a1");
  });

  it.each([
    ["editing", editing],
    ["viewing", {}],
  ] as const)("%s: only the place the assistant just changed is marked, and the crew's votes reach each row", (_name, mode) => {
    const crewVotes = { total: 3 };
    show({ ...mode, aiUpdatedActivityId: "a2", crewVotes } as unknown as Partial<Props>);
    expect(seen.rows.get("a2")).toMatchObject({ aiUpdated: true, activityId: "a2", crewVotes });
    expect(seen.rows.get("a1")).toMatchObject({ aiUpdated: false, activityId: "a1", crewVotes });
  });

  it.each([
    ["editing", editing],
    ["viewing", {}],
  ] as const)("%s: each row but the last carries the way to the next place", (_name, mode) => {
    const leg = { fromActivityId: "a1", toActivityId: "a2", minutes: 9 };
    const travelData = new Map([[1, { segments: [leg], isLoading: false }]]);
    show({ ...mode, travelData } as unknown as Partial<Props>);
    expect(seen.rows.get("a1")).toMatchObject({ travelTo: { segment: leg, isLoading: false } });
    expect(seen.rows.get("a2")).toMatchObject({ travelTo: { segment: undefined } });
    expect(seen.rows.get("a3")).toMatchObject({ travelTo: null });
  });

  it("the way is loading while the trip's or the day's travel is", () => {
    const travelData = new Map([[1, { segments: [], isLoading: true }]]);
    show({ travelData } as unknown as Partial<Props>);
    expect(seen.rows.get("a1")).toMatchObject({ travelTo: { isLoading: true } });
    expect((seen.rows.get("b1") as { travelTo: unknown }).travelTo).toBeNull();
    cleanup();
    seen.rows.clear();
    show({ travelLoading: true });
    expect(seen.rows.get("a1")).toMatchObject({ travelTo: { isLoading: true } });
  });

  it("in the timeline order the way follows the day's places, not what sits between them", () => {
    const leg = { fromActivityId: "a1", toActivityId: "a2" };
    const travelData = new Map([[1, { segments: [leg], isLoading: false }]]);
    handlers.timelineOf.mockImplementation((dayNumber: number) =>
      dayNumber === 1
        ? [
            { type: "activity", data: place("a1"), index: 0 },
            { type: "proposal", data: { id: "p1" } },
            { type: "activity", data: place("a2"), index: 1 },
          ]
        : []
    );
    show({ travelData } as unknown as Partial<Props>);
    expect(seen.rows.get("a1")).toMatchObject({ travelTo: { segment: leg } });
  });
});

describe("suggesting a place to the crew", () => {
  it("is offered on each day while viewing, and asks for that day", () => {
    show({ selectedDay: 2 });
    fireEvent.click(screen.getByRole("button", { name: "trips.detail.suggestActivity" }));
    expect(handlers.onSuggestActivity).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("isn't offered in edit mode", () => {
    show(editing);
    expect(screen.queryByRole("button", { name: "trips.detail.suggestActivity" })).toBeNull();
  });

  it("is still offered while editing inline, which isn't edit mode", () => {
    show({ editingActive: true, isEditMode: false, selectedDay: 2 });
    expect(screen.getByRole("button", { name: "trips.detail.suggestActivity" })).toBeTruthy();
  });

  it("isn't offered to whoever may not", () => {
    show({ onSuggestActivity: null });
    expect(screen.queryByRole("button", { name: "trips.detail.suggestActivity" })).toBeNull();
  });
});

describe("the day's summary", () => {
  it("gets the day's places, travel and the trip's pace", () => {
    const segments = [{ fromActivityId: "a1", toActivityId: "a2" }];
    const travelData = new Map([[1, { segments, isLoading: false }]]);
    show({ travelData } as unknown as Partial<Props>);
    expect(seen.summaries.get(1)).toMatchObject({ dayNumber: 1, segments, pace: "relaxed" });
    expect((seen.summaries.get(1)!.activities as Activity[]).map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("has no travel to show on a day not worked out yet", () => {
    show();
    expect(seen.summaries.get(2)).toMatchObject({ segments: [] });
  });
});

describe("the timeline view", () => {
  it("shows the day as a timeline, without cards or their buttons, even while editing", () => {
    const travel = { segments: [], isLoading: false };
    show({ ...editing, viewMode: "timeline", travelData: new Map([[2, travel]]), travelLoading: true, selectedDay: 2 } as unknown as Partial<Props>);
    expect(screen.getByText("timeline of day 2")).toBeTruthy();
    expect(seen.timelines.get(2)).toMatchObject({ travel, travelLoading: true, pace: "relaxed", currency: "EUR" });
    expect(screen.queryByText("sortable b1")).toBeNull();
    expect(screen.queryByRole("button", { name: /add to index/ })).toBeNull();
    expect(screen.queryByText("reorder hint")).toBeNull();
    expect(seen.summaries.size).toBe(0);
  });

  it("falls back to USD for a trip with no currency", () => {
    show({ viewMode: "timeline", currency: undefined });
    expect(seen.timelines.get(1)).toMatchObject({ currency: "USD" });
  });
});

describe("the drag", () => {
  it("is one context around the plan, handled by the page's moves", () => {
    show();
    expect(seen.drag).toMatchObject({
      onDragStart: moves.onDragStart,
      onDragOver: moves.onDragOver,
      onDragEnd: moves.onDragEnd,
      onDragCancel: moves.onDragCancel,
    });
  });

  it("re-measures every droppable on each move, so a drop lands where it looks", () => {
    show();
    expect(seen.drag!.measuring).toEqual({ droppable: { strategy: MeasuringStrategy.Always } });
  });

  it("keeps its sensors and collision detection stable across renders", () => {
    const view = show();
    const first = seen.drag!;
    view.rerender(<TripDayList {...baseProps()} />);
    expect(seen.drag!.collisionDetection).toBe(first.collisionDetection);
    expect(seen.drag!.measuring).toBe(first.measuring);
    expect(seen.drag!.sensors).toBeTruthy();
  });
  type Spoken = {
    screenReaderInstructions: { draggable: string };
    announcements: Record<string, (event: unknown) => string | undefined>;
  };
  const spoken = () => seen.drag!.accessibility as Spoken;
  const words = (key: string, place: object) => `common.drag.${key} ${JSON.stringify(place)}`;

  it("tells a screen reader how to move a stop, in the page's words", () => {
    show(editing);
    expect(spoken().screenReaderInstructions.draggable).toBe("common.drag.instructions");
  });

  it("names the stop and its place as it's picked up, moved and dropped", () => {
    show(editing);
    const say = spoken().announcements;
    expect(say.onDragStart({ active: { id: "a2" } })).toBe(words("pickedUp", { name: "a2", day: 1, position: 2, count: 3 }));
    expect(say.onDragOver({ active: { id: "a2" }, over: { id: "c1" } })).toBe(words("over", { name: "a2", day: 3, position: 1, count: 3 }));
    expect(say.onDragEnd({ active: { id: "a2" }, over: { id: "a1" } })).toBe(words("dropped", { name: "a2", day: 1, position: 1, count: 3 }));
  });

  it("reads the plan as the page shows it while dragging, and as it was when the move is cancelled", () => {
    const view = show(editing);
    const [d1, d2, d3] = threeDays();
    moves.preview = [{ ...d1, activities: d1.activities.slice(1) }, { ...d2, activities: [...d2.activities, d1.activities[0]] }, d3];
    view.rerender(<TripDayList {...baseProps(editing)} />);
    const say = spoken().announcements;
    expect(say.onDragOver({ active: { id: "a1" }, over: { id: "b1" } })).toBe(words("over", { name: "a1", day: 2, position: 1, count: 2 }));
    expect(say.onDragEnd({ active: { id: "a1" }, over: null })).toBe(words("dropped", { name: "a1", day: 2, position: 2, count: 2 }));
    expect(say.onDragCancel({ active: { id: "a1" } })).toBe(words("cancelled", { name: "a1", day: 1, position: 1, count: 3 }));
  });
});

describe("a new render epoch", () => {
  it("remounts the cards, so they read the plan afresh; another render doesn't", () => {
    const view = show({ selectedDay: 2 });
    expect(seen.mounts.count).toBe(1);
    view.rerender(<TripDayList {...baseProps({ selectedDay: 2 })} />);
    expect(seen.mounts.count).toBe(1);
    view.rerender(<TripDayList {...baseProps({ selectedDay: 2, renderEpoch: 1 })} />);
    expect(seen.mounts.count).toBe(2);
  });
});
