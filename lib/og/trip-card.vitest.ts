/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  cardBudget,
  cardCover,
  cardFormat,
  cardLocale,
  clip,
  coverForCard,
  dayLines,
  formatDay,
  formatRange,
  renderBrandCard,
  renderTripCard,
  type CardDay,
  type TripCardData,
} from "./trip-card";
import { routeSketch, sketchSvg } from "./route-sketch";

const day = (n: number, names: string[], coords?: [number, number][], city?: string): CardDay => ({
  day_number: n,
  date: `2026-11-${String(9 + n).padStart(2, "0")}`,
  city,
  activities: names.map((name, i) => ({ name, coordinates: coords?.[i] ? { lat: coords[i][0], lng: coords[i][1] } : null })),
});

const rome = (): CardDay[] => [
  day(1, ["Colosseum", "Roman Forum", "Trastevere dinner"], [[41.8902, 12.4922], [41.8925, 12.4853], [41.8892, 12.4694]]),
  day(2, ["Vatican Museums", "St. Peter's Basilica"], [[41.9065, 12.4536], [41.9022, 12.4539]]),
  day(3, ["Borghese Gallery"], [[41.9142, 12.4922]]),
];

const data = (over: Partial<TripCardData> = {}): TripCardData => ({
  locale: "en",
  destination: "Rome, Italy",
  dates: "12 – 14 Nov 2026",
  days: rome(),
  cover: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg?w=1200&h=1200&fit=crop",
  logo: "https://monkeytravel.app/icon-512.png",
  goingCount: 3,
  activityCount: 6,
  nights: 2,
  budget: "900 EUR",
  live: null,
  ...over,
});

describe("params", () => {
  it("falls back to the link-preview size and to English", () => {
    expect(cardFormat("story")).toBe("story");
    expect(cardFormat("banner")).toBe("og");
    expect(cardFormat(null)).toBe("og");
    expect(cardLocale("it-IT")).toBe("it");
    expect(cardLocale("de")).toBe("en");
  });
});

describe("dates", () => {
  it("formats a range in the card's language", () => {
    expect(formatRange("2026-11-12", "2026-11-14", "en")).toBe("12 Nov – 14 Nov 2026");
    expect(formatRange("2026-11-12", "2026-11-14", "it")).toMatch(/^12 nov – 14 nov 2026$/);
    expect(formatRange("2026-11-12", null, "en")).toBe("12 Nov 2026");
    expect(formatRange(null, "2026-11-14", "en")).toBeNull();
    expect(formatRange("not a date", null, "en")).toBeNull();
  });

  it("names the weekday for a day row", () => {
    expect(formatDay("2026-11-12", "en")).toBe("Thu 12 Nov");
    expect(formatDay("2026-11-12", "es")).toMatch(/jue/);
    expect(formatDay(undefined, "en")).toBeNull();
  });
});

describe("clip", () => {
  it("cuts at a word and marks the cut", () => {
    expect(clip("Colosseum · Roman Forum · Trastevere dinner", 30)).toBe("Colosseum · Roman Forum…");
    expect(clip("short", 30)).toBe("short");
    expect(clip("Supercalifragilisticexpialidocious street", 12)).toBe("Supercalifr…");
  });
});

describe("dayLines", () => {
  it("joins the names of a day and counts the days it leaves out", () => {
    const { rows, more } = dayLines(rome(), "en", 2, 60);
    expect(rows).toHaveLength(1);
    expect(more).toBe(2);
    expect(rows[0]).toEqual({ day: 1, date: "Tue 10 Nov", text: "Colosseum · Roman Forum · Trastevere dinner" });
  });

  it("shows every day when they fit, and a day without activities by its title", () => {
    const days = [...rome(), { day_number: 4, date: "2026-11-13", title: "Free day", activities: [] }];
    const { rows, more } = dayLines(days, "it", 4, 60);
    expect(rows.map((r) => r.day)).toEqual([1, 2, 3, 4]);
    expect(rows[3].text).toBe("Free day");
    expect(more).toBe(0);
  });
});

describe("coverForCard", () => {
  it("asks Pexels for the card's size and leaves other hosts alone", () => {
    expect(coverForCard("https://images.pexels.com/photos/1/p.jpeg?auto=compress&cs=tinysrgb&w=800&h=600", "https://monkeytravel.app")).toBe(
      "https://images.pexels.com/photos/1/p.jpeg?auto=compress&cs=tinysrgb&w=1200&h=1200&fit=crop"
    );
    expect(coverForCard("https://cdn.example.com/x.jpg", "https://monkeytravel.app")).toBe("https://cdn.example.com/x.jpg");
    expect(coverForCard(null, "https://monkeytravel.app")).toBeNull();
    expect(coverForCard("http://[bad", "https://monkeytravel.app")).toBeNull();
  });

  it("keeps a Google photo off a card: it may be shown on the site, not on a picture that leaves it", () => {
    for (const google of [
      "/api/places/photo?name=places%2Fabc&w=600&h=400&t=attraction",
      "https://monkeytravel.app/api/places/photo?name=places%2Fabc",
      "https://lh3.googleusercontent.com/places/abc=s1600",
      "https://maps.googleapis.com/maps/api/place/photo?photo_reference=abc",
      "https://lh5.ggpht.com/p/abc",
    ]) {
      expect(coverForCard(google, "https://monkeytravel.app"), google).toBeNull();
    }
    // A host that only ends like Google's isn't Google's.
    expect(coverForCard("https://notgoogleapis.com/x.jpg", "https://monkeytravel.app")).toBe("https://notgoogleapis.com/x.jpg");
  });
});

describe("cardCover", () => {
  const ORIGIN = "https://monkeytravel.app";
  const commons = "/api/images/wikimedia/abc123-1280.jpg?a=Yann+Caradec&l=CC+BY-SA+2.0&f=Tour+Eiffel.jpg";

  it("gives a Wikimedia Commons cover with its author and licence", () => {
    expect(cardCover(commons, ORIGIN)).toEqual({
      cover: `${ORIGIN}${commons}`,
      credit: { author: "Yann Caradec", license: "CC BY-SA 2.0" },
    });
    // Stored with the site's address in front, it is the same photo.
    expect(cardCover(`${ORIGIN}${commons}`, ORIGIN).credit).toEqual({ author: "Yann Caradec", license: "CC BY-SA 2.0" });
  });

  it("names Wikimedia Commons when the photo's author isn't known", () => {
    expect(cardCover("/api/images/wikimedia/abc123-1280.jpg?l=Public+domain&f=Old+map.jpg", ORIGIN).credit).toEqual({
      author: "Wikimedia Commons",
      license: "Public domain",
    });
  });

  it("keeps a Commons photo it can't credit off the card", () => {
    expect(cardCover("/api/images/wikimedia/abc123-1280.jpg", ORIGIN)).toEqual({ cover: null, credit: null });
    expect(cardCover("/api/images/wikimedia/abc123-1280.jpg?a=Someone", ORIGIN)).toEqual({ cover: null, credit: null });
  });

  it("gives any other cover with no credit to draw, and a Google photo not at all", () => {
    expect(cardCover("https://images.pexels.com/photos/1/p.jpeg", ORIGIN)).toEqual({
      cover: "https://images.pexels.com/photos/1/p.jpeg?w=1200&h=1200&fit=crop",
      credit: null,
    });
    expect(cardCover("/api/places/photo?name=places%2Fabc", ORIGIN)).toEqual({ cover: null, credit: null });
    expect(cardCover(null, ORIGIN)).toEqual({ cover: null, credit: null });
  });
});

describe("routeSketch", () => {
  it("is nothing without coordinates", () => {
    expect(routeSketch([day(1, ["A", "B"])], { width: 300, height: 300 })).toBeNull();
    expect(routeSketch([day(1, ["A"], [[0, 0]])], { width: 300, height: 300 })).toBeNull();
  });

  it("leaves out an activity at the placeholder point", () => {
    const s = routeSketch([day(1, ["Colosseum", "No pin", "Forum"], [[41.8902, 12.4922], [48.004, 10.003], [41.8925, 12.4853]])], { width: 300, height: 300 })!;
    expect(s.points).toHaveLength(2);
  });

  it("fits every stop inside the box, in order, and labels cities only when there are several", () => {
    const s = routeSketch(rome(), { width: 300, height: 200, padding: 20 });
    expect(s).not.toBeNull();
    expect(s!.points).toHaveLength(6);
    for (const p of s!.points) {
      expect(p.x).toBeGreaterThanOrEqual(20);
      expect(p.x).toBeLessThanOrEqual(280);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(180);
    }
    expect(s!.path.startsWith("M")).toBe(true);
    expect(s!.labels).toEqual([]);

    const twoCities = [day(1, ["A"], [[41.9, 12.5]], "Rome"), day(2, ["B"], [[43.77, 11.25]], "Florence")];
    const t = routeSketch(twoCities, { width: 300, height: 300 })!;
    expect(t.labels.map((l) => l.text)).toEqual(["Rome", "Florence"]);
  });

  it("centres a single stop and thins a long trip while keeping each day's first stop", () => {
    const one = routeSketch([day(1, ["A"], [[41.9, 12.5]])], { width: 300, height: 300, padding: 20 })!;
    expect(one.points[0]).toEqual({ x: 150, y: 150, day: 1 });
    expect(sketchSvg(one, { line: "#000", ring: "#fff" })).not.toContain("<path");

    const long = Array.from({ length: 20 }, (_, i) =>
      day(i + 1, ["a", "b", "c", "d", "e"], Array.from({ length: 5 }, (_, j) => [41 + i * 0.01, 12 + j * 0.01] as [number, number]))
    );
    const s = routeSketch(long, { width: 300, height: 300 })!;
    expect(s.points.length).toBeLessThanOrEqual(48 + 20);
    expect(new Set(s.points.map((p) => p.day)).size).toBe(20);
  });
});

/** Every text and image source in the tree, with the card's own components expanded. */
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
const textOf = (node: unknown) => flatten(node).join("\n");

describe("cardBudget", () => {
  const plan = (stops: Array<[number, string]>) => [
    { day_number: 1, activities: stops.map(([amount, currency]) => ({ name: "Stop", estimated_cost: { amount, currency } })) },
  ];

  it("is the plan's stops added up, per person, in the plan's currency and the card's language", () => {
    const stops = plan([[1234.4, "USD"], [345, "USD"]]);
    expect(cardBudget(stops, "USD", "en")).toBe("1,579 USD per person");
    expect(cardBudget(stops, "USD", "es")).toBe("1579 USD por persona");
    expect(cardBudget(stops, "USD", "it")).toBe("1579 USD a persona");
    expect(cardBudget(plan([[12345, "USD"]]), "USD", "it")).toBe("12.345 USD a persona");
    expect(cardBudget(stops, "USD", "pt")).toBe("1.579 USD por pessoa");
    expect(cardBudget(plan([[2500, "JPY"], [1800, "JPY"]]), "JPY", "en")).toBe("4,300 JPY per person");
  });

  it("names no figure for stops priced in several currencies, having no rates to add them with", () => {
    expect(cardBudget(plan([[30, "USD"], [400, "ZAR"]]), "USD", "en")).toBeNull();
  });

  it("names none for a plan that prices nothing, or isn't a plan", () => {
    expect(cardBudget(plan([[0, "USD"]]), "USD", "en")).toBeNull();
    expect(cardBudget([{ day_number: 1 }, null, "x"], "USD", "en")).toBeNull();
    expect(cardBudget(null, undefined, "en")).toBeNull();
  });
});

describe("renderTripCard", () => {
  it.each(["og", "square", "story"] as const)("builds the %s card with the destination, the days and the brand", (format) => {
    const text = textOf(renderTripCard(data(), format));
    expect(text).toContain("Rome, Italy");
    expect(text).toContain("12 – 14 Nov 2026");
    expect(text).toContain("3 going");
    expect(text).toContain("https://monkeytravel.app/icon-512.png");
    expect(text).toContain("images.pexels.com");
    expect(text).toContain("data:image/svg+xml");
    if (format !== "og") {
      expect(text).toContain("Colosseum · Roman Forum");
      expect(text).toContain("Day 3");
    }
  });

  it.each(["og", "square", "story"] as const)("draws a Commons cover's credit on the %s card, in the card's language", (format) => {
    const credited = data({ cover: "https://monkeytravel.app/api/images/wikimedia/abc-1280.jpg", coverCredit: { author: "Yann Caradec", license: "CC BY-SA 2.0" } });
    expect(textOf(renderTripCard(credited, format))).toContain("Photo: Yann Caradec · CC BY-SA 2.0");
    expect(textOf(renderTripCard({ ...credited, locale: "it" }, format))).toContain("Foto: Yann Caradec · CC BY-SA 2.0");
  });

  it("draws no credit for a cover that asks for none, and none without the photo it is for", () => {
    expect(textOf(renderTripCard(data(), "og"))).not.toMatch(/Photo:/);
    const noPhoto = data({ cover: null, coverCredit: { author: "Yann Caradec", license: "CC BY-SA 2.0" } });
    expect(textOf(renderTripCard(noPhoto, "story"))).not.toMatch(/Photo:/);
  });

  it("cuts a very long author short, keeping the licence", () => {
    const long = data({ cover: "https://monkeytravel.app/api/images/wikimedia/abc-1280.jpg", coverCredit: { author: "A".repeat(80), license: "CC BY 4.0" } });
    const line = flatten(renderTripCard(long, "square")).find((text) => text.startsWith("Photo:"))!;
    expect(line.endsWith("· CC BY 4.0")).toBe(true);
    expect(line.length).toBeLessThan(70);
  });

  it("copes with no cover, no coordinates, no days, and a live trip", () => {
    const bare = data({ cover: null, days: [], goingCount: 0, activityCount: 0, nights: null, budget: null });
    const text = textOf(renderTripCard(bare, "story"));
    expect(text).toContain("Planned on MonkeyTravel");
    expect(text).not.toContain("data:image/svg+xml");
    const live = data({ live: { dayNumber: 2, totalDays: 3, today: "Vatican Museums" }, locale: "pt" });
    const liveText = textOf(renderTripCard(live, "og"));
    expect(liveText).toContain("Dia 2 de 3 · Hoje: Vatican Museums");
    expect(liveText).toContain("LIVE");
    expect(liveText).toContain("3 vão");
  });

  it("has a brand card for every size", () => {
    for (const format of ["og", "square", "story"] as const) {
      const text = textOf(renderBrandCard(format, "https://monkeytravel.app/icon-512.png"));
      expect(text).toContain("MonkeyTravel");
      expect(text).toContain("icon-512.png");
    }
  });
});
