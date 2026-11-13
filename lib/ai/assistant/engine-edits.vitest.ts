/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import type { ItineraryDay } from "@/types";
import { buildPrompt } from "./edit-prompt";
import { composeReply } from "./edit-reply";
import { SHORTEST_STOP_MINUTES, plainText, validateEdits } from "./edit-validation";
import { asksForFreeDay } from "./message-asks";

/**
 * The wizard assistant can change several days and the trip's length in one
 * reply, and says only what it prepared. Real-world cases:
 * a swap came back as one day with a reply claiming both; "add one more day"
 * could not be done; a claim was made with nothing prepared.
 */

const act = (name: string) => ({ name, time_slot: "morning", start_time: "10:00" });
const day = (n: number, extra: Partial<ItineraryDay> = {}) =>
  ({ day_number: n, date: `2027-11-${String(10 + n).padStart(2, "0")}`, activities: [act(`Day ${n} thing`)], ...extra }) as unknown as ItineraryDay;
const trip = () => [day(1), day(2), day(3), day(4), day(5)];
const edit = (n: number, names = ["A", "B"], extra: Record<string, unknown> = {}) => ({
  day_number: n,
  summary: `Day ${n} updated`,
  activities: names.map(act),
  ...extra,
});

describe("validateEdits", () => {
  it("keeps where a new stop is when it's a real point near the trip", () => {
    const kyoto = [day(1, { activities: [{ ...act("Fushimi Inari-taisha"), coordinates: { lat: 34.967146, lng: 135.772675 } }] as never })];
    const located = (coordinates: unknown) => ({ ...act("Stop"), coordinates });
    const out = validateEdits(
      kyoto,
      {
        edits: [
          {
            day_number: 1,
            activities: [
              located({ lat: 34.994856, lng: 135.78505 }),
              located({ lat: 48.85837, lng: 2.294481 }),
              located({ lat: 48.003, lng: 10.004 }),
              act("Gion"),
            ],
          },
        ],
        tripLength: null,
      },
      "JPY"
    );
    expect(out.edits[0].activities.map((a) => a.coordinates)).toEqual([{ lat: 34.994856, lng: 135.78505 }, undefined, undefined, undefined]);
  });

  it("keeps the short visits asked for, and names a stop set to the shortest a stop can be", () => {
    // A London walk: "Broadwick Street 5 min, Neal's Yard 10 min, Conduit Court Passage 1 min".
    const timed = (name: string, duration_minutes: number) => ({ ...act(name), duration_minutes });
    const out = validateEdits(
      trip(),
      {
        edits: [
          {
            day_number: 1,
            activities: [timed("Broadwick Street", 5), timed("Neal's Yard", 10), timed("Conduit Court Passage", 1), act("Covent Garden")],
          },
        ],
        tripLength: null,
      },
      "GBP"
    );
    expect(out.edits[0].activities.map((a) => a.duration_minutes)).toEqual([5, 10, SHORTEST_STOP_MINUTES, 90]);
    expect(SHORTEST_STOP_MINUTES).toBe(5);
    expect(out.shortest).toEqual(["Conduit Court Passage"]);
    expect(validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").shortest).toEqual([]);
    // A day the change doesn't keep (a sixth day of a five-day trip that stays five) names nothing.
    const sixth = validateEdits(trip(), { edits: [{ day_number: 6, activities: [timed("Conduit Court Passage", 1)] }], tripLength: null }, "GBP");
    expect(sixth.edits).toEqual([]);
    expect(sixth.shortest).toEqual([]);
  });

  it("keeps every day of a swap, in day order", () => {
    const out = validateEdits(trip(), { edits: [edit(5), edit(2)], tripLength: null }, "EUR");
    expect(out.edits.map((e) => e.day_number)).toEqual([2, 5]);
    expect(out.tripLength).toBeUndefined();
  });

  it("adds a day only when the new day comes back in full", () => {
    expect(validateEdits(trip(), { edits: [edit(6)], tripLength: 6 }, "EUR")).toMatchObject({ tripLength: 6, lengthRefused: false });
    const refused = validateEdits(trip(), { edits: [edit(3)], tripLength: 6 }, "EUR");
    expect(refused.tripLength).toBeUndefined();
    expect(refused.lengthRefused).toBe(true);
    expect(refused.edits.map((e) => e.day_number)).toEqual([3]);
    // Wanting more days is kept either way, so a half-made move can be told apart.
    expect(refused.wantsMore).toBe(true);
    expect(validateEdits(trip(), { edits: [edit(6)], tripLength: 6 }, "EUR").wantsMore).toBe(true);
    expect(validateEdits(trip(), { edits: [edit(3)], tripLength: 5 }, "EUR").wantsMore).toBe(false);
    expect(validateEdits(trip(), { edits: [], tripLength: 4 }, "EUR").wantsMore).toBe(false);
  });

  it("says when a reply wants more days than a trip may have, and adds none", () => {
    const fourteen = Array.from({ length: 14 }, (_, i) => day(i + 1));
    const over = validateEdits(fourteen, { edits: [edit(15)], tripLength: 15 }, "EUR");
    expect(over).toMatchObject({ overCap: true, lengthRefused: false });
    expect(over.tripLength).toBeUndefined();
    expect(over.edits).toEqual([]);
    // Up to the cap is fine, and so is a trip through several cities up to its own.
    expect(validateEdits(fourteen.slice(0, 13), { edits: [edit(14)], tripLength: 14 }, "EUR")).toMatchObject({ tripLength: 14, overCap: false });
    const cities = fourteen.map((d) => ({ ...d, city: "Dublin" }));
    expect(validateEdits(cities, { edits: [edit(15)], tripLength: 15 }, "EUR")).toMatchObject({ tripLength: 15, overCap: false });
    // A trip already past the cap may keep its length.
    expect(validateEdits(Array.from({ length: 16 }, (_, i) => day(i + 1)), { edits: [edit(3)], tripLength: 16 }, "EUR").overCap).toBe(false);
  });

  it("says when a reply wants more days than a trip may have, and adds none", () => {
    const fourteen = Array.from({ length: 14 }, (_, i) => day(i + 1));
    const over = validateEdits(fourteen, { edits: [edit(15)], tripLength: 15 }, "EUR");
    expect(over).toMatchObject({ overCap: true, lengthRefused: false });
    expect(over.tripLength).toBeUndefined();
    expect(over.edits).toEqual([]);
    // Up to the cap is fine, and so is a trip through several cities up to its own.
    expect(validateEdits(fourteen.slice(0, 13), { edits: [edit(14)], tripLength: 14 }, "EUR")).toMatchObject({ tripLength: 14, overCap: false });
    const cities = fourteen.map((d) => ({ ...d, city: "Dublin" }));
    expect(validateEdits(cities, { edits: [edit(15)], tripLength: 15 }, "EUR")).toMatchObject({ tripLength: 15, overCap: false });
    // A trip already past the cap may keep its length.
    expect(validateEdits(Array.from({ length: 16 }, (_, i) => day(i + 1)), { edits: [edit(3)], tripLength: 16 }, "EUR").overCap).toBe(false);
  });

  it("counts a longer trip whose other new days come in the next parts", () => {
    const out = validateEdits(trip(), { edits: [edit(6)], tripLength: 8, moreDays: [7, 8] }, "EUR");
    expect(out).toMatchObject({ tripLength: 8, lengthRefused: false });
    expect(out.edits.map((e) => e.day_number)).toEqual([6]);
    expect(validateEdits(trip(), { edits: [edit(6)], tripLength: 8, moreDays: [7] }, "EUR").lengthRefused).toBe(true);
  });

  it("shortens the trip, but never by dropping a day with a fixed plan", () => {
    expect(validateEdits(trip(), { edits: [], tripLength: 4 }, "EUR").tripLength).toBe(4);
    const locked = [...trip().slice(0, 4), day(5, { activities: [{ ...act("Wedding"), locked: true }] as never })];
    const out = validateEdits(locked, { edits: [], tripLength: 4 }, "EUR");
    expect(out.tripLength).toBeUndefined();
    expect(out.lengthRefused).toBe(true);
  });

  // A day holding a fixed plan was refused whole: "add a museum before my flight" changed nothing.
  describe("on a day with a fixed plan", () => {
    const flight = { id: "anchor-f1", anchor_id: "f1", name: "Flight to Lisbon", time_slot: "afternoon", start_time: "15:00", duration_minutes: 120, locked: true };
    const withFlight = () => [day(1), day(2, { activities: [act("Morning market"), flight] as never }), day(3)];
    const at = (name: string, start_time: string) => ({ name, start_time });
    const onDay = (n: number, activities: unknown[], allowEmpty = false) =>
      validateEdits(withFlight(), { edits: [{ day_number: n, activities }], tripLength: null }, "EUR", allowEmpty);
    const shown = (out: ReturnType<typeof validateEdits>) => out.edits.map((e) => e.activities.map((a) => `${a.name} ${a.start_time}`));

    it("changes the rest of the day, with the fixed plan as stored", () => {
      const out = onDay(2, [at("Tile museum", "10:00"), at("Flight to Lisbon", "15:00")]);
      expect(shown(out)).toEqual([["Tile museum 10:00", "Flight to Lisbon 15:00"]]);
      expect(out.edits[0].activities[1]).toBe(flight);
      expect(out.lockedDays).toEqual([]);
    });

    it("takes a reworded copy for the fixed plan, in its place", () => {
      const out = onDay(2, [at("Tile museum", "10:00"), at("Lisbon flight", "15:00"), at("Dinner in Alfama", "20:00")]);
      expect(shown(out)).toEqual([["Tile museum 10:00", "Flight to Lisbon 15:00", "Dinner in Alfama 20:00"]]);
      expect(out.lockedDays).toEqual([]);
    });

    it("puts back a fixed plan the reply took out, at its time, and names it", () => {
      const out = onDay(2, [at("Tile museum", "10:00"), at("Sunset cruise", "18:00")]);
      expect(shown(out)).toEqual([["Tile museum 10:00", "Flight to Lisbon 15:00", "Sunset cruise 18:00"]]);
      expect(out.lockedDays).toEqual([{ dayNumber: 2, names: ["Flight to Lisbon"] }]);
      // A day they want free keeps it too.
      expect(shown(onDay(2, [], true))).toEqual([["Flight to Lisbon 15:00"]]);
    });

    it("keeps a fixed plan at its time when the reply moves it", () => {
      const out = onDay(2, [at("Flight to Lisbon", "09:00"), at("Tile museum", "10:00"), at("Fado dinner", "21:00")]);
      expect(shown(out)).toEqual([["Tile museum 10:00", "Flight to Lisbon 15:00", "Fado dinner 21:00"]]);
      expect(out.lockedDays).toEqual([{ dayNumber: 2, names: ["Flight to Lisbon"] }]);
    });

    it("drops a copy of a fixed plan on another day, and a second copy on its own", () => {
      const out = onDay(3, [at("Beach", "10:00"), at("Flight to Lisbon", "15:00")]);
      expect(shown(out)).toEqual([["Beach 10:00"]]);
      expect(out.lockedDays).toEqual([{ dayNumber: 2, names: ["Flight to Lisbon"] }]);
      expect(shown(onDay(2, [at("Flight to Lisbon", "15:00"), at("Flight to Lisbon", "15:00")]))).toEqual([["Flight to Lisbon 15:00"]]);
    });

    it("leaves days without fixed plans as the reply has them", () => {
      const out = validateEdits(trip(), { edits: [{ day_number: 2, activities: [at("Flight to Lisbon", "09:00")] }], tripLength: null }, "EUR");
      expect(shown(out)).toEqual([["Flight to Lisbon 09:00"]]);
      expect(out.lockedDays).toEqual([]);
    });
  });

  it("drops edits outside the trip, with no activities, or with a bad day", () => {
    const out = validateEdits(trip(), { edits: [edit(9), edit(0), { day_number: 2, activities: [] }, "junk"], tripLength: null }, "EUR");
    expect(out.edits).toEqual([]);
  });

  it("keeps the city a multi-city edit gives", () => {
    const out = validateEdits(trip(), { edits: [edit(3, ["Quilotoa"], { city: "Baños" })], tripLength: null }, "USD");
    expect(out.edits[0].city).toBe("Baños");
  });

  it("reaches every day of a multi-city trip longer than the single-city cap", () => {
    const cities = ["Xi'an", "Chongqing", "Chengdu"];
    const long = Array.from({ length: 19 }, (_, i) => day(i + 1, { city: cities[Math.floor(i / 7)] }));
    const out = validateEdits(long, { edits: [edit(15), edit(19)], tripLength: null }, "CNY");
    expect(out.edits.map((e) => e.day_number)).toEqual([15, 19]);
    expect(validateEdits(long, { edits: [edit(20), edit(21)], tripLength: 21 }, "CNY").tripLength).toBe(21);
    expect(validateEdits(long, { edits: [edit(20), edit(21), edit(22)], tripLength: 22 }, "CNY").tripLength).toBeUndefined();
    // A single-city trip keeps its own cap.
    expect(validateEdits(trip(), { edits: [edit(15)], tripLength: 15 }, "EUR").tripLength).toBeUndefined();
  });
});

describe("composeReply", () => {
  const base = { lockedDays: [], lengthRefused: false, locale: "en", currentDays: 5 };

  it("a claim with nothing prepared becomes an honest reply", () => {
    const text = composeReply({ ...base, reply: "I've swapped the Northern Lights Chase to Day 5 and Orca Watching to Day 2 for you.", edits: [] });
    expect(text).toMatch(/^I haven't changed your plan/);
  });

  it("a day said to be left blank, with nothing prepared, becomes an honest reply", () => {
    const text = composeReply({ ...base, reply: "I've left Day 1 blank so you can rest after your night flight.", edits: [] });
    expect(text).toMatch(/^I haven't changed your plan/);
  });

  it("a promise with nothing prepared becomes an honest reply", () => {
    const text = composeReply({ ...base, reply: "I'll move the Vatican to Day 2 for you.", edits: [] });
    expect(text).toMatch(/^I haven't changed your plan/);
  });

  it("a proposal handed over with nothing prepared becomes an honest reply", () => {
    const text = composeReply({ ...base, locale: "it", reply: "Ecco la proposta per rimuovere Restaurace Mlejnice dal Giorno 2.", edits: [] });
    expect(text).toMatch(/^Non ho modificato il tuo piano/);
    // With the change prepared, the same words are true.
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    expect(composeReply({ ...base, reply: "Here's the proposal for Day 2.", edits: [d2] })).toBe("Here's the proposal for Day 2.");
  });

  it("names the stops set to the shortest a stop can be, in the reply's language", () => {
    const [d1] = validateEdits(trip(), { edits: [edit(1)], tripLength: null }, "EUR").edits;
    expect(composeReply({ ...base, reply: "Here's Day 1 with your short stops.", edits: [d1], shortest: ["Conduit Court Passage"] })).toBe(
      "Here's Day 1 with your short stops. Conduit Court Passage: set to 5 min, the shortest a stop can be."
    );
    expect(composeReply({ ...base, locale: "it", reply: "Ecco il Giorno 1.", edits: [d1], shortest: ["Conduit Court Passage"] })).toContain(
      "Conduit Court Passage: 5 min"
    );
    expect(composeReply({ ...base, reply: "Here's Day 1.", edits: [d1], shortest: [] })).toBe("Here's Day 1.");
  });

  it("asks for a day the reply names that the change leaves out", () => {
    const [d1] = validateEdits(trip(), { edits: [edit(1)], tripLength: null }, "EUR").edits;
    expect(composeReply({ ...base, reply: "Here's Day 1, and Day 3 gets the museum.", edits: [d1] })).toBe(
      "Here's Day 1, and Day 3 gets the museum. (This change covers Day 1 only. Ask me for Day 3 if you want that changed too.)"
    );
  });

  it("asks for no day the trip doesn't have", () => {
    const [d1] = validateEdits(trip(), { edits: [edit(1)], tripLength: null }, "EUR").edits;
    const reply = "Here's Day 1 with a later start. Day 9 would be after your flight home.";
    expect(composeReply({ ...base, reply, edits: [d1] })).toBe(reply);
  });

  it("reads the traveller's dates as dates, not as days to ask for", () => {
    // A 14-day Lisbon and Porto trip, told its route with dates.
    const [d1] = validateEdits(trip(), { edits: [edit(1)], tripLength: null }, "EUR").edits;
    const reply =
      "Chegada a Lisboa no dia 10/03 às 23:00. Partida para o Porto no dia 13/03 às 09:00. " +
      "Retorno a Lisboa no dia 18/03 às 15:00 e partida para casa no dia 24/03 às 23:00. Atualizei os horários.";
    expect(composeReply({ ...base, locale: "pt", currentDays: 14, reply, edits: [d1], autoApplied: true })).toBe(reply);
  });

  it("an answer with nothing prepared stays as it is", () => {
    const reply = "Tromsø's aurora season runs from September to March.";
    expect(composeReply({ ...base, reply, edits: [] })).toBe(reply);
  });

  it("a currency request drops the model's currency claims and says what the page did", () => {
    const claimed = "The budget estimates are already in Euros, as requested in our previous conversation. All costs listed are in EUR.";
    expect(composeReply({ ...base, reply: claimed, edits: [], currency: "EUR" })).toBe("Done: prices now show in EUR.");
    const mixed = "Day 2 looks balanced. Prices will be shown in euros.";
    expect(composeReply({ ...base, reply: mixed, edits: [], currency: "EUR" })).toBe("Day 2 looks balanced. Done: prices now show in EUR.");
  });

  it("a currency request next to a day edit keeps the edit's reply and adds the switch", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    const text = composeReply({ ...base, reply: "Here's a Colmar day trip for day 2.", edits: [d2], currency: "EUR" });
    expect(text).toBe("Here's a Colmar day trip for day 2. Done: prices now show in EUR.");
  });

  it("a 'swap' that prepared one side says the other side is missing", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    const text = composeReply({
      ...base,
      reply: "No problem at all! I've swapped the Northern Lights Chase to Day 5 and Orca Watching to Day 2 for you.",
      edits: [d2],
    });
    expect(text).toContain("covers Day 2 only. Ask me for Day 5");
  });

  it("a swap that prepared both days needs no note", () => {
    const { edits } = validateEdits(trip(), { edits: [edit(2), edit(5)], tripLength: null }, "EUR");
    const text = composeReply({ ...base, reply: "Here's Orca Watching on Day 2 and the Northern Lights on Day 5.", edits });
    expect(text).not.toContain("covers Day");
  });

  it("says when the trip length could not change", () => {
    const { edits } = validateEdits(trip(), { edits: [edit(3)], tripLength: 6 }, "EUR");
    const text = composeReply({ ...base, reply: "Here's Day 3, and I added a sixth day.", edits, lengthRefused: true });
    expect(text).toContain("The trip stays at 5 days");
  });

  it("a removed day may be named without a note", () => {
    const text = composeReply({ ...base, reply: "Day 5 is gone, and your trip now ends on Day 4.", edits: [], tripLength: 4 });
    expect(text).toBe("Day 5 is gone, and your trip now ends on Day 4.");
  });

  it("a change only to a fixed plan says it stays, and where to change it", () => {
    const text = composeReply({ ...base, reply: "I've moved your flight to 18:00.", edits: [], lockedDays: [{ dayNumber: 2, names: ["Flight"] }] });
    expect(text).toBe("Day 2 has a fixed plan you set (Flight), so I left it as it is: you can change it yourself in the plan. I can change anything else on that day.");
  });

  it("a change that moved a fixed plan says it stays as set", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    const text = composeReply({ ...base, reply: "Here's Day 2 with a museum, and the flight later.", edits: [d2], lockedDays: [{ dayNumber: 2, names: ["Flight"] }] });
    expect(text).toBe("Here's Day 2 with a museum, and the flight later. (The fixed plan on Day 2 stays as you set it: Flight.)");
    expect(composeReply({ ...base, reply: "Here's Day 2 with a museum.", edits: [d2] })).toBe("Here's Day 2 with a museum.");
  });

  it("says which places of another city came off a city's days", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    const off = (n: number, names: string[]) => ({ day: n, city: "Seoul", other: "Busan", activities: names.map(act) as never });
    expect(composeReply({ ...base, reply: "Here are your days, grouped by area.", edits: [d2], cityKept: [off(7, ["Gamcheon Culture Village"]), off(8, ["Songdo Cable Car"])] })).toBe(
      "Here are your days, grouped by area. (Busan places stay off Seoul days: Gamcheon Culture Village, Songdo Cable Car.)",
    );
    expect(composeReply({ ...base, locale: "pt", reply: "Aqui estão seus dias.", edits: [d2], cityKept: [off(7, ["Gamcheon"])] })).toBe(
      "Aqui estão seus dias. (Os lugares de Busan ficam fora dos dias de Seoul: Gamcheon.)",
    );
  });

  it("says which places of another city went to days of their own city, unless the reply did", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    const off = (n: number, names: string[]) => ({ day: n, city: "Seoul", other: "Busan", activities: names.map(act) as never });
    const moved = [off(7, ["Songdo Cable Car"]), off(8, ["Haeundae Sky Capsule"])];
    expect(composeReply({ ...base, reply: "Fixed: that day is all Seoul now.", edits: [d2], cityMoved: moved })).toBe(
      "Fixed: that day is all Seoul now. (Moved to Busan days: Songdo Cable Car, Haeundae Sky Capsule.)",
    );
    expect(composeReply({ ...base, reply: "Fixed, and the Songdo Cable Car is with the other Busan sights.", edits: [d2], cityMoved: moved })).toBe(
      "Fixed, and the Songdo Cable Car is with the other Busan sights. (Moved to Busan days: Haeundae Sky Capsule.)",
    );
    expect(composeReply({ ...base, locale: "es", reply: "Listo.", edits: [d2], cityMoved: moved })).toBe("Listo. (Pasan a los días de Busan: Songdo Cable Car, Haeundae Sky Capsule.)");
    expect(composeReply({ ...base, locale: "it", reply: "Fatto.", edits: [d2], cityMoved: [moved[0]] })).toBe("Fatto. (Passa ai giorni di Busan: Songdo Cable Car.)");
  });

  it("says a place the reply names isn't repeated on a day, and which day keeps it", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    const notRepeated = [
      { name: "N Seoul Tower", day: 3 },
      { name: "Lotte World Tower", day: 4 },
    ];
    expect(composeReply({ ...base, reply: "That day now has N Seoul Tower and Myeongdong.", edits: [d2], notRepeated })).toBe(
      "That day now has N Seoul Tower and Myeongdong. (Already on Day 3, so not added again: N Seoul Tower.)",
    );
    expect(composeReply({ ...base, reply: "Done: new places for that day.", edits: [d2], notRepeated })).toBe("Done: new places for that day.");
    expect(composeReply({ ...base, locale: "es", reply: "Listo: N Seoul Tower y Lotte World Tower.", edits: [d2], notRepeated })).toBe(
      "Listo: N Seoul Tower y Lotte World Tower. (Ya está en el día 3, así que no se añade otra vez: N Seoul Tower.) (Ya está en el día 4, así que no se añade otra vez: Lotte World Tower.)",
    );
    const bothOn3 = notRepeated.map((x) => ({ ...x, day: 3 }));
    expect(composeReply({ ...base, locale: "it", reply: "Fatto: N Seoul Tower e Lotte World Tower.", edits: [d2], notRepeated: bothOn3 })).toBe(
      "Fatto: N Seoul Tower e Lotte World Tower. (Sono già nel giorno 3, quindi non si aggiungono di nuovo: N Seoul Tower, Lotte World Tower.)",
    );
  });

  it("says where a place of their list already is, named in the reply or not, unless the reply says it", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    const listedHeld = [{ name: "Chinatown London", day: 4 }];
    expect(composeReply({ ...base, reply: "Day 2 has all your stops.", edits: [d2], listedHeld })).toBe(
      "Day 2 has all your stops. (Already on Day 4, so not added again: Chinatown London.)",
    );
    expect(composeReply({ ...base, locale: "pt", reply: "O dia 2 tem todas as suas paradas.", edits: [d2], listedHeld })).toBe(
      "O dia 2 tem todas as suas paradas. (Já está no dia 4, então não foi adicionado de novo: Chinatown London.)",
    );
    // The same place twice (two parts placed it) is named once.
    expect(composeReply({ ...base, reply: "Day 2 has all your stops.", edits: [d2], listedHeld: [...listedHeld, ...listedHeld] })).toBe(
      "Day 2 has all your stops. (Already on Day 4, so not added again: Chinatown London.)",
    );
    // A reply that names the place and the day that has it already says it.
    expect(composeReply({ ...base, reply: "Chinatown stays on Day 4.", edits: [d2], listedHeld })).not.toContain("not added again");
    // Several days, in day order.
    expect(composeReply({ ...base, reply: "Day 2 has Gion and all your stops.", edits: [d2], notRepeated: [{ name: "Gion", day: 5 }], listedHeld })).toBe(
      "Day 2 has Gion and all your stops. (Already on Day 4, so not added again: Chinatown London.) (Already on Day 5, so not added again: Gion.)",
    );
    // Naming the day alone isn't saying where the place is.
    expect(composeReply({ ...base, reply: "Day 2 has all your stops, and Day 4 too.", edits: [d2], listedHeld })).toContain(
      "(Already on Day 4, so not added again: Chinatown London.)",
    );
  });

  it("gives the count from the dates when the reply gives another", () => {
    const span = { from: "2026-11-28", to: "2026-12-06", days: 9 };
    const agreed = "You're totally right! From November 28 to December 6 is indeed 8 days total.";
    expect(composeReply({ ...base, currentDays: 9, reply: agreed, edits: [], dayCount: span })).toBe(
      "November 28 to December 6 is 9 days and 8 nights, so the trip keeps all 9 days. To make it shorter, tell me which day to take out.",
    );
    expect(composeReply({ ...base, locale: "es", currentDays: 9, reply: "¡Tienes razón! Son 8 días.", edits: [], dayCount: span })).toBe(
      "Del 28 de noviembre al 6 de diciembre son 9 días y 8 noches, así que el viaje mantiene sus 9 días. Para acortarlo, dime qué día quitar.",
    );
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    expect(composeReply({ ...base, currentDays: 9, reply: "Here's Day 2, the beach day of your 8 days.", edits: [d2], dayCount: span })).toBe(
      "Here's Day 2, the beach day of your 8 days. (November 28 to December 6 is 9 days and 8 nights.)",
    );
  });

  it("answers in the traveller's language", () => {
    expect(composeReply({ ...base, locale: "it", reply: "Ho aggiunto una cena al giorno 7.", edits: [] })).toMatch(/^Non ho modificato il tuo piano/);
  });

  it("says a trip at its longest gets no more days, and what can be done instead", () => {
    const promised = "Aqui está um novo dia 15 em Dublin para você acrescentar ao seu roteiro, pronto para salvar.";
    expect(composeReply({ ...base, locale: "pt", currentDays: 14, reply: promised, edits: [], tripCap: { max: 14, days: 14 } })).toBe(
      "As viagens podem ter no máximo 14 dias, e esta já tem 14, por isso não acrescentei nenhum dia. Também posso encaixar o que você queria nos dias que já tem, no lugar das partes mais leves, ou você pode planejar os dias extras como uma segunda viagem.",
    );
    expect(composeReply({ ...base, currentDays: 12, reply: "Here are 5 new days, ready to save.", edits: [], tripCap: { max: 14, days: 12 } })).toBe(
      "Trips can be at most 14 days, so this one can take 2 more: ask me for up to 2. I can also fit what you wanted into the days you have, in place of their lightest parts, or you can plan the extra days as a second trip.",
    );
    expect(composeReply({ ...base, locale: "it", currentDays: 13, reply: "Ecco 3 giorni in più.", edits: [], tripCap: { max: 14, days: 13 } })).toMatch(
      /^I viaggi possono durare al massimo 14 giorni, quindi a questo se ne può aggiungere ancora uno: chiedimelo\./,
    );
    // A change that stands is the answer, whatever else was asked.
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    expect(composeReply({ ...base, reply: "Here's Day 2 with a market.", edits: [d2], tripCap: { max: 14, days: 5 } })).toBe("Here's Day 2 with a market.");
  });

  // Gemini can answer "Ho aggiunto un sesto giorno…" for an edit still
  // waiting for Apply, despite the prompt.
  it("an edit described as done says it waits for Apply", () => {
    const { edits, tripLength } = validateEdits(trip(), { edits: [edit(6)], tripLength: 6 }, "EUR");
    const text = composeReply({ ...base, locale: "it", reply: "Certo! Ho aggiunto un sesto giorno al tuo itinerario.", edits, tripLength });
    expect(text).toMatch(/^Non ancora applicato: tocca "Applica modifica"/);
  });

  it("an edit presented as ready gets no note", () => {
    const { edits } = validateEdits(trip(), { edits: [edit(3)], tripLength: null }, "EUR");
    const text = composeReply({ ...base, reply: "Here's Day 3 with a slower morning.", edits });
    expect(text).toBe("Here's Day 3 with a slower morning.");
  });

  it("a fixed-plan day is explained in the traveller's language", () => {
    const text = composeReply({ ...base, locale: "es", reply: "He actualizado el día 2.", edits: [], lockedDays: [{ dayNumber: 2, names: ["Vuelo"] }] });
    expect(text).toMatch(/^El día 2 tiene un plan fijo que pusiste tú \(Vuelo\)/);
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    expect(composeReply({ ...base, locale: "pt", reply: "Aqui está o dia 2.", edits: [d2], lockedDays: [{ dayNumber: 2, names: ["Voo"] }] })).toBe(
      "Aqui está o dia 2. (O compromisso fixo do dia 2 fica como você definiu: Voo.)",
    );
  });

  it("an empty reply falls back in the traveller's language", () => {
    expect(composeReply({ ...base, locale: "pt", reply: "", edits: [] })).toMatch(/^Estou aqui para ajudar/);
  });
});

describe("composeReply on a pending edit that claims to be done", () => {
  const base = { lockedDays: [], lengthRefused: false, locale: "en", currentDays: 5 };

  it("opens with the not-applied line, so Apply isn't skipped", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    const text = composeReply({ ...base, reply: "I've updated Day 2 to start at 15:00.", edits: [d2] });
    expect(text).toMatch(/^Not applied yet: tap "Apply change" below/);
    expect(text).toContain("I've updated Day 2 to start at 15:00.");
  });

  it("leaves a reply that already presents the edit as ready alone", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    const text = composeReply({ ...base, reply: "Here's Day 2 starting at 15:00.", edits: [d2] });
    expect(text).toBe("Here's Day 2 starting at 15:00.");
  });
});

describe("composeReply when the page applies edits on arrival", () => {
  const base = { lockedDays: [], lengthRefused: false, locale: "en", currentDays: 5, autoApplied: true };

  it("lets a finished edit say it is done, because it will be", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    expect(composeReply({ ...base, reply: "I've updated Day 2 to start at 15:00.", edits: [d2] })).toBe(
      "I've updated Day 2 to start at 15:00."
    );
  });

  it("still replaces a claim when nothing was prepared", () => {
    expect(composeReply({ ...base, reply: "I've updated Day 2 to start at 15:00.", edits: [] })).toMatch(
      /^I haven't changed your plan/
    );
  });

  it("says when a changed day still runs past a departure", () => {
    const [d5] = validateEdits(trip(), { edits: [edit(5)], tripLength: null }, "EUR").edits;
    const outsideTimes = [{ day: 5, leaves: "14:00", from: null, until: "11:00", names: ["Lunch at Baan Khanitha (12:30)"] }];
    expect(composeReply({ ...base, reply: "Day 5 is set for your flight.", edits: [d5], outsideTimes })).toBe(
      "Day 5 is set for your flight. (Check Day 5: you leave at 14:00, so plans should end by 11:00, and the day still has: Lunch at Baan Khanitha (12:30).)",
    );
  });

  it("names the new days a longer trip didn't get in time", () => {
    const { edits, tripLength } = validateEdits(trip(), { edits: [edit(6), edit(7)], tripLength: 7 }, "EUR");
    const text = composeReply({ ...base, reply: "I've added Days 6 to 8 in Sintra and Cascais.", edits, tripLength, notAdded: [8] });
    expect(text).toBe(`I've added Days 6 to 8 in Sintra and Cascais. (Day 8 isn't added yet: say "continue" and I'll add it.)`);
    const italian = composeReply({ ...base, locale: "it", reply: "Ecco i giorni 6 e 7.", edits, tripLength, notAdded: [8, 9] });
    expect(italian).toContain(`(I giorni 8, 9 non sono ancora aggiunti: scrivi "continua" e li aggiungerò.)`);
  });
});

describe("composeReply on a page that says itself the change waits for its button", () => {
  const base = { lockedDays: [], lengthRefused: false, locale: "en", currentDays: 5, ownLead: true };

  it("adds no lead of its own", () => {
    const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;
    expect(composeReply({ ...base, reply: "I've updated Day 2 to start at 15:00.", edits: [d2] })).toBe(
      "I've updated Day 2 to start at 15:00."
    );
  });
});

describe("buildPrompt", () => {
  // "Suggest a great local restaurant to add" was answered with "which day?",
  // and the plan stayed as it was.
  it("adds to the day with the most room when no day is named, instead of asking", () => {
    const prompt = buildPrompt({ message: "Suggest a great local restaurant to add", destination: "Lisbon", tripTitle: "Lisbon", days: trip(), locale: "en" });
    expect(prompt).toContain("pick the day with the most room where it fits, add it there without removing anything");
    expect(prompt).toContain("Don't ask which day");
  });

  // "Broadwick Street 5 min, Neal's Yard 10 min" came back at 20 and 30 minutes.
  it("keeps the length a traveller gives a stop, down to the shortest a stop can be", () => {
    const prompt = buildPrompt({ message: "Neal's Yard 10 min", destination: "London", tripTitle: "London", days: trip(), locale: "en" });
    expect(prompt).toContain(`A length the traveller gives a stop ("5 min", "an hour") is its "duration_minutes" exactly, never rounded up`);
    expect(prompt).toContain(`the shortest a stop can be is ${SHORTEST_STOP_MINUTES} minutes`);
  });

  // "I am arriving at 6pm on the 28th" on a trip from the 29th: Day 1 was rewritten.
  it("says the trip can't start before Day 1, with its date, and how to start earlier", () => {
    const prompt = buildPrompt({ message: "I am arriving at 6pm on the 28th", destination: "Lisbon", tripTitle: "Lisbon", days: trip(), locale: "en" });
    expect(prompt).toContain("The trip starts on Day 1 (Thu, 11 Nov 2027) and can't start earlier here: if they arrive on an earlier date, change no day for it");
    expect(prompt).toContain("tell them they can change the trip's dates to start that day, which moves every day's plan with it.");
  });

  it("asks where each activity is, so a new stop can be put on the map", () => {
    const prompt = buildPrompt({ message: "add a fado show", destination: "Lisbon", tripTitle: "Lisbon", days: trip(), locale: "en" });
    expect(prompt).toContain('"coordinates": { "lat": <latitude, 6 decimals>, "lng": <longitude, 6 decimals> }');
  });

  it("asks for the plan's words in the trip's language, English when it isn't one of the four", () => {
    const ask = (locale?: string) =>
      buildPrompt({ message: "swap days 1 and 2", destination: "Lisbon", tripTitle: "Lisbon", days: trip(), locale });
    for (const [locale, name] of [["it", "Italian"], ["es", "Spanish"], ["pt", "Portuguese"], ["en", "English"], [undefined, "English"], ["fr", "English"], ["toString", "English"]] as const) {
      expect(ask(locale), String(locale)).toContain(`One concise sentence, in ${name}, describing the change`);
    }
  });

  // A change the page makes at once is told as done, not as "Ready to…".
  it("words a change as done when the page makes it at once, and as ready when it waits for a button", () => {
    const ask = (autoApply?: boolean) =>
      buildPrompt({ message: "swap days 1 and 2", destination: "Lisbon", tripTitle: "Lisbon", days: trip(), locale: "it", autoApply });
    expect(ask(true)).toContain(`quindi di' cosa hai fatto: "Ho aggiunto un corso di cucina al giorno 3"`);
    expect(ask(true)).not.toContain("Nothing changes until the traveller saves it");
    expect(ask(false)).toContain("Nothing changes until the traveller saves it, so presenta le modifiche come pronte da salvare");
    // "I've extended your trip" is a done-claim too.
    expect(ask(false)).toContain(`"Ho esteso"`);
    expect(ask(undefined)).toContain("Nothing changes until the traveller saves it");
  });

  // An editor's new days are dropped, so their ideas must be in the reply.
  it("tells the model when the traveller can't add days, and to give the ideas in the reply", () => {
    const ask = (canAddDays?: boolean) =>
      buildPrompt({ message: "add 2 more days", destination: "Lisbon", tripTitle: "Lisbon", days: trip(), locale: "en", canAddDays });
    expect(ask(false)).toContain(`this traveller isn't the owner: keep "trip_length" null and add no days`);
    expect(ask(false)).toContain(`give your ideas for those days in "reply" instead`);
    expect(ask(false)).not.toContain(`set "trip_length" to the new total`);
    expect(ask(undefined)).toContain(`set "trip_length" to the new total`);
    expect(ask(true)).not.toContain("isn't the owner");
  });

  // A late arrival said early on still shapes Day 1 several messages later.
  it("keeps what the traveller said before the last six turns, in their words only", () => {
    const history = [
      { role: "user" as const, text: "El primer día llegamos tarde sobre las 23 horas" },
      { role: "assistant" as const, text: "He ajustado el primer día para tu llegada." },
      ...Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), text: `turn ${i}` })),
    ];
    const prompt = buildPrompt({ message: "Y las comidas que faltan, organizarlas", destination: "Porto", tripTitle: "Porto", days: trip(), locale: "es", history });
    expect(prompt).toContain("Earlier, the traveller said (oldest first):\n- El primer día llegamos tarde sobre las 23 horas\n");
    expect(prompt).not.toContain("He ajustado el primer día");
    expect(prompt).toContain("Traveller: turn 0");
    expect(prompt).toContain("still holds unless they changed it: when they arrive and leave");
    expect(prompt).toContain('"travel_times" lists every time the traveller has said they arrive or leave');
  });

  it("offers asked-for alternatives as edits that can be applied, and names others to choose from", () => {
    const prompt = buildPrompt({ message: "Suggest alternative activities I could do", destination: "Lisbon", tripTitle: "Lisbon", days: trip(), locale: "en" });
    expect(prompt).toContain("put your best picks into the plan as edits");
    expect(prompt).toContain("name one or two other good options they can ask for instead");
    expect(prompt).toContain("If they want to choose first");
  });
});

describe("questions about money", () => {
  // Asked for "il gran totale", the assistant can answer "Ecco il calcolo…"
  // and never give a number when replies are held to 1-2 sentences and it has
  // no figures to quote.
  const priced = (n: number, amount: number) =>
    ({ day_number: n, activities: [{ name: `Day ${n} thing`, estimated_cost: { amount, currency: "USD", tier: "moderate" } }] }) as unknown as ItineraryDay;
  const plan = [priced(1, 100), priced(2, 50)];

  it("gives the model the plan's costs as the traveller sees them", () => {
    const prompt = buildPrompt({ message: "Qual è il gran totale", destination: "Lisbon", tripTitle: "Lisbon", days: plan, locale: "it", display: { currency: "EUR", rate: 0.9 } });
    expect(prompt).toContain("Activity costs, as the traveller sees them in EUR: Day 1 ~90, Day 2 ~45. Total ~135 EUR (150 USD in the plan's own amounts).");
    expect(prompt).toContain("These count only what the plan lists: hotels, and any travel it doesn't list, cost extra.");
  });

  it("asks for the figures in the answer itself, in that currency", () => {
    const prompt = buildPrompt({ message: "What's the total?", destination: "Lisbon", tripTitle: "Lisbon", days: plan, locale: "en", display: { currency: "EUR", rate: 0.9 } });
    expect(prompt).toContain("give the numbers right there, in EUR");
    expect(prompt).toContain('Never announce an answer ("here is the total…") without giving it.');
    // Edits keep the plan's own currency.
    expect(prompt).toContain('"currency": "USD"');
  });

  it("quotes the plan's own currency when the page shows it", () => {
    const prompt = buildPrompt({ message: "What's the total?", destination: "Lisbon", tripTitle: "Lisbon", days: plan, locale: "en" });
    expect(prompt).toContain("Activity costs, as the traveller sees them in USD: Day 1 ~100, Day 2 ~50. Total ~150 USD.");
    expect(prompt).toContain("give the numbers right there, in USD");
  });

  it("replaces an announced total that never came with the plan's own figures", () => {
    const base = { lockedDays: [], lengthRefused: false, locale: "it", currentDays: 2, edits: [] };
    const costs = { currency: "USD", perDay: [], total: 150, shown: { currency: "EUR", perDay: [], total: 135 } };
    const text = composeReply({ ...base, reply: "Mi scuso ancora per l'inconveniente! Ecco il calcolo completo del costo totale stimato per il tuo viaggio.", costs });
    expect(text).toBe("Le attività del tuo piano costano in tutto circa 135 EUR. Hotel e voli non sono nel piano, quindi aggiungili a parte.");
  });

  it("keeps an answer that gives its figures", () => {
    const reply = "Le attività costano circa 135 EUR; con gli ostelli (8 notti a 20-50 EUR) e i voli (800-1.200 EUR) il viaggio è sui 1.100-1.735 EUR.";
    expect(composeReply({ lockedDays: [], lengthRefused: false, locale: "it", currentDays: 2, edits: [], reply })).toBe(reply);
  });
});

describe("plainText", () => {
  it("keeps a breakdown readable in a plain-text bubble", () => {
    // The model's own formatting in a live run.
    const md = [
      "Ecco una stima:",
      "",
      "*   **Costo attività:** circa 489 EUR",
      "*   **Voli:** circa 800-1200 EUR",
      "",
      "**Gran totale stimato:** circa 1449-2089 EUR",
    ].join("\n");
    expect(plainText(md)).toBe(
      [
        "Ecco una stima:",
        "",
        "- Costo attività: circa 489 EUR",
        "- Voli: circa 800-1200 EUR",
        "",
        "Gran totale stimato: circa 1449-2089 EUR",
      ].join("\n")
    );
  });

  it("leaves plain replies alone", () => {
    const reply = "Day 2 now starts at 10:00 - a slower morning.";
    expect(plainText(reply)).toBe(reply);
  });
});

describe("composeReply: what a change said and didn't do", () => {
  const base = { lockedDays: [], lengthRefused: false, locale: "en", currentDays: 5, autoApplied: true };
  const [d2] = validateEdits(trip(), { edits: [edit(2)], tripLength: null }, "EUR").edits;

  it("names the days a change in parts didn't reach", () => {
    const text = composeReply({ ...base, reply: "Every day is gluten-free now.", edits: [d2], daysLeft: [4, 5] });
    expect(text).toBe(`Every day is gluten-free now. (Days 4, 5 aren't changed yet: say "continue" and I'll do the same there.)`);
  });

  it("gives the figures a change's reply announced, from the plan as changed", () => {
    const costsAfter = { currency: "EUR", perDay: [], total: 640 };
    const text = composeReply({ ...base, reply: "Here's how the revised costs look for your trip:", edits: [d2], costsAfter });
    expect(text).toBe("The activities in your plan come to about 640 EUR. Hotels and flights aren't in the plan, so add those on top.");
  });

  it("lists what each day now does when a change's reply ends on a colon", () => {
    expect(composeReply({ ...base, reply: "Done! Here are the updates:", edits: [d2] })).toBe("Done!\n- Day 2: Day 2 updated");
  });

  it("keeps the figures that came before a closing announcement, with nothing prepared", () => {
    expect(composeReply({ ...base, reply: "Day 1 costs about 120 EUR. Here's the breakdown:", edits: [] })).toBe("Day 1 costs about 120 EUR.");
  });

  it("says a day called free wasn't freed when nothing was prepared", () => {
    const reply = "Com certeza! O dia 22 de dezembro e o dia 2 de janeiro estão agora livres para você aproveitar como preferir. Aqui estão as atualizações:";
    expect(composeReply({ ...base, locale: "pt", reply, edits: [] })).toMatch(/^Não alterei o seu plano/);
  });

  it("says the trip keeps its length when the reply claims a longer one", () => {
    const text = composeReply({ ...base, locale: "es", reply: "Esto extiende el viaje un día más.", edits: [d2], askedForMoreDays: true });
    expect(text).toContain("El viaje sigue teniendo 5 días");
    // Not when nobody asked for a longer trip.
    expect(composeReply({ ...base, reply: "I've added an extra day of beaches.", edits: [d2] })).not.toContain("stays at");
  });

  it("says the trip keeps its length when the reply gives it more days than the change does", () => {
    // Asked for cities with their dates, not for "more days".
    const reply = "I've updated your trip to have 16 days, starting in Paris and ending in Budapest.";
    expect(composeReply({ ...base, reply, edits: [d2] })).toContain("The trip stays at 5 days");
    // The days it really has, or fewer, need no note.
    expect(composeReply({ ...base, reply: "Here's Day 2 of your 5-day trip.", edits: [d2] })).not.toContain("stays at");
    expect(composeReply({ ...base, reply: "Day 2 now opens your 3-day stay in Paris.", edits: [d2] })).not.toContain("stays at");
    // A change that does make the trip longer.
    const longer = validateEdits(trip(), { edits: [edit(2), edit(6)], tripLength: 6 }, "EUR");
    expect(longer.tripLength).toBe(6);
    expect(composeReply({ ...base, reply: "Your trip now has 6 days.", edits: longer.edits, tripLength: longer.tripLength })).not.toContain("stays at");
  });

  it("drops 'already in EUR' next to an edit, and keeps the change's prices", () => {
    const reply = "I've moved the Alcazaba to Day 2. Lunch there is about 25 EUR. The plan already shows costs in EUR, so no change was needed.";
    expect(composeReply({ ...base, reply, edits: [d2], currency: "EUR" })).toBe(
      "I've moved the Alcazaba to Day 2. Lunch there is about 25 EUR. Done: prices now show in EUR."
    );
  });
});

describe("a free day", () => {
  it("is asked for in each language", () => {
    expect(asksForFreeDay("deixe o dia 22 e o dia 2 livres")).toBe(true);
    expect(asksForFreeDay("leave day 3 free")).toBe(true);
    expect(asksForFreeDay("lascia libero il giorno 2")).toBe(true);
    expect(asksForFreeDay("quiero el día 4 libre")).toBe(true);
    expect(asksForFreeDay("add a cooking class on day 3")).toBe(false);
  });

  // "For Day 1 leave it blank, my flight lands at midnight": the model emptied
  // Day 1, the empty day was dropped, and the reply said it was done.
  it("is asked for as a blank day too", () => {
    expect(asksForFreeDay("For Day 1 leave it blank, my flight lands at midnight.")).toBe(true);
    expect(asksForFreeDay("deja el día 1 en blanco")).toBe(true);
    expect(asksForFreeDay("lascia il giorno 1 in bianco")).toBe(true);
    expect(asksForFreeDay("deixe o dia 1 em branco")).toBe(true);
    expect(asksForFreeDay("fill in the blanks on day 2 with museums")).toBe(false);
  });

  it("empties a day only when the traveller asked for one", () => {
    const raw = { edits: [{ day_number: 2, activities: [] }], tripLength: null };
    expect(validateEdits(trip(), raw, "EUR").edits).toEqual([]);
    expect(validateEdits(trip(), raw, "EUR", true).edits.map((e) => [e.day_number, e.activities.length])).toEqual([[2, 0]]);
    // An edit with no activities array at all is still a broken one.
    expect(validateEdits(trip(), { edits: [{ day_number: 2 }], tripLength: null }, "EUR", true).edits).toEqual([]);
  });
});

describe("start times", () => {
  it("reads 12-hour times instead of falling back to the part of the day", () => {
    const activities = [
      { name: "A", time_slot: "afternoon", start_time: "1:30 PM" },
      { name: "B", time_slot: "morning", start_time: "9 am" },
      { name: "C", time_slot: "evening", start_time: "21h00" },
      { name: "D", time_slot: "evening", start_time: "12:15 a.m." },
      { name: "E", time_slot: "evening", start_time: "25:00" },
    ];
    const { edits } = validateEdits(trip(), { edits: [{ day_number: 1, activities }], tripLength: null }, "EUR");
    expect(edits[0].activities.map((a) => a.start_time)).toEqual(["13:30", "09:00", "21:00", "00:15", "19:00"]);
  });
});
