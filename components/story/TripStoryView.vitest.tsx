/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { TripStory } from "@/lib/story/trip-story";
import TripStoryView from "./TripStoryView";

/**
 * The story a friend taps through: the guess holds the trip back until it is answered or skipped, the
 * answer shows on the board, each day gets its part, and the last part sends a friend to the planner
 * and the trip's teller to their link.
 */

const captured = vi.hoisted(() => [] as Array<[string, Record<string, unknown>]>);
// What the pictures to post were given (the block itself is in StoryPost.vitest.tsx).
const postProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, onClick, ...rest }: { href: string; children: ReactNode; onClick?: () => void }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("./StoryPost", () => ({
  default: (props: Record<string, unknown>) => {
    postProps.push(props);
    return <div data-testid="story-post" />;
  },
}));
vi.mock("@/lib/posthog/client", () => ({
  onPostHogReady: (fn: (posthog: { capture: (event: string, properties: Record<string, unknown>) => void }) => void) =>
    fn({ capture: (event, properties) => captured.push([event, properties]) }),
}));

const dayShape = {
  width: 300,
  height: 190,
  points: [
    { x: 22, y: 30, day: 1 },
    { x: 150, y: 160, day: 1 },
    { x: 270, y: 60, day: 1 },
  ],
  path: "M22 30 L150 160 L270 60",
  labels: [],
};

const story: TripStory = {
  place: "Lisbon",
  destination: "Lisbon, Portugal",
  startDate: "2027-01-09",
  endDate: "2027-01-10",
  dayCount: 2,
  nights: 1,
  cities: [],
  stopCount: 8,
  km: 21,
  route: {
    width: 320,
    height: 300,
    points: [
      { x: 30, y: 40, day: 1 },
      { x: 200, y: 120, day: 2 },
    ],
    path: "M30 40 L200 120",
    labels: [],
  },
  days: [
    { day: 1, date: "2027-01-09", city: null, title: "Alfama and the river", stops: ["Jerónimos Monastery", "Belém Tower", "Time Out Market"], more: 2, route: dayShape },
    { day: 2, date: "2027-01-10", city: null, title: null, stops: ["National Tile Museum"], more: 0, route: null },
  ],
  moreDays: 0,
  guess: {
    clues: [
      { kind: "when", days: 2, month: 1, region: "europe" },
      { kind: "mix", sights: 4, meals: 3, outdoors: 0 },
      { kind: "letters", first: "L", letters: 6, words: 1 },
    ],
    options: ["Prague", "Lisbon", "Vienna", "Rome"],
    answer: 1,
  },
};

const view = (overrides: Partial<Parameters<typeof TripStoryView>[0]> = {}) =>
  render(
    <TripStoryView
      story={story}
      locale="en"
      tripId="99999999-2222-4333-8444-555555555555"
      planHref="/trips/new?destination=Lisbon&days=2&from=trip"
      fullPlanHref="/shared/abc"
      storyUrl="https://monkeytravel.app/shared/abc/story"
      shareToken="11111111-2222-4333-8444-555555555555"
      mine={false}
      {...overrides}
    />
  );

const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

let posted: Array<Record<string, unknown>>;

beforeEach(() => {
  captured.length = 0;
  postProps.length = 0;
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: string }) => {
      posted.push(JSON.parse(init?.body ?? "{}"));
      return new Response("{}");
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the guess", () => {
  it("opens the story with the place hidden, one clue, and no way on but an answer or a skip", () => {
    view();
    expect(heading()).toBe("guess.title");
    expect(screen.getByRole("img", { name: "guess.hidden" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Lisbon" })).toBeNull();
    expect(screen.getByRole("img", { name: "guess.hidden" }).textContent).toBe("???");
    expect(screen.getAllByText(/^guess\.clue /)).toHaveLength(1);
    expect(screen.getByText(/^guess\.when /).textContent).toContain('"days":2');
    expect(screen.getByText(/^guess\.when /).textContent).toContain('"month":"January"');
    expect(screen.queryByRole("button", { name: "next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "guess.see" })).toBeNull();
    expect(screen.getByRole("button", { name: "guess.skip" })).toBeTruthy();
  });

  it("shows a further clue each time it is asked, then none left to ask for", () => {
    view();
    press("guess.another");
    expect(screen.getByText(/^guess\.mix /).textContent).toContain('guess.sights {\\"count\\":4}');
    // Nothing outdoors on this plan: the sentence leaves it out.
    expect(screen.getByText(/^guess\.mix /).textContent).not.toContain("guess.outdoors");
    press("guess.another");
    expect(screen.getByText(/^guess\.letters /).textContent).toContain('"first":"L"');
    expect(screen.queryByRole("button", { name: "guess.another" })).toBeNull();
  });

  it("turns the board to the place on a right answer and says how many clues it took", () => {
    view();
    press("guess.another");
    press("Lisbon");
    expect(screen.getByRole("img", { name: "Lisbon" })).toBeTruthy();
    expect(screen.getByText('guess.right {"clues":2}')).toBeTruthy();
    for (const option of ["Prague", "Lisbon", "Vienna", "Rome"]) {
      expect((screen.getByRole("button", { name: option }) as HTMLButtonElement).disabled).toBe(true);
    }
    // Every clue is laid open once it is over.
    expect(screen.getAllByText(/^guess\.clue /)).toHaveLength(3);
    expect(captured).toEqual([["story_guessed", { right: true, clues: 2 }]]);
    press("guess.see");
    expect(heading()).toBe("Lisbon");
  });

  it("names the place on a wrong answer", () => {
    view();
    press("Rome");
    expect(screen.getByText('guess.wrong {"place":"Lisbon"}')).toBeTruthy();
    expect(screen.getByRole("img", { name: "Lisbon" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rome" }).getAttribute("aria-pressed")).toBe("true");
    expect(captured).toEqual([["story_guessed", { right: false, clues: 1 }]]);
  });

  it("can be skipped, and the right arrow doesn't skip it", () => {
    view();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(heading()).toBe("guess.title");
    press("guess.skip");
    expect(heading()).toBe("Lisbon");
    expect(captured).toEqual([]);
  });

  it("is left out of a story that has none: it opens on the place", () => {
    view({ story: { ...story, guess: null } });
    expect(heading()).toBe("Lisbon");
    expect(screen.getByRole("button", { name: "next" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "back" })).toBeNull();
  });
});

describe("the trip, part by part", () => {
  const open = (overrides: Partial<Parameters<typeof TripStoryView>[0]> = {}) => view({ story: { ...story, guess: null }, ...overrides });

  it("shows the place with its dates, its numbers, and the shape of each day that has one", () => {
    open();
    expect(screen.getByText("January 9 – 10, 2027")).toBeTruthy();
    expect(screen.getByText('reveal.factsKm {"days":2,"stops":8,"km":21}')).toBeTruthy();
    const shapes = within(screen.getByRole("list", { name: "reveal.route" })).getAllByRole("listitem");
    // Day 2 has no shape to draw.
    expect(shapes.map((li) => li.textContent)).toEqual(["1"]);
    expect(shapes[0].querySelectorAll("circle")).toHaveLength(3);
    // One place: the trip's whole route is not drawn over the days' shapes.
    expect(screen.queryByRole("img", { name: "reveal.route" })).toBeNull();
  });

  it("leaves the distance out when there is none to give, and draws nothing without a shape", () => {
    open({ story: { ...story, guess: null, km: null, route: null, days: story.days.map((day) => ({ ...day, route: null })) } });
    expect(screen.getByText('reveal.facts {"days":2,"stops":8}')).toBeTruthy();
    expect(screen.queryByRole("list", { name: "reveal.route" })).toBeNull();
    expect(screen.queryByRole("img", { name: "reveal.route" })).toBeNull();
  });

  it("draws a trip through several cities as one route with its cities named, and counts them", () => {
    const route = { ...story.route!, labels: [{ x: 30, y: 40, text: "Lisbon" }, { x: 200, y: 120, text: "Porto" }] };
    open({ story: { ...story, guess: null, cities: ["Lisbon", "Porto"], route } });
    const drawing = screen.getByRole("img", { name: "reveal.route" });
    expect(drawing.querySelectorAll("circle")).toHaveLength(2);
    expect([...drawing.querySelectorAll("text")].map((label) => label.textContent)).toEqual(["Lisbon", "Porto"]);
    expect(screen.queryByRole("list", { name: "reveal.route" })).toBeNull();
    // The distance between one day's stops says nothing of a trip across cities.
    expect(screen.getByText('reveal.factsCities {"days":2,"cities":2,"stops":8}')).toBeTruthy();
    expect(screen.queryByText(/^reveal\.factsKm /)).toBeNull();
  });

  it("gives each day its title, its stops and the count of the rest, and walks back", () => {
    open();
    press("next");
    expect(heading()).toBe("Alfama and the river");
    expect(screen.getByText("Saturday, January 9")).toBeTruthy();
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Jerónimos Monastery",
      "Belém Tower",
      "Time Out Market",
    ]);
    expect(screen.getByText('day.more {"count":2}')).toBeTruthy();
    // The day's own shape sits beside its number.
    expect(document.querySelectorAll("svg[aria-hidden] circle")).toHaveLength(3);
    press("next");
    expect(document.querySelector("svg")).toBeNull();
    // A day with no title is headed by its number.
    expect(heading()).toBe('day.label {"number":2}');
    expect(screen.queryByText(/^day\.more /)).toBeNull();
    press("back");
    expect(heading()).toBe("Alfama and the river");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(heading()).toBe("Lisbon");
  });

  it("names the city of a day on a trip through several", () => {
    open({ story: { ...story, guess: null, cities: ["Lisbon", "Porto"], days: [{ ...story.days[0], city: "Porto" }] } });
    press("next");
    expect(screen.getByText('day.in {"city":"Porto"}')).toBeTruthy();
  });

  it("says where it is in the story", () => {
    open();
    expect(screen.getByText('progress {"current":1,"total":4}')).toBeTruthy();
    press("next");
    expect(screen.getByText('progress {"current":2,"total":4}')).toBeTruthy();
  });
});

describe("the last part", () => {
  const toEnd = () => {
    press("guess.skip");
    press("next");
    press("next");
    press("next");
  };

  it("sends a friend to the planner for this place, counts the press, and has no further part", () => {
    view();
    toEnd();
    expect(heading()).toBe("end.title");
    expect(screen.queryByRole("button", { name: "next" })).toBeNull();
    expect(captured).toEqual([["story_finished", { guessed: false }]]);
    const plan = screen.getByRole("link", { name: "end.plan" });
    expect(plan.getAttribute("href")).toBe("/trips/new?destination=Lisbon&days=2&from=trip");
    fireEvent.click(plan);
    expect(posted).toEqual([
      { event_type: "plan_own_clicked", trip_id: "99999999-2222-4333-8444-555555555555", destination: "Lisbon", surface: "story" },
    ]);
    expect(screen.getAllByRole("link", { name: "fullPlan" }).every((a) => a.getAttribute("href") === "/shared/abc")).toBe(true);
    // The pictures to post are the teller's.
    expect(screen.queryByTestId("story-post")).toBeNull();
  });

  it("tells the days it left out", () => {
    view({ story: { ...story, moreDays: 3 } });
    toEnd();
    expect(screen.getByText('day.moreDays {"count":3}')).toBeTruthy();
  });

  it("gives the trip's teller their link to copy, and counts nothing of theirs", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    view({ mine: true });
    press("Lisbon");
    press("guess.see");
    press("next");
    press("next");
    press("next");
    expect(heading()).toBe("end.mineTitle");
    expect(screen.getByText("end.mineBody")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "end.plan" })).toBeNull();
    expect(postProps.at(-1)).toEqual({
      shareToken: "11111111-2222-4333-8444-555555555555",
      locale: "en",
      tripId: "99999999-2222-4333-8444-555555555555",
      withGuess: true,
      storyUrl: "https://monkeytravel.app/shared/abc/story",
      fileStem: "lisbon",
    });
    press("end.copy");
    expect(writeText).toHaveBeenCalledWith("https://monkeytravel.app/shared/abc/story");
    expect(await screen.findByText("end.copied")).toBeTruthy();
    expect(captured).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("gives the teller of a trip with no guess its one picture, saved under a plain name", () => {
    view({ mine: true, story: { ...story, guess: null, place: "São Miguel" } });
    press("next");
    press("next");
    press("next");
    expect(screen.getByText("end.mineBodyPlain")).toBeTruthy();
    expect(postProps.at(-1)).toMatchObject({ withGuess: false, fileStem: "sao-miguel" });
  });
});
