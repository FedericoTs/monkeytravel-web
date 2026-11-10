/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import type { ItineraryDay } from "@/types";
import { buildPrompt } from "./edit-prompt";
import { composeReply } from "./edit-reply";
import type { DayEdit } from "./edit-validation";
import { correctionFor } from "./engine";
import { asksForFewerDays, asksForMoreDays, asksToAdd, keepsEverything, listedPlaces, talksAboutDayCount } from "./message-asks";
import { keepSavedActivities, takenOut } from "./saved-activities";
import { outsideTravelTimes, readTravelTimes } from "./travel-times";
import { asksToRemove, replyLanguage, statedDayCounts } from "./honesty";

/**
 * The trip assistant should understand what a traveller means and do what
 * they asked, all of it, on the day they named. Cases from real conversations
 * and the replay set built from them.
 */

const act = (name: string, start_time = "10:00", extra: Record<string, unknown> = {}) =>
  ({ name, start_time, time_slot: "morning", duration_minutes: 90, ...extra }) as unknown as DayEdit["activities"][number];
const day = (n: number, names: string[]) =>
  ({ day_number: n, activities: names.map((x, i) => act(x, `${9 + 2 * i}:00`)) }) as unknown as ItineraryDay;
const edit = (n: number, names: string[]): DayEdit => ({
  day_number: n,
  summary: `Day ${n}`,
  activities: names.map((x, i) => act(x, `${10 + 2 * i}:30`)),
});

describe("keepSavedActivities", () => {
  const saved = [
    day(2, ["Explore Plaza Botero and Museo de Antioquia", "Lunch at Versalles Restaurante-Bar", "Explore Parque Berrío & Metropolitan Cathedral"]),
    day(4, ["National Museum of Ireland - Archaeology"]),
  ];

  it("keeps a saved activity the model only translated or reworded, at its new time", () => {
    const [out] = keepSavedActivities(saved, [
      edit(2, ["Plaza Botero y Museo de Antioquia", "Versalles Restaurante-Bar", "Parque Berrío y Metropolitan Cathedral", "Clase de Salsa en Dancefree"]),
    ]);
    expect(out.activities.map((a) => a.name)).toEqual([
      "Explore Plaza Botero and Museo de Antioquia",
      "Lunch at Versalles Restaurante-Bar",
      "Explore Parque Berrío & Metropolitan Cathedral",
      "Clase de Salsa en Dancefree",
    ]);
    expect(out.activities[0].start_time).toBe("10:30");
  });

  // A lunch in the Ribeira is not the "Ribeira walk".
  it("never takes a meal for a sight that shares its words", () => {
    const porto = [
      { day_number: 2, activities: [act("Ribeira walk", "16:00", { type: "attraction" }), act("Mercado do Bolhão", "11:00", { type: "market" })] },
    ] as unknown as ItineraryDay[];
    const lunch = (name: string) => act(name, "13:30", { type: "restaurant" });
    const [out] = keepSavedActivities(porto, [{ day_number: 2, summary: "", activities: [lunch("Almuerzo en la Ribeira"), act("Ribeira walk", "15:00", { type: "attraction" })] }]);
    expect(out.activities.map((a) => a.name)).toEqual(["Almuerzo en la Ribeira", "Ribeira walk"]);
    // A market is a place to eat: lunch there stays the saved visit.
    const [market] = keepSavedActivities(porto, [{ day_number: 2, summary: "", activities: [lunch("Almoço no Mercado do Bolhão")] }]);
    expect(market.activities[0].name).toBe("Mercado do Bolhão");
  });

  it("does not mistake a different place that shares a few words", () => {
    const [out] = keepSavedActivities(saved, [edit(4, ["National Gallery of Ireland"])]);
    expect(out.activities[0].name).toBe("National Gallery of Ireland");
  });

  it("knows a name put in the reader's language", () => {
    const [out] = keepSavedActivities(saved, [edit(2, ["Parque Berrío y Catedral Metropolitana", "Clase de Salsa"])]);
    expect(out.activities.map((a) => a.name)).toEqual(["Explore Parque Berrío & Metropolitan Cathedral", "Clase de Salsa"]);
  });

  it("keeps a note the reply or the request is about, and the saved description otherwise", () => {
    const lunch = [{ day_number: 2, activities: [act("Lunch at Versalles Restaurante-Bar", "13:00", { description: "Historic bandeja paisa" })] }] as unknown as ItineraryDay[];
    const noted = edit(2, ["Lunch at Versalles Restaurante-Bar"]);
    noted.activities[0] = { ...noted.activities[0], description: "Ask for the vegetarian bandeja" };
    const [talked] = keepSavedActivities(lunch, [noted], { reply: "At Versalles, ask for the vegetarian bandeja." });
    expect(talked.activities[0].description).toBe("Ask for the vegetarian bandeja");
    const [echoed] = keepSavedActivities(lunch, [noted], { reply: "¡Entendido!", message: "mi esposa es vegetariana" });
    expect(echoed.activities[0].description).toBe("Ask for the vegetarian bandeja");
    const [quiet] = keepSavedActivities(lunch, [noted], { reply: "Added a salsa class on day 2.", message: "add a salsa class on day 2" });
    expect(quiet.activities[0].description).toBe("Historic bandeja paisa");
  });

  it("keeps a change that adds a word of its own", () => {
    const [out] = keepSavedActivities([day(1, ["Sagrada Familia"])], [edit(1, ["Guided tour of Sagrada Familia"])]);
    expect(out.activities[0].name).toBe("Guided tour of Sagrada Familia");
  });

  it("uses each saved activity once", () => {
    const [out] = keepSavedActivities(saved, [edit(2, ["Versalles Restaurante-Bar", "Versalles Restaurante-Bar"])]);
    expect(out.activities.map((a) => a.name)).toEqual(["Lunch at Versalles Restaurante-Bar", "Versalles Restaurante-Bar"]);
  });
});

describe("takenOut", () => {
  it("names what a change drops, and not what it moved to another edited day", () => {
    const days = [day(1, ["Guinness Storehouse", "Dublin Castle"]), day(2, ["Howth Cliff Walk"])];
    const edits = [edit(1, ["Dublin Castle", "Jameson Distillery Bow St."]), edit(2, ["Howth Cliff Walk", "Guinness Storehouse"])];
    expect(takenOut(days, edits)).toEqual([]);
    expect(takenOut(days, [edit(1, ["Dublin Castle", "Jameson Distillery Bow St."])])).toEqual(["Guinness Storehouse"]);
  });

  it("leaves out of the note what the reply already named, even loosely", () => {
    const base = { lockedDays: [], lengthRefused: false, locale: "es", currentDays: 5, autoApplied: true, edits: [edit(5, ["Viaje a Montserrat"])] };
    const reply = "¡Claro! Para incluir Montserrat he reemplazado las actividades de Gràcia y Casa Batlló.";
    const takenOutNames = ["Explore Gràcia Neighborhood", "Lunch at Con Gracia", "Casa Batlló"];
    expect(composeReply({ ...base, reply, takenOut: takenOutNames })).toBe(reply);
    const beach = composeReply({ ...base, reply: "He añadido el SUP en Barceloneta.", takenOut: ["Relax at Barceloneta Beach & Port Olímpic"] });
    expect(beach).toContain("(Este cambio quita: Relax at Barceloneta Beach & Port Olímpic.)");
  });

  it("does not count a split, a translation or a repeat as taken out", () => {
    const istanbul = [day(1, ["Check-in to Hotel & Explore Sultanahmet Square", "Dinner at Tarihi Yarımada"])];
    const split = edit(1, ["Check-in to Hotel", "Explore Sultanahmet Square", "Dinner at Tarihi Yarımada", "Hagia Sophia at night"]);
    expect(takenOut(istanbul, [split])).toEqual([]);
    const medellin = [day(2, ["Explore Parque Berrío & Metropolitan Cathedral"])];
    expect(takenOut(medellin, [edit(2, ["Parque Berrío y Catedral Metropolitana", "Clase de Salsa"])])).toEqual([]);
    const dublin = [day(1, ["Guinness Storehouse"]), day(2, ["Guinness Storehouse", "Dublinia"])];
    expect(takenOut(dublin, [edit(2, ["Jameson Distillery Bow St.", "Dublinia"])])).toEqual([]);
  });

  it("is said in the reply unless the traveller asked for removals or the reply names it", () => {
    const base = { lockedDays: [], lengthRefused: false, locale: "en", currentDays: 2, edits: [edit(2, ["Jameson Distillery Bow St."])] };
    expect(composeReply({ ...base, reply: "Here's day 2 with the Jameson tour.", takenOut: ["Guinness Storehouse"] })).toBe(
      "Here's day 2 with the Jameson tour. (This change takes out: Guinness Storehouse.)"
    );
    expect(composeReply({ ...base, autoApplied: true, reply: "Swapped the Guinness Storehouse for Jameson.", takenOut: ["Guinness Storehouse"] })).toBe(
      "Swapped the Guinness Storehouse for Jameson."
    );
    expect(asksToRemove("take out all restaurants")).toBe(true);
    expect(asksToRemove("quita todos los restaurantes")).toBe(true);
    expect(asksToRemove("add a Jameson whiskey distillery tour")).toBe(false);
  });
});

describe("what must stay", () => {
  it("is not a request to remove it", () => {
    // From a real conversation: the drafts kept swapping out this dinner.
    expect(asksToRemove("coloque em outro dia, não substitua o jantar na Choperia Brahma")).toBe(false);
    expect(asksToRemove("não remova nada que já esteja planejado, somente adicione")).toBe(false);
    expect(asksToRemove("Não quero que você remova nada do que já está")).toBe(false);
    expect(asksToRemove("add a jazz bar but don't replace the dinner")).toBe(false);
    expect(asksToRemove("añade una cena sin quitar nada")).toBe(false);
    expect(asksToRemove("aggiungi una cena senza togliere niente")).toBe(false);
    // A removal asked for is still one, next to something kept.
    expect(asksToRemove("don't change day 2, but replace the museum with a park")).toBe(true);
    expect(asksToRemove("a day without museums")).toBe(true);
    expect(asksToRemove("não quero mais o museu, substitua por um parque")).toBe(true);
    expect(asksToRemove("No, cambia el museo por un parque")).toBe(true);
  });

  it("holds for the whole request when they say to keep everything", () => {
    expect(keepsEverything("vou pedir para você adicionar alguns restaurantes. não remova nada que já esteja planejado")).toBe(true);
    expect(keepsEverything("somente adicione em dias que ficarem mais apropriados")).toBe(true);
    expect(keepsEverything("add these bars, don't remove anything")).toBe(true);
    expect(keepsEverything("just add them where they fit")).toBe(true);
    expect(keepsEverything("añádelos sin quitar nada")).toBe(true);
    expect(keepsEverything("non togliere niente, aggiungi solo questi")).toBe(true);
    expect(keepsEverything("add a museum on day 2")).toBe(false);
    expect(keepsEverything("remove the museum on day 2")).toBe(false);
  });
});

const TEN =
  "izakaya tanuki, o senhor restaurante, baraquias restaurante, dhoosushi, madalosso restaurante, park do churrasco restaurante, cantina do délio, zefy diner, bar do alemao e lett's road. Eles podem ser opção para almoço ou jantar.";

describe("listedPlaces", () => {
  it("reads the places of a list, the last two joined by and, without their article", () => {
    expect(listedPlaces(TEN)).toEqual([
      "izakaya tanuki",
      "senhor restaurante",
      "baraquias restaurante",
      "dhoosushi",
      "madalosso restaurante",
      "park do churrasco restaurante",
      "cantina do délio",
      "zefy diner",
      "bar do alemao",
      "lett's road",
    ]);
    expect(listedPlaces("Add Bar Basso, Nottingham Forest and Camparino in Galleria")).toEqual(["Bar Basso", "Nottingham Forest", "Camparino in Galleria"]);
  });

  it("finds none in a message without a list", () => {
    expect(listedPlaces("add a cooking class on day 2")).toEqual([]);
    expect(listedPlaces("add Madalosso and Zefy Diner")).toEqual([]);
    expect(listedPlaces("I'd like more time at the beach, less driving, and earlier dinners because we travel with a toddler who sleeps early")).toEqual([]);
    expect(listedPlaces("We want slow mornings, long lunches by the sea, and no early starts at all please")).toEqual([]);
  });
});

describe("asksToAdd", () => {
  it("hears a polite or formal ask, as Brazilian and Spanish travellers write it", () => {
    for (const ask of ["adicione um restaurante no primeiro dia", "coloque em outro dia", "acrescente um bar", "inclua o museu", "añada una cena", "agregue un bar", "incluya el museo", "aggiunga una cena", "metta il museo il giorno 2"]) {
      expect(asksToAdd(ask), ask).toBe(true);
    }
    expect(asksToAdd("o que tem para fazer à noite?")).toBe(false);
  });
});

describe("a terse claim on a change waiting for Apply", () => {
  const base = { lockedDays: [], lengthRefused: false, locale: "en", currentDays: 2, edits: [edit(2, ["Jameson Distillery Bow St."])] };

  it("says it isn't applied yet, as it does for a longer one", () => {
    expect(composeReply({ ...base, reply: "Added a Jameson tour to Day 2." })).toMatch(/^Not applied yet: .* Added a Jameson tour to Day 2\.$/);
    expect(composeReply({ ...base, reply: "I've added a Jameson tour to Day 2." })).toMatch(/^Not applied yet: .* I've added a Jameson tour to Day 2\.$/);
  });

  it("is left as it is once the change is applied", () => {
    expect(composeReply({ ...base, autoApplied: true, reply: "Added a Jameson tour to Day 2." })).toBe("Added a Jameson tour to Day 2.");
  });
});

describe("a terse claim with nothing prepared", () => {
  it("gives way to the truth", () => {
    const reply = composeReply({ lockedDays: [], lengthRefused: false, locale: "en", currentDays: 2, edits: [], reply: "Added a Jameson tour to Day 2." });
    expect(reply).not.toContain("Added a Jameson");
  });
});

describe("replyLanguage", () => {
  it.each([
    ["¡Entendido! He ajustado el plan para que tu esposa tenga opciones vegetarianas.", "es"],
    ["Ecco il calcolo completo del costo totale per il tuo viaggio.", "it"],
    ["Pronto! Adicionei a aula de salsa no dia 2, com mais tempo para o jantar.", "pt"],
    ["Here's day 2 with the Jameson tour added.", "en"],
  ])("reads %s", (text, language) => {
    expect(replyLanguage(text)).toBe(language);
  });

  it("is unsure of a word or two", () => {
    expect(replyLanguage("Done.")).toBeUndefined();
  });

  it("puts the note in the reply's language, not the plan's", () => {
    const out = composeReply({
      reply: "¡Listo! He añadido una clase de salsa para la noche del día 2.",
      edits: [edit(2, ["Salsa"])],
      lockedDays: [],
      lengthRefused: false,
      locale: "en",
      currentDays: 2,
      takenOut: ["Guinness Storehouse"],
    });
    expect(out).toContain("(Este cambio quita: Guinness Storehouse.)");
  });
});

// "Isn't 28 Nov to 6 Dec 8 days instead of 9?" got "You're totally right!", and
// "count, it's 8" a trip cut to 8 days. Dates of a 9-day trip, 8 nights.
const ALGARVE = Array.from({ length: 9 }, (_, i) => ({
  day_number: i + 1,
  date: i < 3 ? `2026-11-${28 + i}` : `2026-12-0${i - 2}`,
  activities: [act(`Algarve ${i + 1}`)],
})) as unknown as ItineraryDay[];

describe("how long the trip is", () => {
  it.each([
    "please make it 8 days, remove the last day",
    "can we shorten the trip",
    "drop the last day",
    "one day less",
    "I need an 8 day one",
    "togli l'ultimo giorno",
    "un día menos",
    "quita un día",
    "tira o último dia",
    "pode encurtar a viagem?",
    "we leave a day earlier",
    "let's end the trip on the 5th",
    "partiamo un giorno prima",
  ])("hears a shorter trip asked for: %s", (text) => {
    expect(asksForFewerDays(text)).toBe(true);
  });

  it.each(["No in this chat here, count, it's 8", "Count em, day by day", "Count", "add a museum on day 2", "make day 3 lighter"])(
    "hears no shorter trip in: %s",
    (text) => {
      expect(asksForFewerDays(text)).toBe(false);
    },
  );

  it("knows when the count is in question", () => {
    for (const m of ["Also kind if confused isn't 28 nov to 6 dec 8 days instead of 9 days?", "Still 9 days?", "Count", "No in this chat here, count, it's 8", "how many nights is it", "quanti giorni sono?", "¿cuántos días son?"]) {
      expect(talksAboutDayCount(m), m).toBe(true);
    }
    for (const m of ["add a museum on day 2", "make day 3 lighter", "we land at 17:15"]) expect(talksAboutDayCount(m), m).toBe(false);
  });

  it("reads the count a reply gives, and not an offer", () => {
    expect(statedDayCounts("You're totally right! From November 28 to December 6 is indeed 8 days total.")).toEqual([8, 8]);
    expect(statedDayCounts("Yes, November 28 to December 6 is 9 days in total (Day 1 through Day 9)!")).toEqual([9, 9]);
    expect(statedDayCounts("You're right, let's count it as 8 days!")).toEqual([8]);
    expect(statedDayCounts("It's 9 days and 8 nights.")).toEqual([9]);
    expect(statedDayCounts("Del 28 de noviembre al 6 de diciembre son 9 días.")).toEqual([9]);
    expect(statedDayCounts("Dal 28 novembre al 6 dicembre sono 9 giorni.")).toEqual([9]);
    expect(statedDayCounts("De 28 de novembro a 6 de dezembro são 9 dias.")).toEqual([9]);
    expect(statedDayCounts("Would you like an 8-day trip instead? I can end it on December 5.")).toEqual([]);
  });

  it("asks again when a reply cuts days nobody asked to cut, or gives another count", () => {
    const told = { days: ALGARVE, startDate: "2026-11-28" };
    const cut = correctionFor({ ...told, message: "No in this chat here, count, it's 8" }, { reply: "I've adjusted your itinerary to 8 days.", edits: [], tripLength: 8 });
    expect(cut).toContain("The trip is Sat, 28 Nov 2026 to Sun, 6 Dec 2026: 9 days and 8 nights, Day 1 to Day 9.");
    expect(cut).toContain("Your edits make the trip shorter, which they didn't ask for.");
    expect(cut).toContain("say kindly that 9 days are 8 nights");
    const agreed = { reply: "You're totally right! From November 28 to December 6 is indeed 8 days total.", edits: [] };
    expect(correctionFor({ ...told, message: "isn't 28 nov to 6 dec 8 days instead of 9 days?" }, agreed)).toContain('Your "reply" gives it another number of days.');
    // Asked for, or agreed to when offered, a shorter trip is a change.
    expect(correctionFor({ ...told, message: "please make it 8 days, remove the last day" }, { reply: "Your trip now ends on December 5.", edits: [], tripLength: 8 })).toBeNull();
    const offer = { role: "assistant" as const, text: "Would you like me to remove the last day and shorten your trip to 8 days?" };
    expect(correctionFor({ ...told, message: "yes", history: [offer] }, { reply: "Done: 8 days, ending December 5.", edits: [], tripLength: 8 })).toBeNull();
    // The right count, or a count nobody asked about, needs nothing.
    expect(correctionFor({ ...told, message: "Still 9 days?" }, { reply: "Yes, it's 9 days and 8 nights.", edits: [] })).toBeNull();
    expect(correctionFor({ ...told, message: "what's the best beach?" }, { reply: "Praia da Marinha. A 2-day stay there is 2 days well spent.", edits: [] })).toBeNull();
  });
});

describe("asksForMoreDays", () => {
  it.each([
    "add 2 more days",
    "Add 1 more day at the end of the trip and set trip_length to 8",
    "can we extend the trip by one night",
    "agrega un día más",
    "aggiungi 2 giorni in più",
    "mais um dia em Lisboa",
    "make it 9 days",
    "add another day",
    "add a day after Rome",
    "aggiungi un altro giorno a Firenze",
  ])("hears a request for more days: %s", (text) => {
    expect(asksForMoreDays(text)).toBe(true);
  });

  it.each(["add hakone", "include Cascais and Óbidos", "agrega otra excursión de un día", "add a day trip to Sintra"])(
    "hears none in: %s",
    (text) => {
      expect(asksForMoreDays(text)).toBe(false);
    }
  );

  // A day of the trip, by its number or as the last one, is where the change goes.
  it.each([
    "add a gelato stop on day 1",
    "add dinner to day 3, near the hotel",
    "aggiungi una cena al giorno 3",
    "agrega un museo el día 2",
    "adicione um jantar no dia 4",
    "add a museum on the last day",
    "aggiungi un aperitivo l'ultimo giorno",
    "añade una cena el último día",
  ])("hears a day of the trip, not more days, in: %s", (text) => {
    expect(asksForMoreDays(text)).toBe(false);
  });

  it("hears a day the trip doesn't have yet as more days", () => {
    expect(asksForMoreDays("add day 6 in Pisa", 5)).toBe(true);
    expect(asksForMoreDays("aggiungi il giorno 6 a Pisa", 5)).toBe(true);
    expect(asksForMoreDays("add a gelato stop on day 5", 5)).toBe(false);
    // Without the trip's length, a day by its number is one of the trip's.
    expect(asksForMoreDays("add day 6 in Pisa")).toBe(false);
  });
});

describe("correctionFor", () => {
  const days = [day(1, ["A"]), day(2, ["B"]), day(3, ["C"]), day(4, ["D"]), day(5, ["E"])];

  it("sends a longer trip whose days didn't come back for them", () => {
    const message = "add 2 more days in Hoi An";
    const claimed = { reply: "I've added two extra days in Hoi An.", edits: [edit(3, ["C", "New"])] };
    expect(correctionFor({ message, days }, claimed)).toContain('"trip_length"');
    // Nothing prepared at all, same claim.
    expect(correctionFor({ message, days }, { ...claimed, edits: [] })).toContain('"trip_length"');
    // It asked for a longer trip without the new last days: the reply needn't say so.
    const refused = { reply: "Here are days in Hoi An.", edits: [edit(3, ["C", "New"])], lengthRefused: true };
    expect(correctionFor({ message, days }, refused)).toContain('"trip_length"');
    // The trip did get longer.
    expect(correctionFor({ message, days }, { ...claimed, tripLength: 7, edits: [edit(6, ["New"]), edit(7, ["New"])] })).toBeNull();
    // The reply doesn't claim one: it fits the days in, or says it can't.
    expect(correctionFor({ message, days }, { ...claimed, reply: "Day 3 now has more of Hoi An instead." })).toBeNull();
    // Nobody asked for more days. A shorter trip that would lose a fixed plan is refused the same way.
    expect(correctionFor({ message: "make day 3 about Hoi An", days }, claimed)).toBeNull();
    expect(correctionFor({ message: "make the trip shorter", days }, refused)).toBeNull();
    // Only the owner may add days.
    expect(correctionFor({ message, days, canAddDays: false }, claimed)).toBeNull();
    expect(correctionFor({ message, days, canAddDays: false }, refused)).toBeNull();
  });

  it("asks again around a fixed plan the reply moved or took out", () => {
    const fixed = [day(1, ["A"]), { day_number: 2, activities: [act("B"), act("Wedding", "15:00", { locked: true })] } as unknown as ItineraryDay];
    const moved = { reply: "Here's Day 2, with the wedding later.", edits: [edit(2, ["B", "Wedding"])], lockedDays: [{ dayNumber: 2, names: ["Wedding"] }] };
    const c = correctionFor({ message: "move the wedding to the evening", days: fixed }, moved);
    expect(c).toContain("Day 2 has a fixed plan the traveller set: Wedding at 15:00.");
    expect(c).toContain("they can change it themselves in the plan");
    expect(correctionFor({ message: "move the wedding to the evening", days: fixed }, { ...moved, lockedDays: [] })).toBeNull();
  });

  it("sends a change made on another day than the one named back to that day", () => {
    const c = correctionFor({ message: "can we add the Oceanário on day 4", days }, { reply: "Added to day 5.", edits: [edit(5, ["Oceanário"])] });
    expect(c).toContain("Make the change on Day 4");
    expect(correctionFor({ message: "can we add the Oceanário on day 4", days }, { reply: "Done.", edits: [edit(4, ["D", "Oceanário"])] })).toBeNull();
  });

  it("keeps what a day had when the traveller only asked to add", () => {
    const c = correctionFor({ message: "add a salsa class on day 2", days }, { reply: "Here's day 2.", edits: [edit(2, ["Salsa class"])] });
    expect(c).toContain("They asked only to add. Keep B");
    // A whole day handed to a day trip is how one fits in.
    const full = [day(1, ["A1", "A2", "A3"]), day(2, ["B1", "B2", "B3"])];
    expect(correctionFor({ message: "add Hakone", days: full }, { reply: "Day 2 is Hakone.", edits: [edit(2, ["Hakone ropeway", "Lake Ashi", "Onsen"])] })).toBeNull();
    expect(correctionFor({ message: "replace B with a salsa class", days }, { reply: "Done.", edits: [edit(2, ["Salsa class"])] })).toBeNull();
  });

  it("keeps everything when they said not to remove anything, however much a day loses", () => {
    const full = [day(1, ["A1", "A2", "A3"]), day(2, ["B1", "B2", "B3"])];
    const swapped = { reply: "Dia 2 com os restaurantes.", edits: [edit(2, ["Madalosso", "Bar do Alemão", "Zefy Diner"])] };
    const told = { role: "user" as const, text: "não remova nada que já esteja planejado, somente adicione" };
    const c = correctionFor({ message: "izakaya tanuki, madalosso, bar do alemão", days: full, history: [told] }, swapped);
    expect(c).toContain("keep everything already planned");
    expect(c).toContain("B1 and B2 and B3");
    // In the same message, with a polite ask.
    expect(correctionFor({ message: "adicione estes restaurantes, não remova nada", days: full }, swapped)).toContain("keep everything");
    // Told nothing of the kind, a whole day given to what they add is how it fits.
    expect(correctionFor({ message: "add Madalosso, Bar do Alemão and Zefy Diner", days: full }, swapped)).toBeNull();
    // Asking now for something to go is a change of mind.
    expect(correctionFor({ message: "tire o B1 e coloque o Madalosso", days: full, history: [told] }, { ...swapped, edits: [edit(2, ["Madalosso", "B2", "B3"])] })).toBeNull();
  });

  // Live, 11-09: ten restaurants asked for, eight added, and a reply naming all ten.
  it("sends back a list of places that came back short, naming what's missing", () => {
    const plan = [day(1, ["A", "Zefy Diner"]), day(2, ["B"]), day(3, ["C"])];
    const told = { role: "user" as const, text: "quero adicionar alguns restaurantes da minha lista" };
    const message = "madalosso restaurante, zefy diner, bar do alemao, baraquias restaurante e lett's road.";
    const short = { reply: "Adicionei todos.", edits: [edit(2, ["B", "Madalosso"]), edit(3, ["C", "Bar do Alemão", "Lett's Road"])] };
    const c = correctionFor({ message, days: plan, history: [told] }, short);
    // Zefy Diner was already in the plan; the accent and "Restaurante" don't hide a place.
    expect(c).toBe(
      `These places from their list aren't in your edits: baraquias restaurante. Add each one once, on a day where it fits, keeping everything else, or say in "reply" which can't fit and why.`,
    );
    // The rest is still to come, on the days a later part brings.
    expect(correctionFor({ message, days: plan, history: [told] }, { ...short, moreDays: [4] })).toBeNull();
    // Not asked to add them: a list in a question is just a question.
    expect(correctionFor({ message: `${message} quais abrem de domingo?`, days: plan, history: [] }, short)).toBeNull();
    // A list of kinds, which no place's name repeats, isn't held to it.
    expect(correctionFor({ message: "add museums, parks, markets and viewpoints", days: plan }, { reply: "Done.", edits: [edit(2, ["B", "Museu Paranaense"])] })).toBeNull();
  });

  it("names the places a list still lacks after the change, whatever the reply says", () => {
    const base = { lockedDays: [], lengthRefused: false, locale: "pt", currentDays: 3, ownLead: true, edits: [edit(2, ["B", "Madalosso"])] };
    expect(composeReply({ ...base, reply: "Adicionei todos os restaurantes.", listMissing: ["baraquias restaurante", "senhor restaurante"] })).toBe(
      "Adicionei todos os restaurantes. (Não entrou nesta alteração: baraquias restaurante, senhor restaurante.)",
    );
  });

  it("sends back edits that changed nothing", () => {
    const same = [{ ...days[0], summary: "", activities: days[0].activities }] as unknown as DayEdit[];
    expect(correctionFor({ message: "make day 1 vegetarian", days }, { reply: "Updated!", edits: same })).toContain("left every day as it was");
  });

  it("catches an activity added on one day that another day already has", () => {
    const saved = [day(3, ["Kinkaku-ji"]), day(4, ["Fushimi Inari-taisha Shrine", "Nishiki Market"])];
    const edits = keepSavedActivities(saved, [edit(3, ["Fushimi Inari-taisha Shrine", "Kinkaku-ji"])]);
    expect(correctionFor({ message: "move fushimi inari to day 3 morning", days: saved }, { reply: "Done.", edits })).toContain(
      "is already on Day 4"
    );
  });

  it("lets an activity recur that the plan already repeats", () => {
    const saved = [day(1, ["Breakfast at the hotel", "A"]), day(2, ["Breakfast at the hotel", "B"]), day(3, ["C"])];
    const edits = [edit(3, ["Breakfast at the hotel", "C"])];
    expect(correctionFor({ message: "add breakfast to day 3", days: saved }, { reply: "Done.", edits })).toBeNull();
  });

  it("adds the check-in for a hotel they name, not for a question about its area", () => {
    const noted = { reply: "Noted!", edits: [] };
    expect(correctionFor({ message: "our hotel is Hotel Arts Barcelona for the whole stay", days }, noted)).toContain(
      '"Check in at <place>"'
    );
    expect(correctionFor({ message: "our hotel is near Shibuya station, where should we eat?", days }, noted)).toBeNull();
    expect(correctionFor({ message: "our hotel is near the Duomo", days }, noted)).toBeNull();
  });

  it("refuses a longer trip nobody asked for, but not one they did", () => {
    const longer = { reply: "Added Óbidos as day 6.", edits: [edit(6, ["Óbidos"])], tripLength: 6 };
    expect(correctionFor({ message: "include Cascais and Óbidos", days }, longer)).toContain("Keep the trip at 5 days");
    // A stop asked for on a day of the trip, with a day added on top.
    const plusDay = { reply: "Added gelato on day 5, and Óbidos as day 6.", edits: [edit(5, ["E", "Gelato"]), edit(6, ["Óbidos"])], tripLength: 6 };
    expect(correctionFor({ message: "add a gelato stop on day 5", days }, plusDay)).toContain("Keep the trip at 5 days");
    expect(correctionFor({ message: "aggiungi un aperitivo l'ultimo giorno", days }, longer)).toContain("Keep the trip at 5 days");
    expect(correctionFor({ message: "add one more day for Óbidos", days }, longer)).toBeNull();
    // A day the trip doesn't have yet.
    expect(correctionFor({ message: "add day 6 in Óbidos", days }, longer)).toBeNull();
    expect(
      correctionFor(
        { message: "yes", days, history: [{ role: "assistant", text: "Want me to add 1 more day for Óbidos?" }] },
        longer
      )
    ).toBeNull();
  });

  it("asks for the change a reply hands over with no edits", () => {
    const empty = (reply: string) => correctionFor({ message: "togliamo il ristorante alla sera", days }, { reply, edits: [] });
    expect(empty("Ecco la proposta per rimuovere Restaurace Mlejnice dal Giorno 2.")).toContain('"edits" is empty');
    expect(empty("Ok, I'll propose adding a Beer Spa on Day 2.")).toContain('"edits" is empty');
    // Said to be made already, with nothing sent: "I've added…" and an empty "edits".
    expect(empty("I've added a ryokan stay for the night of the 23rd.")).toContain('"edits" is empty');
    expect(empty("Ho aggiunto il ryokan alla sera del 23.")).toContain('"edits" is empty');
    // A currency request is answered by the page, not by edits.
    expect(correctionFor({ message: "show prices in dollars", days }, { reply: "I've updated the prices to USD.", edits: [] })).toBeNull();
    // With the change attached, the words are true.
    expect(correctionFor({ message: "add a beer spa on day 2", days }, { reply: "Here's the proposal.", edits: [edit(2, ["B", "Beer spa"])] })).toBeNull();
  });

  it("makes the change a short yes agrees to, and only when one was offered", () => {
    const after = (text: string) => [{ role: "assistant" as const, text }];
    const offered = after("Certo, posso rimuovere la cena al Restaurace Mlejnice dal Giorno 2.");
    expect(correctionFor({ message: "ok", days, history: offered }, { reply: "Perfetto!", edits: [] })).toContain("said yes");
    expect(correctionFor({ message: "sì", days, history: after("Vuoi che aggiunga una gita in battello?") }, { reply: "Ok!", edits: [] })).toContain(
      "said yes"
    );
    // Nothing offered: asking what to change is the right answer.
    expect(
      correctionFor({ message: "ok", days, history: after("Day 2 has a market and a museum.") }, { reply: "What would you like to change?", edits: [] })
    ).toBeNull();
    expect(correctionFor({ message: "ok", days, history: offered }, { reply: "Done.", edits: [edit(2, ["B"])] })).toBeNull();
  });

  // A 14:00 flight home leaves no lunch at 12:30 or shopping after it.
  it("sends back a day that doesn't fit when they arrive or leave", () => {
    const lastDay: DayEdit = {
      day_number: 5,
      summary: "",
      activities: [act("Breakfast at Gallery Drip", "08:30", { duration_minutes: 60 }), act("Lunch at Baan Khanitha", "12:30", { duration_minutes: 60 })],
    };
    const leaving = [{ day: 5, leaves: "14:00", by: "flight" }];
    expect(correctionFor({ message: "make the last day relaxed", days }, { reply: "Done.", edits: [lastDay], travelTimes: leaving })).toBe(
      `Day 5: they leave at 14:00, so everything must end by 11:00. Lunch at Baan Khanitha (12:30) doesn't fit. Move what matters to a day with room, or leave it out, and say so in "reply".`,
    );
    const firstDay: DayEdit = {
      day_number: 1,
      summary: "",
      activities: [act("Lunch at O Afonso", "13:00", { duration_minutes: 60 }), act("Dinner at Traça", "20:00", { duration_minutes: 90 })],
    };
    expect(
      correctionFor({ message: "Y las comidas que faltan, organizarlas", days }, { reply: "Hecho.", edits: [firstDay], travelTimes: [{ day: 1, arrives: "23:00" }] }),
    ).toContain("Day 1: they arrive at 23:00, too late for anything but getting to where they stay. Lunch at O Afonso (13:00), Dinner at Traça (20:00) don't fit.");
    // Times on days the reply doesn't change are not its to fix.
    expect(correctionFor({ message: "make the last day relaxed", days }, { reply: "Done.", edits: [firstDay], travelTimes: leaving })).toBeNull();
  });

  it("fits the whole plan to a time the message gives, not only the days the reply changes", () => {
    const saved = [day(1, ["Lunch at O Afonso", "Dinner at Traça"]), day(2, ["B"])];
    const second = edit(2, ["B", "C"]);
    const landing = [{ day: 1, arrives: "23:00" }];
    expect(
      correctionFor({ message: "El primer día llegamos tarde sobre las 23 horas", days: saved }, { reply: "Hecho.", edits: [second], travelTimes: landing }),
    ).toContain("Day 1: they arrive at 23:00, too late for anything but getting to where they stay. Lunch at O Afonso (9:00), Dinner at Traça (11:00) don't fit.");
    expect(correctionFor({ message: "add a market to day 2", days: saved }, { reply: "Done.", edits: [second], travelTimes: landing })).toBeNull();
  });

  it("asks again for an answer that was announced and not given", () => {
    const c = correctionFor({ message: "give hotels", days }, { reply: "I'll suggest a few areas and specific hotels that align well with your itinerary.", edits: [] });
    expect(c).toBeNull();
    expect(correctionFor({ message: "total?", days }, { reply: "Ecco il calcolo completo del costo totale stimato per il tuo viaggio.", edits: [] })).toContain("announced an answer");
  });
});

describe("travel times", () => {
  const planned = (n: number, items: [string, string, number, Record<string, unknown>?][]): DayEdit => ({
    day_number: n,
    summary: "",
    activities: items.map(([name, start, minutes, extra]) => act(name, start, { duration_minutes: minutes, ...extra })),
  });

  it("reads the model's times, keeping days of the trip that have one", () => {
    const raw = [{ day: 5, leaves: "2 PM", by: "Flight" }, { day: 9, arrives: "10:00" }, { day: 1 }, "junk"];
    expect(readTravelTimes(raw, 5)).toEqual([{ day: 5, arrives: undefined, leaves: "14:00", by: "flight" }]);
    expect(readTravelTimes(undefined, 5)).toEqual([]);
  });

  it("finds what a departure day plans after they set off, but not the trip to the airport", () => {
    const lastDay = planned(5, [
      ["Breakfast at Gallery Drip", "08:30", 60],
      ["Bangkok Art and Culture Centre", "09:30", 90],
      ["Transfer to Suvarnabhumi", "11:00", 60, { type: "transport" }],
      ["Lunch at Baan Khanitha", "12:30", 60],
    ]);
    expect(outsideTravelTimes([lastDay], [{ day: 5, leaves: "14:00", by: "flight" }])).toEqual([
      { day: 5, arrives: undefined, leaves: "14:00", from: null, until: "11:00", names: ["Lunch at Baan Khanitha (12:30)"] },
    ]);
  });

  it("leaves a day that lands late to the arrival itself", () => {
    const firstDay = planned(1, [
      ["Arrival in Porto and transfer to the apartment", "23:00", 60],
      ["Lunch at O Afonso", "13:00", 60],
      ["Dinner at Traça", "20:00", 90],
    ]);
    const [out] = outsideTravelTimes([firstDay], [{ day: 1, arrives: "23:00" }]);
    expect(out.names).toEqual(["Lunch at O Afonso (13:00)", "Dinner at Traça (20:00)"]);
  });

  it("gives a train less time than a flight, and leaves days without a time alone", () => {
    const stroll = planned(2, [["Stroll in Ribeira", "16:00", 60]]);
    expect(outsideTravelTimes([stroll], [{ day: 2, arrives: "15:00", by: "train" }])).toEqual([]);
    expect(outsideTravelTimes([stroll], [{ day: 2, arrives: "15:00" }])).toHaveLength(1);
    expect(outsideTravelTimes([stroll], [{ day: 3, leaves: "09:00" }])).toEqual([]);
  });
});

describe("buildPrompt", () => {
  const prompt = buildPrompt({ message: "we have a car", destination: "Lisbon", tripTitle: "Lisbon", days: [day(1, ["A"])], locale: "en" });

  it("asks the model to read what the traveller means before acting", () => {
    expect(prompt).toContain("A statement about their trip asks you to fit the plan to it");
    expect(prompt).toContain('A short "yes", "ok", "do it" or "continue" answers your previous message');
    expect(prompt).toContain("do every one");
    expect(prompt).toContain("make it instead of asking for permission");
  });

  it("holds a limit on distance across the whole plan, on the first answer", () => {
    expect(prompt).toContain("holds for the whole plan, not just the stop it mentions");
    expect(prompt).toContain("Check every stop it touches on your first answer");
  });

  it("moves what a change leaves without room instead of dropping it", () => {
    expect(prompt).toContain("move that activity to another day with room rather than dropping it, and say where it went");
  });

  // "Are you still limiting me to 4 activities a day?": a day capped at five
  // swapped a dinner for the restaurant asked for, and a list of ten got five.
  it("lets a day grow when they add to it, and adds every place of a list", () => {
    expect(prompt).not.toContain("Each edited day: 3-5 activities");
    expect(prompt).toContain("A day you add to keeps every activity it had, so it may end up with more than 5");
    expect(prompt).toContain("A list of places to add");
    expect(prompt).toContain("add every one, each once, on the day and at the time it fits best");
    expect(prompt).toContain("If one can't fit anywhere, say which in \"reply\"");
  });

  it("changes nothing for a message that only says what is coming", () => {
    expect(prompt).toContain("only says what's coming");
    expect(prompt).toContain("say you're ready, repeat the rule in a few words, and return \"edits\": []");
  });

  it("keeps the trip's length and the saved activities' names", () => {
    expect(prompt).toContain("Keep the number of days unless the traveller asks for more or fewer");
    expect(prompt).toContain("never translate or rename activities");
  });

  it("gives the trip's length from its dates, and each day its date", () => {
    const algarve = buildPrompt({ message: "count, it's 8", destination: "Algarve", tripTitle: "Algarve", days: ALGARVE, startDate: "2026-11-28", endDate: "2026-12-06", locale: "en" });
    expect(algarve).toContain("The trip is Sat, 28 Nov 2026 to Sun, 6 Dec 2026: 9 days and 8 nights, Day 1 to Day 9.");
    expect(algarve).toContain("Day 1 (Sat, 28 Nov 2026): Algarve 1");
    expect(algarve).toContain("Day 9 (Sun, 6 Dec 2026): Algarve 9");
    expect(algarve).toContain("Never agree to another count, however sure they are");
    expect(algarve).toContain("Insisting on a count isn't asking to change it");
    expect(buildPrompt({ message: "count, it's 8", destination: "Algarve", tripTitle: "Algarve", days: ALGARVE, locale: "en" })).toContain(
      "The trip is Sat, 28 Nov 2026 to Sun, 6 Dec 2026: 9 days and 8 nights",
    );
    // Days without dates count from the start; with no dates at all, the count alone.
    const undated = ALGARVE.slice(0, 2).map((d) => ({ ...d, date: "" }));
    expect(buildPrompt({ message: "hi", destination: "Algarve", tripTitle: "Algarve", days: undated, startDate: "2026-11-28", locale: "en" })).toContain("Day 2 (Sun, 29 Nov 2026): Algarve 2");
    expect(buildPrompt({ message: "hi", destination: "Algarve", tripTitle: "Algarve", days: undated.slice(0, 1), locale: "en" })).toContain("The trip is 1 day and 0 nights, Day 1 to Day 1.");
  });

  it("shows a fixed plan with its time, to plan the rest of its day around", () => {
    const fixed = { day_number: 1, activities: [act("Old town walk"), act("Flight to Porto", "17:30", { locked: true })] } as unknown as ItineraryDay;
    const withFixed = buildPrompt({ message: "add lunch", destination: "Lisbon", tripTitle: "Lisbon", days: [fixed], locale: "en" });
    expect(withFixed).toContain("Day 1: Old town walk, Flight to Porto [fixed plan, 17:30]");
    expect(withFixed).toContain("An activity marked [fixed plan] is the traveller's own booking");
    expect(withFixed).toContain("You can't move, change or remove one: if they ask to, say they can change it themselves in the plan");
  });

  it("knows a change asked for again after Undo isn't in the plan", () => {
    const again = buildPrompt({
      message: "mi esposa es vegetariana",
      destination: "Medellín",
      tripTitle: "Medellín",
      days: [day(1, ["A"])],
      locale: "en",
      history: [
        { role: "user", text: "mi esposa es vegetariana" },
        { role: "assistant", text: "¡Entendido! He ajustado el plan." },
      ],
    });
    expect(again).toContain("isn't in it was only offered, skipped or undone: if they ask for it, make it");
  });

  it("knows which part of the plan is a change still waiting to be saved, and how to undo it", () => {
    expect(prompt).not.toContain("Not saved yet");
    const waiting = buildPrompt({
      message: "add the others too",
      destination: "Curitiba",
      tripTitle: "Curitiba",
      days: [day(1, ["A", "Madalosso"])],
      locale: "pt",
      unsaved: ["Day 1: adds Madalosso"],
    });
    expect(waiting).toContain("Not saved yet: your last reply prepared this change, the traveller hasn't saved it, and the itinerary above already includes it. Saving your reply saves it too.\n- Day 1: adds Madalosso\n");
    expect(waiting).toContain("If they turn it down, undo it in your edits: take out what it added and put back what it took out.");
  });

  it("suggests hotels instead of asking for their names", () => {
    expect(prompt).toContain("Asked where to stay or for hotels: suggest 2-3 concrete areas or well-known hotels");
  });
});
