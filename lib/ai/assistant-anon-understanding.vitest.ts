/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import type { ItineraryDay } from "@/types";
import {
  asksForMoreDays,
  buildPrompt,
  composeReply,
  correctionFor,
  keepSavedActivities,
  outsideTravelTimes,
  readTravelTimes,
  takenOut,
  type DayEdit,
} from "./assistant-anon";
import { asksToRemove, replyLanguage } from "./assistant/honesty";

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

  // Live, 2026-10-31: "add the missing meals" turned a lunch in the Ribeira
  // into a second "Ribeira walk", and the lunch was gone.
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
    expect(composeReply({ ...base, reply: "Swapped the Guinness Storehouse for Jameson.", takenOut: ["Guinness Storehouse"] })).toBe(
      "Swapped the Guinness Storehouse for Jameson."
    );
    expect(asksToRemove("take out all restaurants")).toBe(true);
    expect(asksToRemove("quita todos los restaurantes")).toBe(true);
    expect(asksToRemove("add a Jameson whiskey distillery tour")).toBe(false);
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

describe("asksForMoreDays", () => {
  it.each([
    "add 2 more days",
    "Add 1 more day at the end of the trip and set trip_length to 8",
    "can we extend the trip by one night",
    "agrega un día más",
    "aggiungi 2 giorni in più",
    "mais um dia em Lisboa",
    "make it 9 days",
  ])("hears a request for more days: %s", (text) => {
    expect(asksForMoreDays(text)).toBe(true);
  });

  it.each(["add hakone", "include Cascais and Óbidos", "agrega otra excursión de un día", "add a day trip to Sintra"])(
    "hears none in: %s",
    (text) => {
      expect(asksForMoreDays(text)).toBe(false);
    }
  );
});

describe("correctionFor", () => {
  const days = [day(1, ["A"]), day(2, ["B"]), day(3, ["C"]), day(4, ["D"]), day(5, ["E"])];

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
    expect(correctionFor({ message: "add one more day for Óbidos", days }, longer)).toBeNull();
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

  // Live, 2026-10-29: a 14:00 flight home, and the last day kept lunch at
  // 12:30 and shopping after it; the traveller had to ask three turns later.
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

  it("moves what a change leaves without room instead of dropping it", () => {
    expect(prompt).toContain("move that activity to another day with room rather than dropping it, and say where it went");
  });

  it("keeps the trip's length and the saved activities' names", () => {
    expect(prompt).toContain("Keep the number of days unless the traveller asks for more or fewer");
    expect(prompt).toContain("never translate or rename activities");
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

  it("suggests hotels instead of asking for their names", () => {
    expect(prompt).toContain("Asked where to stay or for hotels: suggest 2-3 concrete areas or well-known hotels");
  });
});
