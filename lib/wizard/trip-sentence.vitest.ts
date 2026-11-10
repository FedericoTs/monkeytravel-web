import { describe, expect, it } from "vitest";
import { VIBES_MAX } from "@/lib/trips/request-limits";
import { isTripSentence, looksLikeRequest, matchesPlace, pencilledDates, readTripSentence } from "./trip-sentence";

const read = (s: string) => readTripSentence(s);

describe("readTripSentence", () => {
  it("keeps no more vibes than a trip can have, in the order they are named", () => {
    expect(read("5 days in Lisbon for food, history, hiking, nightlife and romance")?.vibes).toEqual(
      ["foodie", "cultural", "nature", "urban", "romantic"].slice(0, VIBES_MAX)
    );
  });

  it("reads place, length, month and vibes from one English sentence", () => {
    expect(read("5 days in Lisbon in March, food and history")).toEqual({
      destination: "Lisbon",
      days: 5,
      month: 3,
      vibes: ["foodie", "cultural"],
      intent: null,
      budget: null,
    });
  });

  it("reads weeks, weekends and nights", () => {
    expect(read("Tokyo for a week").days).toBe(7);
    expect(read("two weeks in Japan").days).toBe(14);
    expect(read("a weekend in Rome").days).toBe(3);
    expect(read("long weekend in Paris").days).toBe(4);
    expect(read("4 nights in Prague").days).toBe(5);
    expect(read("Berlin 3-day trip").days).toBe(3);
  });

  it("keeps the length the wizard accepts", () => {
    expect(read("1 day in Rome").days).toBe(2);
    expect(read("3 weeks in Thailand").days).toBe(14);
  });

  it("reads the people a trip is for", () => {
    expect(read("Tokyo for a week with my girlfriend")).toMatchObject({ destination: "Tokyo", vibes: ["romantic"] });
    expect(read("Barcelona 4 days with friends").intent).toBe("group");
    expect(read("family trip to Orlando in July")).toMatchObject({ destination: "Orlando", intent: "group", month: 7 });
    expect(read("solo week in Iceland").intent).toBe("solo");
  });

  it("reads Italian, Spanish and Portuguese", () => {
    expect(read("weekend a Roma a marzo")).toMatchObject({ destination: "Roma", days: 3, month: 3 });
    expect(read("una settimana in Giappone con gli amici")).toMatchObject({ destination: "Giappone", days: 7, intent: "group" });
    expect(read("viaggio di 5 giorni a roma, cibo e storia")).toMatchObject({ destination: "roma", days: 5, vibes: ["foodie", "cultural"] });
    expect(read("fin de semana en Madrid en octubre")).toMatchObject({ destination: "Madrid", days: 3, month: 10 });
    expect(read("10 días en México con mi novia")).toMatchObject({ destination: "México", days: 10, vibes: ["romantic"] });
    expect(read("uma semana em Lisboa em março")).toMatchObject({ destination: "Lisboa", days: 7, month: 3 });
  });

  it("reads the example the destination field shows in each language", () => {
    for (const example of ["4 days in Rome", "4 días en Roma", "4 giorni a Roma", "4 dias em Roma"]) {
      expect(read(example)).toMatchObject({ days: 4, month: null });
      expect(read(example).destination).toMatch(/^Rom[ea]$/);
      expect(isTripSentence(read(example))).toBe(true);
    }
  });

  it("keeps the small words inside a place's name", () => {
    expect(read("Rio de Janeiro 6 days").destination).toBe("Rio de Janeiro");
    expect(read("4 days in Los Angeles").destination).toBe("Los Angeles");
    expect(read("3 giorni a La Spezia").destination).toBe("La Spezia");
    expect(read("Santiago de Compostela in May").destination).toBe("Santiago de Compostela");
  });

  it("does not take names that are month words for months", () => {
    expect(read("Venice San Marco 3 days")).toMatchObject({ destination: "Venice San Marco", month: null });
    expect(read("Rome in May").month).toBe(5);
    expect(read("May Fair London 2 days").month).toBeNull();
  });

  it("joins several places", () => {
    expect(read("Paris and London 10 days").destination).toBe("Paris and London");
    expect(read("Rome 3 days, Florence").destination).toBe("Rome & Florence");
  });

  it("reads budget words", () => {
    expect(read("cheap 5 days in Budapest")).toMatchObject({ destination: "Budapest", budget: "budget" });
    expect(read("luxury week in Bali").budget).toBe("luxury");
  });

  it("is a sentence only when it says where and how long or when", () => {
    expect(isTripSentence(read("Lisbon"))).toBe(false);
    expect(isTripSentence(read("Lisbon food"))).toBe(false);
    expect(isTripSentence(read("5 days"))).toBe(false);
    expect(isTripSentence(read("5 days in Lisbon"))).toBe(true);
    expect(isTripSentence(read("Lisbon in March"))).toBe(true);
  });

  // A longer request leaves words the rules can't read, and they used to be
  // planned as places: "Bali & with 3 & our friends".
  it("is no sentence when the words left over can't all be places", () => {
    for (const request of [
      "Bali for 8 days with 3 kids and our friends.",
      "rome 4 days, milan 2 days , turin 2 days ,",
      "From Durban to Johannesburg then back to Durban after 4 nights",
      "un itinerario di 12 giorni in Giappone A/R su Tokyo a ottobre, famiglia 3 persone 2+1)",
      "Recife 6 dias ( saindo de Olinda indo de carro sendo um dia pra ir e um pra voltar )",
    ]) {
      expect(isTripSentence(read(request)), request).toBe(false);
    }
    expect(isTripSentence(read("Venice San Marco 3 days"))).toBe(true);
    expect(isTripSentence(read("Paris and London 10 days"))).toBe(true);
  });

  // Words around the length ("make me", "un itinerario") would be a second place.
  it("is a sentence for one place: several are the request reader's", () => {
    for (const request of [
      "fammi un itinerario di 10 giorni a Roma",
      "make me a 5 day itinerary for Paris",
      "somewhere warm with the kids in April, not too expensive please",
      "Rome 3 days, Florence",
      // Not a name the planner takes.
      "Rome+Florence 5 days",
    ]) {
      expect(isTripSentence(read(request)), request).toBe(false);
    }
  });
});

describe("looksLikeRequest", () => {
  it("is a whole trip in words", () => {
    for (const request of [
      "Bali for 8 days with 3 kids and our friends.",
      "rome 4 days, milan 2 days , turin 2 days ,",
      "Madrid, Then fast train to Seville and stay in Seville, Cordoba & Granada",
      "we are planning a trip to vietnam in april and want beaches and street food",
      "Lyon from 10-13 & Geneva 13-16",
      "a ".repeat(60),
    ]) {
      expect(looksLikeRequest(request), request).toBe(true);
    }
  });

  it("is not a place, a place with its region, or a list of places", () => {
    for (const place of [
      "Lisbon",
      "Rio de Janeiro",
      "Area 51",
      "Ho Chi Minh City, Phu Quoc, Hanoi, Da Nang & Sapa",
      "Warsaw, Krakow, Budapest, Vienna & Bad Ischl",
      "Lake Bled and Ljubljana",
      "Ho Chi Minh City and Da Nang",
      "Roma e Firenze",
      "Rome, Florence, Venice,",
      "",
    ]) {
      expect(looksLikeRequest(place), place).toBe(false);
    }
  });

  it("is one when it holds more than a destination may", () => {
    expect(looksLikeRequest("goa & kerala & pondicherry;")).toBe(true);
    // A list too long for one destination is read as a route.
    expect(looksLikeRequest("Ho Chi Minh City, Phu Quoc, Hanoi, Da Nang, Hoi An, Hue, Sapa, Ha Long Bay, Ninh Binh, Mui Ne, Dalat & Can Tho")).toBe(true);
  });
});

describe("matchesPlace", () => {
  it("takes the search hit only when it is the place typed", () => {
    expect(matchesPlace("lisbon", { mainText: "Lisbon" })).toBe(true);
    expect(matchesPlace("México", { mainText: "Mexico" })).toBe(true);
    expect(matchesPlace("new york", { mainText: "New York City" })).toBe(true);
    expect(matchesPlace("Lisboa", { mainText: "Lisbon" })).toBe(false);
    expect(matchesPlace("Paris", { mainText: "Parish" })).toBe(false);
  });
});

describe("pencilledDates", () => {
  const today = "2026-10-26";

  it("starts three weeks out for five days when the sentence says neither", () => {
    expect(pencilledDates({ days: null, month: null }, today)).toEqual({ start: "2026-11-16", end: "2026-11-20" });
  });

  it("starts on the 15th of the month it names, this year or next", () => {
    expect(pencilledDates({ days: 5, month: 12 }, today)).toEqual({ start: "2026-12-15", end: "2026-12-19" });
    expect(pencilledDates({ days: 7, month: 3 }, today)).toEqual({ start: "2027-03-15", end: "2027-03-21" });
  });

  it("starts a week out when the month named is the current one and its 15th has gone", () => {
    expect(pencilledDates({ days: 3, month: 10 }, today)).toEqual({ start: "2026-11-02", end: "2026-11-04" });
  });

  it("takes next month's 15th when it is at least a week away", () => {
    expect(pencilledDates({ days: 4, month: 11 }, "2026-11-10")).toEqual({ start: "2026-11-17", end: "2026-11-20" });
    expect(pencilledDates({ days: 4, month: 11 }, today)).toEqual({ start: "2026-11-15", end: "2026-11-18" });
  });
});
