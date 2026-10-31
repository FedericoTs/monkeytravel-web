import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, ItineraryDay } from "@/types";

vi.mock("@/lib/gemini", () => ({ replacementOptions: vi.fn() }));
vi.mock("@/lib/api-gateway", () => ({ logApiCall: vi.fn(async () => undefined) }));

import { replacementOptions } from "@/lib/gemini";
import { isPlaceToEat, nameAgreement, placeStatus, placesToEatCheck, type FoundPlace } from "./places-to-eat";

/** A diet plan's places to eat, against what Google's Text Search answered for them (Lisbon and Rome, real answers). */

const CHIADO = { lat: 38.7107, lng: -9.1424 };
const ROME = { lat: 41.899, lng: 12.477 };

const activity = (name: string, more: Partial<Activity> = {}): Activity =>
  ({
    name,
    type: "restaurant",
    time_slot: "afternoon",
    start_time: "13:00",
    duration_minutes: 75,
    description: "",
    location: "Chiado",
    coordinates: CHIADO,
    ...more,
  }) as Activity;

const place = (name: string, status = "OPERATIONAL", at = CHIADO, types = ["restaurant", "food"]): FoundPlace => ({
  displayName: { text: name },
  businessStatus: status,
  location: { latitude: at.lat, longitude: at.lng },
  types,
});

describe("nameAgreement", () => {
  it.each([
    ["Lunch at Ao 26 - Vegan Food Project", "26 Vegan Food Project"],
    ["Dinner at Arkhe", "arkhe"],
    ["The Green Affair (Chiado)", "The Green Affair Saldanha"],
    ["Kong - Food Made With Plants", "Kong - Food Made With Compassion"],
    ["Ristorante Settimio all'Arancio", "Settimio All'Arancio"],
    ["Vegan Lunch at Legumi Sushi & Ramen", "Legumi Sushi Vegan"],
    ["Almuerzo en Casa Lucio", "Casa Lucio"],
    ["Pranzo da Armando al Pantheon", "Armando al Pantheon"],
    ["Local Vegan Lunch at The Green Affair (Chiado)", "The Green Affair Saldanha"],
    ["The Churchill Arms", "The Churchill Arms, Kensington"],
    ["L'UniVert", "L'Uni Vert"],
  ])("knows %s as %s", (ours, google) => {
    expect(nameAgreement({ name: ours }, google)).toBe(2);
  });

  it("reads a branch's street, quarter or town in Google's name as where the plan puts it", () => {
    expect(nameAgreement({ name: "Padella", location: "Borough Market" }, "Padella Borough Market")).toBe(2);
    const mamaEat = { name: "Mama Eat Lab (Trastevere)", address: "Via di S. Cosimato, 7, 00153 Roma RM, Italy" };
    expect(nameAgreement(mamaEat, "Mama Eat Roma")).toBe(2);
    expect(nameAgreement({ name: "Mama Eat Lab (Trastevere)" }, "Mama Eat Roma")).toBe(0);
  });

  it.each([
    ["Lunch at Vegana Burgers", "Vegan Junkies"],
    ["Lunch at Vegana Burgers", "Plant Base"],
    ["Las Vegan (Chiado)", "Vegan Junkies"],
    ["Restaurante Paladar da Prata", "da Prata 52"],
    ["Dinner at O Botanista", "Orteá"],
    ["A Loja do Sal – Vegan Restaurant", "26 Vegan Food Project"],
    ["Lunch at Gluten-Free Trattoria", "Milano Trattoria"],
  ])("tells %s from %s", (ours, google) => {
    expect(nameAgreement({ name: ours }, google)).toBe(0);
  });

  it("is unsure of a Google name that is one word of the plan's", () => {
    expect(nameAgreement({ name: "Da Enzo al 29" }, "Trattoria Da Enzo")).toBe(1);
    expect(nameAgreement({ name: "Restaurante Paladar da Prata" }, "A Casa do Paladar")).toBe(1);
  });
});

describe("placeStatus", () => {
  it("is closed when Maps has the place closed, for good or for now", () => {
    expect(placeStatus(activity("Dinner at Arkhe"), [place("arkhe", "CLOSED_PERMANENTLY")])).toBe("closed");
    expect(placeStatus(activity("Las Vegan (Chiado)"), [place("Las Vegan", "CLOSED_TEMPORARILY")])).toBe("closed");
  });

  it("judges a chain by its branch at the plan's address, not by one open across town", () => {
    const found = [
      place("The Green Affair Saldanha", "OPERATIONAL", { lat: 38.7337, lng: -9.145 }),
      place("The Green Affair - Parque das Nações", "OPERATIONAL", { lat: 38.7685, lng: -9.0975 }),
    ];
    expect(placeStatus(activity("Lunch at The Green Affair (Chiado)"), found)).toBe("missing");
    const nearSaldanha = activity("The Green Affair", { coordinates: { lat: 38.7351, lng: -9.1462 }, location: "Saldanha" });
    expect(placeStatus(nearSaldanha, found)).toBe("open");
    const unpinned = activity("The Green Affair", { coordinates: undefined });
    expect(placeStatus(unpinned, found)).toBe("open");
  });

  it("takes a name sharing one word for the plan's place only where the plan puts it", () => {
    const enzo = place("Trattoria Da Enzo", "OPERATIONAL", { lat: 41.8881, lng: 12.4779 });
    expect(placeStatus(activity("Da Enzo al 29", { coordinates: { lat: 41.8885, lng: 12.4775 } }), [enzo])).toBe("open");
    expect(placeStatus(activity("Da Enzo al 29", { coordinates: undefined }), [enzo])).toBe("missing");
    const paladar = place("A Casa do Paladar", "OPERATIONAL", { lat: 38.7412, lng: -9.1655 });
    expect(placeStatus(activity("Restaurante Paladar da Prata", { coordinates: { lat: 38.7107, lng: -9.1365 } }), [paladar])).toBe("missing");
  });

  it("allows one place the model's usual stray from its point, but not a branch across town", () => {
    const junkies = place("Vegan Junkies", "OPERATIONAL", { lat: 38.7243, lng: -9.1486 });
    expect(placeStatus(activity("Lunch at Vegan Junkies", { coordinates: { lat: 38.705856, lng: -9.141548 } }), [junkies])).toBe("open");
    const parque = place("The Green Affair - Parque das Nações", "OPERATIONAL", { lat: 38.7685, lng: -9.0975 });
    expect(placeStatus(activity("Local Vegan Lunch at The Green Affair (Chiado)"), [parque])).toBe("missing");
  });

  it("is missing when Maps has only other places", () => {
    const found = [place("Plant Base"), place("Organi Chiado"), place("Vegan Junkies")];
    expect(placeStatus(activity("Lunch at Vegana Burgers"), found)).toBe("missing");
    expect(placeStatus(activity("Lunch at Vegana Burgers"), [])).toBe("missing");
  });

  it("is missing when the place by that name is in another town, or not a place to eat", () => {
    const luzzi = activity("Trattoria Luzzi", { coordinates: ROME, location: "Monti" });
    expect(placeStatus(luzzi, [place("Trattoria Luzzi", "OPERATIONAL", { lat: 40.7128, lng: -74.006 })])).toBe("missing");
    const square = place("Campo de' Fiori", "OPERATIONAL", ROME, ["plaza", "tourist_attraction"]);
    expect(placeStatus(activity("Coffee at Campo de' Fiori", { type: "cafe", coordinates: ROME }), [square])).toBe("missing");
  });

  it("does not judge by distance from the placeholder point of an activity the model gave none", () => {
    const placeholder = activity("Trattoria Luzzi", { coordinates: { lat: 48.01, lng: 10.02 } });
    expect(placeStatus(placeholder, [place("Trattoria Luzzi", "OPERATIONAL", ROME)])).toBe("open");
  });
});

describe("isPlaceToEat", () => {
  it("is a meal or a drink at one place", () => {
    expect(isPlaceToEat(activity("Pastéis de Belém", { type: "food" }))).toBe(true);
    expect(isPlaceToEat(activity("Nicolau Lisboa", { type: "cafe" }))).toBe(true);
    expect(isPlaceToEat(activity("Torre de Belém", { type: "landmark" }))).toBe(false);
    expect(isPlaceToEat(activity("Time Out Market", { type: "market" }))).toBe(false);
  });

  it("is not a tour, a class or a picnic", () => {
    expect(isPlaceToEat(activity("Gluten-Free Food Tour in Trastevere", { type: "food" }))).toBe(false);
    expect(isPlaceToEat(activity("Picnic in Borghese Gardens", { type: "food" }))).toBe(false);
    expect(isPlaceToEat(activity("Corso di cucina vegana", { type: "food" }))).toBe(false);
  });
});

describe("placesToEatCheck", () => {
  const options = vi.mocked(replacementOptions);
  let google: Record<string, FoundPlace[][]>;
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Google's answers by the name searched for: one per search, the last repeated. */
  const answers = (byName: Record<string, FoundPlace[] | FoundPlace[][]>) => {
    google = Object.fromEntries(
      Object.entries(byName).map(([name, a]) => [name, (Array.isArray(a[0]) ? a : [a]) as FoundPlace[][]]),
    );
  };
  const searchedFor = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).textQuery as string);

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    vi.stubEnv("PLACES_TO_EAT_CHECK", "");
    options.mockReset();
    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { textQuery } = JSON.parse(init.body as string) as { textQuery: string };
      const name = Object.keys(google).find((n) => textQuery.startsWith(`${n},`));
      if (!name) return new Response("{}", { status: 500 });
      const queue = google[name];
      const places = queue.length > 1 ? queue.shift()! : queue[0];
      return new Response(JSON.stringify({ places }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const check = () =>
    placesToEatCheck({ destination: "Lisbon, Portugal", dietary: ["vegan"], budgetTier: "balanced", language: "en" })!;
  const day = (...activities: Activity[]): ItineraryDay => ({ day_number: 1, date: "2027-05-01", activities });

  it("puts an open place in place of a closed one, and leaves the rest", async () => {
    answers({ "Ao 26 - Vegan Food Project": [place("26 Vegan Food Project")], Arkhe: [place("arkhe", "CLOSED_PERMANENTLY")], "Plant Base": [place("Plant Base")] });
    options.mockResolvedValueOnce([activity("Plant Base", { start_time: "19:30" }), activity("Vegan Junkies")]);
    const plan = [day(activity("Lunch at Ao 26 - Vegan Food Project"), activity("Dinner at Arkhe"), activity("Torre de Belém", { type: "landmark" }))];

    const result = await check().finish(plan);

    expect(plan[0].activities.map((a) => a.name)).toEqual(["Lunch at Ao 26 - Vegan Food Project", "Plant Base", "Torre de Belém"]);
    expect(plan[0].activities[1].time_slot).toBe("evening");
    expect(result).toMatchObject({ checked: 2, closed: 1, missing: 0, replaced: 1, dropped: 0, unanswered: 0 });
    expect(options).toHaveBeenCalledTimes(1);
    expect(options.mock.calls[0][1]).toBe(4);
    expect(options.mock.calls[0][0]).toMatchObject({
      destination: "Lisbon, Portugal",
      dietary: ["vegan"],
      preferences: { similarTo: true },
      existingActivityNames: expect.arrayContaining(["Dinner at Arkhe", "Torre de Belém"]),
    });
    expect(searchedFor()).toEqual(["Ao 26 - Vegan Food Project, Lisbon, Portugal", "Arkhe, Lisbon, Portugal", "Plant Base, Lisbon, Portugal"]);
  });

  it("asks for options twice, then leaves the place out", async () => {
    answers({ "Vegana Burgers": [place("Plant Base")], "Las Vegan": [place("Las Vegan", "CLOSED_TEMPORARILY")], "Princesa do Castelo": [place("Princesa do Castelo", "CLOSED_PERMANENTLY")] });
    options.mockResolvedValueOnce([activity("Las Vegan (Chiado)")]).mockResolvedValueOnce([activity("Princesa do Castelo")]);
    const plan = [day(activity("Lunch at Vegana Burgers"), activity("Castelo de São Jorge", { type: "landmark" }))];

    const result = await check().finish(plan);

    expect(plan[0].activities.map((a) => a.name)).toEqual(["Castelo de São Jorge"]);
    expect(result).toMatchObject({ checked: 1, missing: 1, replaced: 0, dropped: 1 });
    expect(options).toHaveBeenCalledTimes(2);
    expect(options.mock.calls[1][0].existingActivityNames).toEqual(expect.arrayContaining(["Lunch at Vegana Burgers", "Las Vegan (Chiado)"]));
  });

  it("keeps a place Google didn't answer for", async () => {
    answers({});
    const plan = [day(activity("Dinner at Arkhe"))];

    const result = await check().finish(plan);

    expect(plan[0].activities.map((a) => a.name)).toEqual(["Dinner at Arkhe"]);
    expect(result).toMatchObject({ checked: 1, unanswered: 1, replaced: 0, dropped: 0 });
    expect(options).not.toHaveBeenCalled();
  });

  it("gives two closed places two different open ones when both are offered the same", async () => {
    answers({ Arkhe: [place("arkhe", "CLOSED_PERMANENTLY")], Foodprintz: [place("Foodprintz", "CLOSED_PERMANENTLY")], "Plant Base": [place("Plant Base")], "Vegan Junkies": [place("Vegan Junkies")] });
    options.mockImplementation(async () => [activity("Plant Base"), activity("Vegan Junkies")]);
    const plan = [day(activity("Dinner at Arkhe")), day(activity("Foodprintz"))];

    const result = await check().finish(plan);

    expect(plan.flatMap((d) => d.activities.map((a) => a.name)).sort()).toEqual(["Plant Base", "Vegan Junkies"]);
    expect(result).toMatchObject({ closed: 2, replaced: 2 });
    expect(options).toHaveBeenCalledTimes(2);
  });

  it("passes over an option the plan already has, however worded, without looking it up", async () => {
    answers({ "Ao 26 - Vegan Food Project": [place("26 Vegan Food Project")], "Las Vegan": [place("Las Vegan", "CLOSED_TEMPORARILY")], "Os Tibetanos": [place("Os Tibetanos")] });
    options.mockResolvedValueOnce([activity("Ao 26 - Vegan Food Project"), activity("Os Tibetanos")]);
    const plan = [day(activity("Lunch at Las Vegan"), activity("Vegan Dinner at Ao 26 - Vegan Food Project"))];

    await check().finish(plan);

    expect(plan[0].activities.map((a) => a.name)).toEqual(["Os Tibetanos", "Vegan Dinner at Ao 26 - Vegan Food Project"]);
    expect(searchedFor()).toEqual(["Las Vegan, Lisbon, Portugal", "Ao 26 - Vegan Food Project, Lisbon, Portugal", "Os Tibetanos, Lisbon, Portugal"]);
  });

  it("gives a day written on the trip page no place the rest of the trip has, and leaves the rest alone", async () => {
    answers({ Arkhe: [place("arkhe", "CLOSED_PERMANENTLY")], "Plant Base": [place("Plant Base")], "Vegan Junkies": [place("Vegan Junkies")] });
    options.mockResolvedValueOnce([activity("Plant Base"), activity("Vegan Junkies")]);
    const newDay = day(activity("Dinner at Arkhe"));
    const rest = [day(activity("Lunch at Plant Base"), activity("Dinner at Foodprintz"))];

    await check().finish([newDay], rest);

    expect(newDay.activities.map((a) => a.name)).toEqual(["Vegan Junkies"]);
    expect(options.mock.calls[0][0].existingActivityNames).toContain("Lunch at Plant Base");
    expect(searchedFor()).toEqual(["Arkhe, Lisbon, Portugal", "Vegan Junkies, Lisbon, Portugal"]);
  });

  it("asks Google once more when it finds nothing", async () => {
    answers({ Fatamorgana: [[], [place("Fatamorgana Monti", "OPERATIONAL", ROME, ["ice_cream_shop", "food"])]] });
    const plan = [day(activity("Fatamorgana (Gelateria)", { type: "food", coordinates: ROME, location: "Monti" }))];

    const result = await placesToEatCheck({ destination: "Rome, Italy", dietary: ["gluten-free"], budgetTier: "balanced" })!.finish(plan);

    expect(result).toMatchObject({ checked: 1, closed: 0, missing: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("looks the days up as they come, and searches each place once", async () => {
    answers({ "Ao 26 - Vegan Food Project": [place("26 Vegan Food Project")] });
    const c = check();
    c.look({ activities: [activity("Lunch at Ao 26 - Vegan Food Project"), activity("Torre de Belém", { type: "landmark" })] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await c.finish([day(activity("Lunch at Ao 26 - Vegan Food Project"))]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("seeks an open place for a closed one while the rest of the plan is written", async () => {
    answers({ Arkhe: [place("arkhe", "CLOSED_PERMANENTLY")], "Plant Base": [place("Plant Base")] });
    options.mockResolvedValueOnce([activity("Plant Base")]);
    const c = check();
    c.look(day(activity("Dinner at Arkhe")));
    await vi.waitFor(() => expect(options).toHaveBeenCalledTimes(1));

    const plan = [day(activity("Dinner at Arkhe"))];
    const result = await c.finish(plan);

    expect(plan[0].activities.map((a) => a.name)).toEqual(["Plant Base"]);
    expect(result).toMatchObject({ closed: 1, replaced: 1 });
    expect(options).toHaveBeenCalledTimes(1);
  });

  it("seeks again at the end when a later day has the place sought early", async () => {
    answers({ Arkhe: [place("arkhe", "CLOSED_PERMANENTLY")], "Plant Base": [place("Plant Base")], "Vegan Junkies": [place("Vegan Junkies")] });
    options.mockResolvedValueOnce([activity("Plant Base")]).mockResolvedValueOnce([activity("Vegan Junkies")]);
    const c = check();
    c.look(day(activity("Dinner at Arkhe")));
    await vi.waitFor(() => expect(options).toHaveBeenCalledTimes(1));

    const plan = [day(activity("Dinner at Arkhe")), { ...day(activity("Lunch at Plant Base")), day_number: 2 }];
    await c.finish(plan);

    expect(plan.flatMap((d) => d.activities.map((a) => a.name))).toEqual(["Vegan Junkies", "Lunch at Plant Base"]);
    expect(options).toHaveBeenCalledTimes(2);
  });

  it("searches a multi-city day in its own city", async () => {
    answers({});
    await check().finish([{ ...day(activity("Bonci Pizzarium", { coordinates: ROME })), city: "Rome" }]);
    expect(searchedFor()).toEqual(["Bonci Pizzarium, Rome"]);
  });

  it("is off without a diet, without a Google key, or switched off", () => {
    expect(placesToEatCheck({ destination: "Lisbon", dietary: [], budgetTier: "balanced" })).toBeNull();
    vi.stubEnv("PLACES_TO_EAT_CHECK", "false");
    expect(placesToEatCheck({ destination: "Lisbon", dietary: ["vegan"], budgetTier: "balanced" })).toBeNull();
    vi.stubEnv("PLACES_TO_EAT_CHECK", "");
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    expect(placesToEatCheck({ destination: "Lisbon", dietary: ["vegan"], budgetTier: "balanced" })).toBeNull();
  });
});
