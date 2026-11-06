// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which places get looked up and what the report says of them. Google's answers
 * are faked; the rule for a place to eat and the pace rule are the real ones.
 */

const lookups: [string, string][] = [];
let answer: (name: string) => "open" | "closed" | "missing" | null;

vi.mock("@/lib/places/places-to-eat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/places/places-to-eat")>()),
  lookUpPlaceToEat: async (name: string, where: string) => {
    lookups.push([name, where]);
    return answer(name);
  },
}));

const { checkPlan, MAX_PLACE_LOOKUPS } = await import("./plan-check");
const { MUST_DOS_MAX } = await import("@/lib/trips/request-limits");

const stop = (name: string, type = "restaurant", where = "Trastevere", minutes: number | null = null) => ({ name, type, where, minutes });
const planOf = (...days: ReturnType<typeof stop>[][]) => ({
  destination: "Rome",
  days: days.map((stops, i) => ({ label: `Day ${i + 1}`, stops })),
});

beforeEach(() => {
  lookups.length = 0;
  answer = () => "open";
});

describe("what gets looked up", () => {
  it("places to eat with a name, and not sights, hotels or transfers", async () => {
    await checkPlan(
      planOf([stop("Trattoria da Enzo"), stop("Colosseum", "landmark"), stop("Hotel Artemide", "lodging"), stop("Train to Naples", "transport"), stop("Bar San Calisto", "bar")]),
      { lookUp: true },
    );
    expect(lookups.map(([name]) => name)).toEqual(["Trattoria da Enzo", "Bar San Calisto"]);
  });

  it("near where the plan puts it, or in the trip's place when it doesn't say", async () => {
    await checkPlan(planOf([stop("Da Enzo", "restaurant", "Trastevere"), stop("Roscioli", "restaurant", "")]), { lookUp: true });
    expect(lookups).toEqual([
      ["Da Enzo", "Trastevere, Rome"],
      ["Roscioli", "Rome"],
    ]);
  });

  it("without saying the trip's place twice", async () => {
    await checkPlan(planOf([stop("Da Enzo", "restaurant", "Trastevere, rome"), stop("Roscioli", "restaurant", "Rome")]), { lookUp: true });
    expect(lookups.map(([, where]) => where)).toEqual(["Trastevere, rome", "Rome"]);
  });

  it("with what it has when the plan names no trip's place", async () => {
    await checkPlan({ destination: "", days: [{ label: "", stops: [stop("Da Enzo", "restaurant", "Trastevere"), stop("Roscioli", "restaurant", "")] }] }, { lookUp: true });
    expect(lookups.map(([, where]) => where)).toEqual(["Trastevere", ""]);
  });

  it("stops at the limit across the whole plan", async () => {
    const many = Array.from({ length: MAX_PLACE_LOOKUPS }, (_, i) => stop(`Place ${i}`));
    const report = await checkPlan(planOf(many.slice(0, 5), many.slice(5), [stop("One too many")]), { lookUp: true });
    expect(lookups).toHaveLength(MAX_PLACE_LOOKUPS);
    expect(report.days[2].stops[0].status).toBeNull();
    expect(report.looked).toBe(MAX_PLACE_LOOKUPS);
  });

  it("nothing at all when told not to, and the days still read", async () => {
    const report = await checkPlan(planOf([stop("Da Enzo")]), { lookUp: false });
    expect(lookups).toEqual([]);
    expect(report.days[0].stops).toEqual([{ name: "Da Enzo", status: null }]);
    expect(report.looked).toBe(0);
  });
});

describe("the report", () => {
  it("says what Maps said of each place, and counts it", async () => {
    const said = { "Da Enzo": "open", Closed: "closed", "Also closed": "closed", Unknown: "missing" } as const;
    answer = (name) => said[name as keyof typeof said] ?? null;
    const report = await checkPlan(planOf([stop("Da Enzo"), stop("Closed"), stop("Also closed"), stop("Unknown"), stop("Search failed")]), { lookUp: true });
    expect(report.days[0].stops).toEqual([
      { name: "Da Enzo", status: "open" },
      { name: "Closed", status: "closed" },
      { name: "Also closed", status: "closed" },
      { name: "Unknown", status: "missing" },
      { name: "Search failed", status: null },
    ]);
    expect(report).toMatchObject({ destination: "Rome", looked: 4, closed: 2, missing: 1 });
  });

  it("leaves hotels and transfers off the day's stops", async () => {
    const report = await checkPlan(planOf([stop("Hotel Artemide", "lodging"), stop("Train", "transport"), stop("Colosseum", "landmark")]), { lookUp: false });
    expect(report.days[0].stops.map((s) => s.name)).toEqual(["Colosseum"]);
  });
});

describe("a day that's too full", () => {
  const sights = (n: number, minutes: number | null = null) => Array.from({ length: n }, (_, i) => stop(`Sight ${i}`, "landmark", "", minutes));

  it("by its number of stops", async () => {
    const report = await checkPlan(planOf(sights(6), sights(5)), { lookUp: false });
    expect(report.days.map((d) => d.packed)).toEqual([true, false]);
    expect(report.packedDays).toBe(1);
  });

  it("by the hours the plan gives", async () => {
    const report = await checkPlan(planOf(sights(3, 240), sights(3, 120)), { lookUp: false });
    expect(report.days.map((d) => d.packed)).toEqual([true, false]);
  });

  it("not counting the hotel and the transfers", async () => {
    const report = await checkPlan(planOf([...sights(5), stop("Hotel", "lodging"), stop("Taxi", "transport")]), { lookUp: false });
    expect(report.days[0].packed).toBe(false);
  });
});

describe("the places a fixed plan keeps", () => {
  it("every stop but the closed ones, once each", async () => {
    answer = (name) => (name === "Closed" ? "closed" : "open");
    const report = await checkPlan(planOf([stop("Da Enzo"), stop("Closed"), stop("Colosseum", "landmark")], [stop("Da Enzo")]), { lookUp: true });
    expect(report.keep).toEqual(["Da Enzo", "Colosseum"]);
  });

  it("not the ones Maps can't find, so a made-up place stays out of the new plan", async () => {
    answer = (name) => (name === "Made up" ? "missing" : "open");
    const report = await checkPlan(planOf([stop("Da Enzo"), stop("Made up")]), { lookUp: true });
    expect(report.keep).toEqual(["Da Enzo"]);
  });

  it("the ones Maps couldn't tell", async () => {
    answer = () => null;
    const report = await checkPlan(planOf([stop("Trattoria Da Enzo al 29")]), { lookUp: true });
    expect(report.keep).toEqual(["Trattoria Da Enzo al 29"]);
  });

  it("no more than the wizard takes", async () => {
    const many = Array.from({ length: MUST_DOS_MAX + 3 }, (_, i) => stop(`Sight ${i}`, "landmark"));
    const report = await checkPlan(planOf(many), { lookUp: false });
    expect(report.keep).toHaveLength(MUST_DOS_MAX);
  });
});
