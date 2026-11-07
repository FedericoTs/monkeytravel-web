import { describe, expect, it } from "vitest";
import en from "@/messages/en/match.json";
import es from "@/messages/es/match.json";
import it_ from "@/messages/it/match.json";
import pt from "@/messages/pt/match.json";
import { MATCH_PLACES } from "./places";
import { PLACE_PHOTOS } from "./photos";
import { MAX_COMPANIONS, QUESTIONS, homeFromContinent, makeCode, parseCode, parseCompanions, type Home, type Person } from "./questions";
import { TRAVEL_TYPES, planHref, placeScore, rankPlaces, travelType, whyKeys, type MatchPlace } from "./score";

const person = (answers: number[], home: Home = "e"): Person => ({ answers, home });

function everyAnswerSet(): number[][] {
  let sets: number[][] = [[]];
  for (const question of QUESTIONS) {
    sets = sets.flatMap((set) => question.options.map((_, option) => [...set, option]));
  }
  return sets;
}

const place = (over: Partial<MatchPlace>): MatchPlace => ({
  slug: "somewhere",
  continent: "europe",
  budgetLevel: 2,
  bestMonths: [4, 5, 9, 10],
  tags: [],
  stayDays: 4,
  ...over,
});

describe("the code in the link", () => {
  it("gives back the person it was made from", () => {
    expect(parseCode(makeCode([3, 0, 4, 2, 1, 0], "a"))).toEqual({ answers: [3, 0, 4, 2, 1, 0], home: "a" });
  });

  it.each(["", "123", "000000", "000000z", "400000e", "040000e", "005000e", "000300e", "000040e", "000003e", "000000ee", "abcdefe"])(
    "refuses %s, which no answer can produce",
    (code) => {
      expect(parseCode(code)).toBeNull();
    }
  );

  it("refuses nothing a real answer can produce", () => {
    for (const answers of everyAnswerSet()) expect(parseCode(makeCode(answers, "x"))?.answers).toEqual(answers);
  });

  it("reads a continent from the geo header, and doesn't guess one", () => {
    expect(homeFromContinent("EU")).toBe("e");
    expect(homeFromContinent("sa")).toBe("m");
    expect(homeFromContinent("AN")).toBe("x");
    expect(homeFromContinent(null)).toBe("x");
  });

  it("keeps a short list of real, different friends", () => {
    expect(parseCompanions("000000e,bad,000000e,111111a", "111111a")).toEqual(["000000e"]);
    const many = ["000000e", "100000e", "200000e", "300000e", "010000e"];
    expect(parseCompanions(many.join(","))).toHaveLength(MAX_COMPANIONS);
    expect(parseCompanions(null)).toEqual([]);
  });

  it("reads friends from a parameter repeated in the link", () => {
    expect(parseCompanions(["000000e", "100000e,bad"])).toEqual(["000000e", "100000e"]);
  });
});

describe("the score", () => {
  it("rewards what the person asked for", () => {
    const beachLover = person([0, 3, 4, 1, 0, 2]);
    expect(placeScore(place({ tags: ["beach", "wellness"] }), beachLover)).toBeGreaterThan(placeScore(place({ tags: ["historical"] }), beachLover));
  });

  it("counts the season: a place at its best beats one out of season", () => {
    const inSpring = person([1, 0, 0, 1, 0, 2]);
    expect(placeScore(place({ bestMonths: [3, 4, 5] }), inSpring)).toBeGreaterThan(placeScore(place({ bestMonths: [7, 8] }), inSpring));
    const anytime = person([1, 0, 4, 1, 0, 2]);
    expect(placeScore(place({ bestMonths: [3, 4, 5] }), anytime)).toBe(placeScore(place({ bestMonths: [7, 8] }), anytime));
  });

  it("counts the budget", () => {
    const tight = person([1, 0, 4, 0, 0, 2]);
    expect(placeScore(place({ budgetLevel: 1 }), tight)).toBeGreaterThan(placeScore(place({ budgetLevel: 3 }), tight));
    const treat = person([1, 0, 4, 2, 0, 2]);
    expect(placeScore(place({ budgetLevel: 3 }), treat)).toBeGreaterThan(placeScore(place({ budgetLevel: 1 }), treat));
  });

  it("counts the distance from where the person is, and only if it's known", () => {
    const stayClose = person([1, 0, 4, 1, 0, 0], "e");
    expect(placeScore(place({ continent: "europe" }), stayClose)).toBeGreaterThan(placeScore(place({ continent: "asia" }), stayClose));
    expect(placeScore(place({ continent: "africa", slug: "marrakech" }), stayClose)).toBeGreaterThan(placeScore(place({ continent: "africa", slug: "nairobi" }), stayClose));
    const goFar = person([1, 0, 4, 1, 0, 1], "e");
    expect(placeScore(place({ continent: "asia" }), goFar)).toBeGreaterThan(placeScore(place({ continent: "europe" }), goFar));
    const unknown = person([1, 0, 4, 1, 0, 0], "x");
    expect(placeScore(place({ continent: "asia" }), unknown)).toBe(placeScore(place({ continent: "europe" }), unknown));
  });

  it("keeps nightlife away from a family trip", () => {
    const family = person([1, 0, 4, 1, 3, 2]);
    expect(placeScore(place({ tags: ["nightlife"] }), family)).toBeLessThan(placeScore(place({ tags: [] }), family));
  });
});

describe("the ranking", () => {
  it("gives the same answer every time for the same link", () => {
    const people = [person([0, 1, 2, 1, 2, 2], "m")];
    expect(rankPlaces(MATCH_PLACES, people).map((m) => m.place.slug)).toEqual(rankPlaces(MATCH_PLACES, people).map((m) => m.place.slug));
  });

  it("shows a high match for the best place and a lower one further down", () => {
    const ranked = rankPlaces(MATCH_PLACES, [person([1, 0, 0, 1, 1, 0], "e")]);
    expect(ranked[0].percent).toBeGreaterThanOrEqual(ranked[ranked.length - 1].percent);
    expect(ranked[0].percent).toBeGreaterThanOrEqual(75);
    expect(ranked[0].percent).toBeLessThanOrEqual(99);
  });

  it("finds a place for two people that suits both better than either's favourite suits the other", () => {
    const romantic = person([1, 0, 4, 1, 1, 2]);
    const hiker = person([3, 3, 4, 1, 0, 2]);
    const together = rankPlaces(MATCH_PLACES, [romantic, hiker])[0].place.slug;
    const hersOnly = rankPlaces(MATCH_PLACES, [romantic])[0].place;
    const hisOnly = rankPlaces(MATCH_PLACES, [hiker])[0].place;
    const both = MATCH_PLACES.find((p) => p.slug === together)!;
    const worstOf = (p: MatchPlace) => Math.min(placeScore(p, romantic), placeScore(p, hiker));
    expect(worstOf(both)).toBeGreaterThanOrEqual(Math.min(worstOf(hersOnly), worstOf(hisOnly)));
  });

  it("uses the whole list: every place is someone's best, and no place takes more than one result in eight", () => {
    const wins = new Map<string, number>();
    const sets = everyAnswerSet();
    const homes: Home[] = ["e", "a", "m"];
    for (const answers of sets) {
      for (const home of homes) {
        const top = rankPlaces(MATCH_PLACES, [{ answers, home }])[0].place.slug;
        wins.set(top, (wins.get(top) ?? 0) + 1);
      }
    }
    const total = sets.length * homes.length;
    const never = MATCH_PLACES.filter((p) => !wins.has(p.slug)).map((p) => p.slug);
    expect(never).toEqual([]);
    const tooOften = [...wins].filter(([, count]) => count / total > 1 / 8).map(([slug, count]) => `${slug} ${((count / total) * 100).toFixed(1)}%`);
    expect(tooOften).toEqual([]);
  });

  it("has a tall photo for every place in it, and every place with a photo is in it", () => {
    expect(MATCH_PLACES.map((p) => p.slug).sort()).toEqual(Object.keys(PLACE_PHOTOS).sort());
  });
});

describe("the travel type", () => {
  it("gives every morning and evening a type, and every type turns up", () => {
    const seen = new Set<string>();
    for (let morning = 0; morning < 4; morning++) {
      for (let evening = 0; evening < 4; evening++) seen.add(travelType(person([morning, evening, 0, 0, 0, 0])));
    }
    expect([...seen].sort()).toEqual([...TRAVEL_TYPES].sort());
  });
});

describe("the percent", () => {
  it("never claims a perfect 100, even for a place that fits every answer", () => {
    const perfect = place({ tags: ["beach", "wellness", "nature", "romantic", "foodie", "offbeat", "urban", "cultural"], budgetLevel: 1, bestMonths: [3, 4, 5] });
    expect(rankPlaces([perfect], [person([0, 0, 0, 0, 0, 2])])[0].percent).toBe(99);
  });
});

describe("why this place", () => {
  it("says only what the place offers", () => {
    const swimmer = person([0, 0, 0, 0, 0, 0], "e");
    expect(whyKeys(place({ tags: ["historical"] }), swimmer)).not.toContain("morning.sea");
    expect(whyKeys(place({ tags: ["beach"] }), swimmer)).toContain("morning.sea");
    expect(whyKeys(place({ tags: ["wellness", "nature"] }), swimmer)).not.toContain("morning.sea");
  });

  it("names the season only when the place is at its best then", () => {
    const inWinter = person([1, 0, 3, 1, 0, 2]);
    expect(whyKeys(place({ bestMonths: [12, 1, 2], tags: [] }), inWinter)).toContain("when.winter");
    expect(whyKeys(place({ bestMonths: [6, 7], tags: [] }), inWinter)).not.toContain("when.winter");
    expect(whyKeys(place({ bestMonths: [6, 7, 12], tags: [] }), inWinter)).not.toContain("when.winter");
  });

  it("names the budget and the distance when they fit, and stops at the limit", () => {
    const person_ = person([1, 0, 0, 0, 0, 0], "e");
    const keys = whyKeys(place({ tags: ["historical", "romantic", "foodie"], budgetLevel: 1, bestMonths: [3, 4] }), person_, 9);
    expect(keys).toEqual(["morning.streets", "evening.dinner", "when.spring", "budget.tight", "far.near"]);
    expect(whyKeys(place({ tags: ["historical", "romantic", "foodie"], budgetLevel: 1, bestMonths: [3, 4] }), person_)).toHaveLength(3);
  });
});

describe("the planner link", () => {
  const lisbon = place({ slug: "lisbon", stayDays: 4 });
  const params = (href: string) => new URL(href, "https://x.test").searchParams;

  it("carries the place, the length, the budget and the vibes", () => {
    const p = params(planHref(lisbon, person([1, 0, 0, 2, 1, 0])));
    expect(p.get("destination")).toBe("lisbon");
    expect(p.get("days")).toBe("4");
    expect(p.get("budget")).toBe("premium");
    expect(p.get("vibes")).toBe("cultural,romantic");
    expect(p.get("from")).toBe("match");
  });

  it("doesn't repeat a vibe", () => {
    expect(params(planHref(lisbon, person([0, 3, 0, 0, 1, 0]))).get("vibes")).toBe("nature");
  });

  it("says who's coming when the planner has that answer, and a trip together is a group", () => {
    expect(params(planHref(lisbon, person([1, 0, 0, 1, 0, 0]))).get("who")).toBe("solo");
    expect(params(planHref(lisbon, person([1, 0, 0, 1, 2, 0]))).get("who")).toBe("group");
    expect(params(planHref(lisbon, person([1, 0, 0, 1, 1, 0]))).get("who")).toBeNull();
    expect(params(planHref(lisbon, person([1, 0, 0, 1, 0, 0]), true)).get("who")).toBe("group");
  });
});

describe("the words", () => {
  const dig = (messages: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);

  it.each([
    ["en", en],
    ["es", es],
    ["it", it_],
    ["pt", pt],
  ])("%s has every question, type and reason the code can ask for", (_locale, messages) => {
    const wanted = new Set<string>();
    for (const question of QUESTIONS) {
      wanted.add(`q.${question.id}.title`);
      for (const option of question.options) wanted.add(`q.${question.id}.options.${option}`);
    }
    for (const type of TRAVEL_TYPES) {
      wanted.add(`types.${type}.name`);
      wanted.add(`types.${type}.line`);
    }
    for (const answers of everyAnswerSet()) {
      for (const home of ["e", "x"] as const) {
        for (const candidate of MATCH_PLACES) {
          for (const key of whyKeys(candidate, person(answers, home), 9)) wanted.add(`why.${key}`);
        }
      }
    }
    const missing = [...wanted].filter((key) => typeof dig(messages, key) !== "string");
    expect(missing).toEqual([]);
  });
});
