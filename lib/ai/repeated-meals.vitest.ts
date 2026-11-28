import { describe, expect, it } from "vitest";
import { repeatQuestion, repeatedRestaurants, withReplacements, type RepeatAnswer } from "@/lib/ai/repeated-meals";

/**
 * A plan can name the same restaurant on two days. The later one gets another
 * real restaurant near the stop before it, at the same time.
 */

type Stop = { name: string; type: string; start_time: string; duration_minutes: number; coordinates?: { lat: number; lng: number } };
const at = (lat: number, lng: number) => ({ lat, lng });
const stop = (start_time: string, name: string, type: string, coordinates = at(35.0, 135.77), duration_minutes = 90): Stop => ({
  name,
  type,
  start_time,
  duration_minutes,
  coordinates,
});
const day = (date: string, activities: Stop[], city?: string) => ({ date, activities, ...(city ? { city } : {}) });
const names = (d: { activities?: { name?: string; start_time?: string }[] }) => (d.activities ?? []).map((s) => `${s.start_time} ${s.name}`);

// Kyoto, three days: Gion Karyo for dinner on the first and again on the third.
const plan = () => [
  day("2027-04-05", [stop("09:00", "Kinkaku-ji", "attraction"), stop("19:00", "Gion Karyo", "restaurant")]),
  day("2027-04-06", [stop("09:00", "Fushimi Inari", "attraction"), stop("12:30", "Vermillion Cafe", "cafe")]),
  day("2027-04-07", [
    stop("09:00", "Nijo Castle", "landmark", at(35.0142, 135.7481)),
    stop("17:00", "Pontocho Alley", "attraction", at(35.0045, 135.7708)),
    stop("19:00", "Gion Karyo", "restaurant"),
  ]),
];
const another = { n: 1, name: "Pontocho Kappa", description: "Kushikatsu by the river.", location: "Pontocho", coordinates: { lat: 35.0049, lng: 135.7712 }, cost_per_person_usd: 35 };

describe("the restaurants a plan repeats", () => {
  it("are each later day's visit, with the stop before it", () => {
    expect(repeatedRestaurants(plan(), "Kyoto")).toEqual([
      { name: "Gion Karyo", date: "2027-04-07", start_time: "19:00", near: "Pontocho Alley", at: at(35.0045, 135.7708), city: "Kyoto" },
    ]);
  });

  it("know one written another way round, and name a city's own day by its city", () => {
    const days = plan();
    days[2].activities[2] = stop("19:00", "Karyo Gion", "restaurant");
    (days[2] as { city?: string }).city = "Kyoto, Japan";
    expect(repeatedRestaurants(days, "Kyoto")).toEqual([expect.objectContaining({ name: "Karyo Gion", city: "Kyoto, Japan" })]);
  });

  it("are the same place written either way round, not two that share a word", () => {
    const days = plan();
    days[0].activities[1] = stop("19:00", "Restavracija Cubo", "restaurant");
    days[2].activities[2] = stop("19:00", "Restavracija JB", "restaurant");
    expect(repeatedRestaurants(days, "Ljubljana")).toEqual([]);
    days[0].activities[1] = stop("19:00", "JB Restavracija", "restaurant");
    expect(repeatedRestaurants(days, "Ljubljana")).toEqual([expect.objectContaining({ name: "Restavracija JB" })]);
  });

  // "Trattoria da Enzo al 29" for lunch on day 1 and "Da Enzo al 29" for dinner on day 4: one place, two spellings.
  it("know one written with or without the kind of place, but not two places of one kind", () => {
    const days = plan();
    days[0].activities[1] = stop("13:00", "Trattoria da Enzo al 29", "restaurant");
    days[2].activities[2] = stop("19:30", "Da Enzo al 29", "restaurant");
    expect(repeatedRestaurants(days, "Rome")).toEqual([expect.objectContaining({ name: "Da Enzo al 29", near: "Pontocho Alley" })]);
    days[2].activities[2] = stop("19:30", "Osteria da Fortunata", "restaurant");
    expect(repeatedRestaurants(days, "Rome")).toEqual([]);
    days[2].activities[2] = stop("19:30", "Osteria da Enzo", "restaurant");
    expect(repeatedRestaurants(days, "Rome")).toEqual([]);
    // The city in one name only: "Gion Karyo Kyoto" is Gion Karyo.
    days[0].activities[1] = stop("19:00", "Gion Karyo Kyoto", "restaurant");
    days[2].activities[2] = stop("19:00", "Gion Karyo", "restaurant");
    expect(repeatedRestaurants(days, "Kyoto")).toEqual([expect.objectContaining({ name: "Gion Karyo" })]);
    days[0].activities[1] = stop("13:00", "Casa Lucio", "restaurant");
    days[2].activities[2] = stop("19:30", "Casa Labra", "restaurant");
    expect(repeatedRestaurants(days, "Madrid")).toEqual([]);
  });

  // "Ristorante Roma" and "Trattoria Roma" on a trip to "Rome, Italy": two places, each named by its kind and the city.
  it("tell two places of other kinds apart, though both bear the city's name", () => {
    const days = plan();
    days[0].activities[1] = stop("13:00", "Ristorante Roma", "restaurant");
    days[2].activities[2] = stop("19:30", "Roma Ristorante", "restaurant");
    expect(repeatedRestaurants(days, "Rome, Italy")).toEqual([expect.objectContaining({ name: "Roma Ristorante" })]);
    days[2].activities[2] = stop("19:30", "Trattoria Roma", "restaurant");
    expect(repeatedRestaurants(days, "Rome, Italy")).toEqual([]);
  });

  it("leave cafés, bars and a hotel's breakfast alone: going back to them is natural", () => {
    const days = plan();
    days[2].activities[2] = stop("19:00", "Kinkaku-ji", "attraction");
    days[0].activities.push(stop("08:00", "Hotel Kanra breakfast", "restaurant"), stop("21:00", "Bar K6", "bar"));
    days[2].activities.push(stop("08:00", "Hotel Kanra breakfast", "restaurant"), stop("21:00", "Bar K6", "bar"), stop("12:30", "Vermillion Cafe", "cafe"));
    expect(repeatedRestaurants(days, "Kyoto")).toEqual([]);
  });

  it("look near the repeat itself when nothing with a pin comes before it", () => {
    const days = plan();
    days[2].activities = [stop("12:30", "Gion Karyo", "restaurant", at(35.0031, 135.7766))];
    expect(repeatedRestaurants(days, "Kyoto")).toEqual([expect.objectContaining({ near: "Gion Karyo", at: at(35.0031, 135.7766) })]);
  });
});

describe("the question", () => {
  it("asks for a real restaurant near each place, at its time, different from the plan's own", () => {
    const q = repeatQuestion(repeatedRestaurants(plan(), "Kyoto"), { language: "it", budgetTier: "budget", diets: ["vegan"], taken: ["Gion Karyo", "Vermillion Cafe"] });
    expect(q).toContain("1. Kyoto, 2027-04-07 at 19:00, near Pontocho Alley (35.00450, 135.77080), instead of Gion Karyo");
    expect(q).toContain("inexpensive, where locals eat, with good choices for a vegan diet, a local place rather than a fast-food chain");
    expect(q).toContain("None the plan already has: Gion Karyo; Vermillion Cafe.");
    expect(q).toContain("in Italian");
  });
});

describe("the replacements", () => {
  it("take the repeat's place, at its time, named and placed as answered", () => {
    const wanted = repeatedRestaurants(plan(), "Kyoto");
    const { days, replaced } = withReplacements(plan(), wanted, { replacements: [another] });
    expect(replaced).toBe(1);
    expect(names(days[2])).toEqual(["09:00 Nijo Castle", "17:00 Pontocho Alley", "19:00 Pontocho Kappa"]);
    expect(days[2].activities[2]).toMatchObject({ type: "restaurant", duration_minutes: 90, coordinates: { lat: 35.0049, lng: 135.7712 } });
    expect(names(days[0])).toEqual(["09:00 Kinkaku-ji", "19:00 Gion Karyo"]);
  });

  it("leave the repeat when the answer is far away, already in the plan, or no real place", () => {
    const wanted = repeatedRestaurants(plan(), "Kyoto");
    const bad: RepeatAnswer[] = [
      { replacements: [{ ...another, coordinates: { lat: 34.6937, lng: 135.5023 } }] }, // Osaka
      { replacements: [{ ...another, name: "Kinkaku-ji" }] },
      { replacements: [{ ...another, coordinates: undefined }] },
      { replacements: [{ ...another, n: 2 }] },
      {},
    ];
    for (const answer of bad) {
      const { days, replaced } = withReplacements(plan(), wanted, answer);
      expect(replaced).toBe(0);
      expect(names(days[2])).toContain("19:00 Gion Karyo");
    }
  });
});
