/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import { askForNames, fitsAsName, gluedName, gluedNames, keepNamesInOneScript, renamesOf, withNames } from "./one-script-names";

const plan = (...names: string[][]) => ({
  title: "Trip",
  days: names.map((day, i) => ({ day_number: i + 1, activities: day.map((name) => ({ name, start_time: "10:00" })) })),
});

describe("a name with two writing systems in one word", () => {
  it("is what real plans got: a character stuck to Latin letters", () => {
    for (const name of ["Green波 Restaurant", "Chateau大规模 Rooftop Bar", "Niku no万世 Akihabara Honten", "Nam대mun", "東京Tower", "Shibuyaスカイ"]) {
      expect(gluedName(name), name).toBe(true);
    }
  });

  it("isn't a name that only carries its own script apart", () => {
    for (const name of ["Gyeongbokgung Palace (경복궁)", "Ichiran Ramen 一蘭", "Tsukiji Outer Market", "Café de Flore", "N Seoul Tower", "Bar 1号"]) {
      expect(gluedName(name), name).toBe(false);
    }
  });

  it("is listed once however many days hold it", () => {
    expect(gluedNames(plan(["Green波 Restaurant", "Queen Victoria Market"], ["Green波 Restaurant"]).days)).toEqual(["Green波 Restaurant"]);
    expect(gluedNames([{ activities: [null, { name: 3 }, { name: "Nam대mun" }] }])).toEqual(["Nam대mun"]);
  });
});

describe("an answer that may stand in for it", () => {
  it("keeps every Latin part, whole or as part of a word", () => {
    expect(fitsAsName("Nam대mun", "Namdaemun Market")).toBe(true);
    expect(fitsAsName("Green波 Restaurant", "Green Wave Restaurant")).toBe(true);
    expect(fitsAsName("Niku no万世 Akihabara Honten", "Niku no Mansei Akihabara Honten")).toBe(true);
    expect(fitsAsName("Café波 Lumière", "Cafe Lumiere")).toBe(true);
  });

  it("isn't another place, the same mistake, or nothing", () => {
    expect(fitsAsName("Green波 Restaurant", "Blue Wave Restaurant")).toBe(false);
    expect(fitsAsName("Green波 Restaurant", "Green波 Restaurant")).toBe(false);
    expect(fitsAsName("Green波 Restaurant", "  ")).toBe(false);
    expect(fitsAsName("Green波 Restaurant", `Green Restaurant ${"x".repeat(120)}`)).toBe(false);
  });

  it("is taken by its number, and only when it fits", () => {
    const glued = ["Green波 Restaurant", "Nam대mun"];
    const renames = renamesOf(glued, {
      names: [
        { number: 2, name: " Namdaemun Market " },
        { number: 1, name: "Blue Wave" },
        { number: 3, name: "Nowhere" },
        { number: "1", name: 7 },
      ],
    });
    expect([...renames]).toEqual([["Nam대mun", "Namdaemun Market"]]);
  });
});

describe("the plan with the usual names", () => {
  it("renames every stop under that name and leaves the rest alone", () => {
    const before = plan(["Green波 Restaurant", "Queen Victoria Market"], ["Federation Square"], ["Green波 Restaurant"]);
    const after = withNames(before.days, new Map([["Green波 Restaurant", "Green Wave Restaurant"]]));
    expect(after.map((d) => d.activities.map((a) => a.name))).toEqual([
      ["Green Wave Restaurant", "Queen Victoria Market"],
      ["Federation Square"],
      ["Green Wave Restaurant"],
    ]);
    expect(after[1]).toBe(before.days[1]);
    expect(after[0].activities[0].start_time).toBe("10:00");
  });

  it("asks nothing when no name is glued", async () => {
    const ask = vi.fn();
    const before = plan(["Queen Victoria Market"]);
    const out = await keepNamesInOneScript(before, "Melbourne", "en", ask);
    expect(ask).not.toHaveBeenCalled();
    expect(out).toEqual({ itinerary: before, costUsd: 0, glued: 0, renamed: 0 });
  });

  it("asks once for the glued names and keeps the ones that fit", async () => {
    const ask = vi.fn().mockResolvedValue({ answer: { names: [{ number: 1, name: "Green Wave Restaurant" }] }, costUsd: 0.001 });
    const before = plan(["Green波 Restaurant", "Chateau大规模 Rooftop Bar"]);
    const out = await keepNamesInOneScript(before, "Melbourne", "it", ask);
    expect(ask).toHaveBeenCalledWith("Melbourne", ["Green波 Restaurant", "Chateau大规模 Rooftop Bar"], "it");
    expect(out.itinerary.days[0].activities.map((a) => a.name)).toEqual(["Green Wave Restaurant", "Chateau大规模 Rooftop Bar"]);
    expect(out.itinerary.title).toBe("Trip");
    expect(out).toMatchObject({ costUsd: 0.001, glued: 2, renamed: 1 });
  });

  it("stays as it was when the answer fits nothing", async () => {
    const ask = vi.fn().mockResolvedValue({ answer: {}, costUsd: 0 });
    const before = plan(["Nam대mun"]);
    const out = await keepNamesInOneScript(before, "Seoul", "en", ask);
    expect(out.itinerary).toBe(before);
    expect(out).toMatchObject({ glued: 1, renamed: 0 });
  });
});

describe("the question", () => {
  it("isn't asked without a key or a glued name", async () => {
    const key = process.env.GOOGLE_AI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    expect(await askForNames("Seoul", ["Nam대mun"], "en")).toEqual({ answer: {}, costUsd: 0 });
    process.env.GOOGLE_AI_API_KEY = "test-key";
    expect(await askForNames("Seoul", [], "en")).toEqual({ answer: {}, costUsd: 0 });
    if (key === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = key;
  });
});
