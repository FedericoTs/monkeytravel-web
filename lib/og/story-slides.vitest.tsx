/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en/common.json";
import { buildTripStory, type StorySource } from "@/lib/story/trip-story";
import { slideWords, type StoryTranslator } from "@/lib/story/words";
import { balancedLines, dayShapeSvg, renderStorySlide, slideFormat, SLIDE_SIZE, tripRouteSvg } from "./story-slides";

/**
 * The story's pictures to post. The guess must give nothing away, the answer must say what the story's
 * screen says, and neither may carry a photo: only the brand mark and the drawings made here.
 */

const LOGO = "https://monkeytravel.app/icon-512.png";
const t = createTranslator({ locale: "en", messages: en, namespace: "story" }) as unknown as StoryTranslator;

const stop = (name: string, type: string, lat: number, lng: number) => ({ name, type, coordinates: { lat, lng } });

const lisbon: StorySource = {
  title: "Lisbon Trip",
  trip_meta: { destination: "Lisbon, Portugal", timezone: "Europe/Lisbon" },
  start_date: "2027-01-09",
  end_date: "2027-01-10",
  itinerary: [
    { day_number: 1, date: "2027-01-09", title: "Alfama", activities: [stop("Sé de Lisboa", "landmark", 38.7098, -9.1326), stop("Castelo de São Jorge", "landmark", 38.7139, -9.1335), stop("Time Out Market", "restaurant", 38.7067, -9.1459)] },
    { day_number: 2, date: "2027-01-10", title: "Belém", activities: [stop("Belém Tower", "landmark", 38.6916, -9.216), stop("Jerónimos Monastery", "landmark", 38.6979, -9.2068)] },
  ],
};

const spain: StorySource = {
  title: "Spain Trip",
  trip_meta: { destination: "Barcelona & Madrid", timezone: "Europe/Madrid" },
  start_date: "2027-01-09",
  end_date: "2027-01-10",
  itinerary: [
    { day_number: 1, city: "Barcelona", activities: [stop("Sagrada Familia", "landmark", 41.4036, 2.1744)] },
    { day_number: 2, city: "Madrid", activities: [stop("Museo del Prado", "museum", 40.4138, -3.6921)] },
  ],
};

/** Every text and image source in the tree, with the slide's own components expanded. */
function flatten(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof el.type === "function") return flatten((el.type as (p: unknown) => unknown)(el.props));
  const out: string[] = [];
  if (typeof el.props?.src === "string") out.push(el.props.src);
  return out.concat(flatten(el.props?.children));
}

const drawn = (source: StorySource, format: "guess" | "place") => {
  const story = buildTripStory(source, "en", "seed");
  return flatten(renderStorySlide(format, story, slideWords(story, t, "en"), LOGO));
};
const images = (parts: string[]) => parts.filter((part) => /^(https?:|data:)/.test(part));

describe("the picture's format", () => {
  it("is one of the story's two, or none", () => {
    expect(slideFormat("guess")).toBe("guess");
    expect(slideFormat("place")).toBe("place");
    for (const other of ["story", "square", "og", "", null, undefined]) expect(slideFormat(other)).toBeNull();
    expect(SLIDE_SIZE).toEqual({ width: 1080, height: 1920 });
  });
});

describe("the guess to post", () => {
  it("asks in the first person, shows every clue, and asks for an answer", () => {
    const parts = drawn(lisbon, "guess");
    expect(parts).toContain("Guess where");
    expect(parts).toContain("I'm going");
    expect(parts.filter((part) => part === "?")).toHaveLength(5);
    expect(parts).toEqual(expect.arrayContaining(["Clue 1", "2 days in January, somewhere in Europe", "Clue 2", "Clue 3", "It starts with L and has 6 letters."]));
    expect(parts).toContain("Send me your guess");
  });

  it("gives nothing away: no place, no dates, no day of the plan", () => {
    const text = drawn(lisbon, "guess").join("\n");
    expect(text).not.toMatch(/lisbon|portugal|alfama|bel[eé]m|2027|9\b.*10/i);
  });

  it("carries the brand mark and no other image", () => {
    expect(images(drawn(lisbon, "guess"))).toEqual([LOGO]);
  });

  it("is the place instead, for a story that asks no guess", () => {
    const parts = drawn(spain, "guess");
    expect(parts).not.toContain("?");
    expect(parts.join(" ")).toContain("Barcelona & Madrid");
  });
});

describe("the answer to post", () => {
  it("names the place, its dates and its numbers as the story's screen does, and where to plan one", () => {
    const parts = drawn(lisbon, "place");
    expect(parts).toContain("Lisbon");
    expect(parts.map((part) => part.replace(/\s+/g, " "))).toContain("January 9 – 10, 2027");
    expect(parts.join(" ")).toMatch(/2 days and 5 stops, about \d+ km between them\./);
    expect(parts).toContain("Plan yours free at monkeytravel.app");
  });

  it("draws a shape for each day that has one, under its number, and nothing from outside", () => {
    const parts = drawn(lisbon, "place");
    const pictures = images(parts);
    expect(pictures[0]).toBe(LOGO);
    expect(pictures.slice(1)).toHaveLength(2);
    for (const picture of pictures.slice(1)) expect(picture.startsWith("data:image/svg+xml")).toBe(true);
    expect(parts).toEqual(expect.arrayContaining(["1", "2"]));
  });

  it("draws no shape for a day whose stops have a single pin", () => {
    const onePin = {
      ...lisbon,
      itinerary: [(lisbon.itinerary as unknown[])[0], { day_number: 2, date: "2027-01-10", activities: [stop("Belém Tower", "landmark", 38.6916, -9.216), { name: "A walk", type: "activity" }] }],
    };
    const parts = drawn(onePin, "place");
    expect(images(parts).slice(1)).toHaveLength(1);
    expect(parts).toContain("1");
    expect(parts).not.toContain("2");
  });

  it("draws a trip through several cities as one route with its cities named, and counts them", () => {
    const parts = drawn(spain, "place");
    expect(images(parts)).toHaveLength(2);
    expect(parts).toEqual(expect.arrayContaining(["Barcelona", "Madrid"]));
    expect(parts).toContain("2 days, 2 cities and 2 stops.");
  });
});

describe("the drawings", () => {
  const story = buildTripStory(lisbon, "en", "seed");
  const route = story.days[0].route!;

  it("draw a day in its colour, with its first stop ringed", () => {
    const svg = dayShapeSvg(route, "#00B4A6");
    expect(svg).toContain(`d="${route.path}"`);
    expect(svg.match(/<circle/g)).toHaveLength(route.points.length);
    expect(svg.match(/stroke="#00B4A6"/g)).toHaveLength(2);
    expect(svg).toContain(`cx="${route.points[0].x}" cy="${route.points[0].y}" r="12" fill="#FFFFFF"`);
  });

  it("draw the whole trip with each stop in its day's colour", () => {
    const whole = buildTripStory(spain, "en", "seed").route!;
    const svg = tripRouteSvg(whole);
    expect(svg.match(/<circle/g)).toHaveLength(whole.points.length);
    expect(svg).toContain('fill="#FF6B6B"');
    expect(svg).toContain('fill="#00B4A6"');
  });
});

describe("a line too long for the slide", () => {
  it("is cut in two at the space nearest its middle", () => {
    expect(balancedLines("Guess where I'm going", 19)).toEqual(["Guess where", "I'm going"]);
    expect(balancedLines("5 days and 22 stops, about 26 km between them.", 43)).toEqual(["5 days and 22 stops,", "about 26 km between them."]);
  });

  it("is left whole when it fits, or has no space to cut at", () => {
    expect(balancedLines("Adivina adónde voy", 19)).toEqual(["Adivina adónde voy"]);
    expect(balancedLines("Thiruvananthapuram", 10)).toEqual(["Thiruvananthapuram"]);
  });
});
