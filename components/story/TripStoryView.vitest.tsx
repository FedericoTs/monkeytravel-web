/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { TripStory } from "@/lib/story/trip-story";
import TripStoryView from "./TripStoryView";

/**
 * The story a friend taps through. The guess is a board of hidden letters: a friend picks letters, a wrong one
 * costs a try and opens the next clue, and the trip is held back until the guess is solved, lost or skipped.
 * Then each day gets its part, and the last part sends a friend to the planner and the trip's teller to post.
 */

const captured = vi.hoisted(() => [] as Array<[string, Record<string, unknown>]>);
// What the pictures to post were given (the block itself is in StoryPost.vitest.tsx).
const postProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const copiedText = vi.hoisted(() => [] as string[]);

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
vi.mock("@/lib/native/share", () => ({
  copyToClipboard: async (text: string) => {
    copiedText.push(text);
    return true;
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
      { kind: "sunset", time: "17:32" },
      { kind: "day", title: "Tiles and trams" },
      { kind: "stop", name: "Belém Tower" },
    ],
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
const letter = (key: string) => fireEvent.click(within(screen.getByRole("group", { name: "guess.keys" })).getByRole("button", { name: key }));
const letters = (keys: string) => [...keys].forEach(letter);
const heading = () => screen.getByRole("heading", { level: 1 }).textContent;
const board = () => document.querySelector('p[role="img"]') as HTMLElement;
const clues = () => within(screen.getByRole("list", { name: "guess.clues" })).getAllByRole("listitem").length;

let posted: Array<Record<string, unknown>>;

beforeEach(() => {
  captured.length = 0;
  postProps.length = 0;
  copiedText.length = 0;
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
  it("opens the story with every letter hidden, one clue, the keys, and no way on but the game or a skip", () => {
    view();
    expect(heading()).toBe("guess.title");
    expect(board().getAttribute("aria-label")).toBe("guess.blank guess.blank guess.blank guess.blank guess.blank guess.blank");
    expect(board().textContent).toBe("");
    expect(clues()).toBe(1);
    expect(screen.getByText(/^guess\.when /).textContent).toContain('"month":"January"');
    expect(within(screen.getByRole("group", { name: "guess.keys" })).getAllByRole("button")).toHaveLength(26);
    expect(screen.getByText('guess.misses {"count":0,"max":6}')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "guess.see" })).toBeNull();
    expect(screen.getByRole("button", { name: "guess.skip" })).toBeTruthy();
  });

  it("opens a right letter everywhere it stands, and uses its key up", () => {
    view({ story: { ...story, place: "São Paulo" } });
    letter("A");
    // The accent is the board's to show.
    expect(board().textContent).toBe("ÃA");
    expect(board().getAttribute("aria-label")).toBe("guess.blank Ã guess.blank, guess.blank A guess.blank guess.blank guess.blank");
    expect((within(screen.getByRole("group", { name: "guess.keys" })).getByRole("button", { name: "A" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('guess.misses {"count":0,"max":6}')).toBeTruthy();
  });

  it("counts a wrong letter and opens the next clue with it, the last one only after four", () => {
    view();
    letter("A");
    expect(screen.getByText('guess.misses {"count":1,"max":6}')).toBeTruthy();
    expect(clues()).toBe(2);
    expect(screen.getByText('guess.sunset {"time":"17:32"}')).toBeTruthy();
    letter("E");
    expect(clues()).toBe(3);
    expect(screen.getByText('guess.dayTitle {"title":"Tiles and trams"}')).toBeTruthy();
    letter("U");
    expect(clues()).toBe(3);
    letter("T");
    expect(clues()).toBe(4);
    expect(screen.getByText('guess.stop {"name":"Belém Tower"}')).toBeTruthy();
    // A right letter opens no clue.
    letter("L");
    expect(clues()).toBe(4);
    expect(board().textContent).toBe("L");
  });

  it("is solved when every letter is open: says how many were wrong, lays every clue open, and lets the trip on", () => {
    view();
    letters("AELISBON");
    expect(board().getAttribute("aria-label")).toBe("Lisbon");
    expect(board().textContent).toBe("LISBON");
    expect(screen.getByText('guess.solved {"misses":2}')).toBeTruthy();
    expect(clues()).toBe(4);
    expect(screen.queryByRole("group", { name: "guess.keys" })).toBeNull();
    expect(captured).toEqual([["story_guessed", { right: true, misses: 2 }]]);
    // The site's own row, for the friends PostHog never sees.
    expect(posted).toEqual([{ event_type: "story_guessed", trip_id: "99999999-2222-4333-8444-555555555555", right: true, misses: 2 }]);
    press("guess.see");
    expect(heading()).toBe("Lisbon");
  });

  it("is lost at the sixth wrong letter: names the place and turns the board to it", () => {
    view();
    letters("AEUTR");
    expect(screen.queryByText(/^guess\.lost /)).toBeNull();
    letter("M");
    expect(screen.getByText('guess.lost {"place":"Lisbon"}')).toBeTruthy();
    expect(board().textContent).toBe("LISBON");
    expect(screen.queryByRole("group", { name: "guess.keys" })).toBeNull();
    expect(captured).toEqual([["story_guessed", { right: false, misses: 6 }]]);
    expect(posted).toEqual([{ event_type: "story_guessed", trip_id: "99999999-2222-4333-8444-555555555555", right: false, misses: 6 }]);
    expect(screen.getByRole("button", { name: "guess.see" })).toBeTruthy();
  });

  it("lets a friend send their result back: the share sheet where there is one, else copied to paste", async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { share });
    view();
    letters("LISBON");
    press("guess.tell");
    expect(share).toHaveBeenCalledWith({ text: 'guess.tellSolved {"misses":0} https://monkeytravel.app/shared/abc/story' });
    cleanup();
    vi.stubGlobal("navigator", {});
    view();
    letters("AEUTRM");
    press("guess.tell");
    expect(await screen.findByRole("button", { name: "guess.told" })).toBeTruthy();
    expect(copiedText).toEqual(["guess.tellLost https://monkeytravel.app/shared/abc/story"]);
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
    expect(posted).toEqual([{ event_type: "story_finished", trip_id: "99999999-2222-4333-8444-555555555555", guessed: false }]);
    posted.length = 0;
    const plan = screen.getByRole("link", { name: "end.plan" });
    expect(plan.getAttribute("href")).toBe("/trips/new?destination=Lisbon&days=2&from=trip");
    fireEvent.click(plan);
    expect(posted).toEqual([
      { event_type: "plan_own_clicked", trip_id: "99999999-2222-4333-8444-555555555555", destination: "Lisbon", surface: "story" },
    ]);
    expect(screen.getAllByRole("link", { name: "fullPlan" }).every((a) => a.getAttribute("href") === "/shared/abc")).toBe(true);
    // The pictures to post and the teller's bar are the teller's.
    expect(screen.queryByTestId("story-post")).toBeNull();
    expect(screen.queryByTestId("story-mine-bar")).toBeNull();
  });

  it("sends the site's rows to the funnel endpoint, in a request that outlives the page", () => {
    view();
    letters("LISBON");
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/funnel-event");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
  });

  it("counts the story watched to its end once, however often the last part is reached", () => {
    view();
    toEnd();
    press("back");
    press("next");
    expect(captured).toEqual([["story_finished", { guessed: false }]]);
    expect(posted).toHaveLength(1);
  });

  it("counts it when the arrow keys brought the friend there, and says a guess was played", () => {
    view();
    letters("LISBON");
    posted.length = 0;
    captured.length = 0;
    for (let part = 0; part < 4; part += 1) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(heading()).toBe("end.title");
    expect(captured).toEqual([["story_finished", { guessed: true }]]);
    expect(posted).toEqual([{ event_type: "story_finished", trip_id: "99999999-2222-4333-8444-555555555555", guessed: true }]);
  });

  it("tells the days it left out", () => {
    view({ story: { ...story, moreDays: 3 } });
    toEnd();
    expect(screen.getByText('day.moreDays {"count":3}')).toBeTruthy();
  });
});

describe("the one telling the trip", () => {
  it("is told from the first part that this is the friends' view, and taken straight to the posting", () => {
    view({ mine: true });
    const bar = screen.getByTestId("story-mine-bar");
    expect(within(bar).getByText("mine.note")).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "mine.post" }));
    expect(heading()).toBe("end.mineTitle");
    // The bar has done its work on the last part.
    expect(screen.queryByTestId("story-mine-bar")).toBeNull();
    expect(screen.getByTestId("story-post")).toBeTruthy();
  });

  it("is the only one shown that bar: a friend has none on the first part", () => {
    view();
    expect(screen.getByRole("group", { name: "guess.keys" })).toBeTruthy();
    expect(screen.queryByTestId("story-mine-bar")).toBeNull();
  });

  it("gets the pictures to post and their link to copy, and counts nothing of their own", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    view({ mine: true });
    letters("LISBON");
    // Their own result is nobody's to hear.
    expect(screen.queryByRole("button", { name: "guess.tell" })).toBeNull();
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

  it("of a trip with no guess gets its one picture, saved under a plain name", () => {
    view({ mine: true, story: { ...story, guess: null, place: "São Miguel" } });
    press("next");
    press("next");
    press("next");
    expect(screen.getByText("end.mineBodyPlain")).toBeTruthy();
    expect(postProps.at(-1)).toMatchObject({ withGuess: false, fileStem: "sao-miguel" });
  });
});
