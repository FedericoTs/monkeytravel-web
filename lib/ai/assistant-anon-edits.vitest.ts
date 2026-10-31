/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import type { ItineraryDay } from "@/types";
import { asksForFreeDay, buildPrompt, composeReply, plainText, validateEdits } from "./assistant-anon";

/**
 * The wizard assistant can change several days and the trip's length in one
 * reply, and says only what it prepared. Cases from production (2026-09-15..26):
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
  });

  it("shortens the trip, but never by dropping a day with a fixed plan", () => {
    expect(validateEdits(trip(), { edits: [], tripLength: 4 }, "EUR").tripLength).toBe(4);
    const locked = [...trip().slice(0, 4), day(5, { activities: [{ ...act("Wedding"), locked: true }] as never })];
    const out = validateEdits(locked, { edits: [], tripLength: 4 }, "EUR");
    expect(out.tripLength).toBeUndefined();
    expect(out.lengthRefused).toBe(true);
  });

  it("never rewrites a day holding a fixed plan", () => {
    const locked = [day(1), day(2, { activities: [{ ...act("Flight"), locked: true }] as never }), day(3)];
    const out = validateEdits(locked, { edits: [edit(2), edit(3)], tripLength: null }, "EUR");
    expect(out.edits.map((e) => e.day_number)).toEqual([3]);
    expect(out.lockedDays).toEqual([{ dayNumber: 2, names: ["Flight"] }]);
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

  it("a day withheld for a fixed plan is explained", () => {
    const text = composeReply({ ...base, reply: "I've updated Day 2.", edits: [], lockedDays: [{ dayNumber: 2, names: ["Flight"] }] });
    expect(text).toMatch(/^Day 2 is built around a fixed plan \(Flight\)/);
  });

  it("answers in the traveller's language", () => {
    expect(composeReply({ ...base, locale: "it", reply: "Ho aggiunto una cena al giorno 7.", edits: [] })).toMatch(/^Non ho modificato il tuo piano/);
  });

  // Live, 2026-09-26: Gemini kept answering "Ho aggiunto un sesto giorno…" for
  // an edit still waiting for Apply, despite the prompt.
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
    expect(text).toMatch(/^El día 2 gira en torno a un plan fijo \(Vuelo\)/);
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
});

describe("buildPrompt", () => {
  // "Suggest a great local restaurant to add" was answered with "which day?",
  // and the plan stayed as it was.
  it("adds to the day with the most room when no day is named, instead of asking", () => {
    const prompt = buildPrompt({ message: "Suggest a great local restaurant to add", destination: "Lisbon", tripTitle: "Lisbon", days: trip(), locale: "en" });
    expect(prompt).toContain("pick the day with the most room where it fits, add it there without removing anything");
    expect(prompt).toContain("Don't ask which day");
  });

  it("offers asked-for alternatives as edits that can be applied, and names others to choose from", () => {
    const prompt = buildPrompt({ message: "Suggest alternative activities I could do", destination: "Lisbon", tripTitle: "Lisbon", days: trip(), locale: "en" });
    expect(prompt).toContain("put your best picks into the plan as edits");
    expect(prompt).toContain("name one or two other good options they can ask for instead");
    expect(prompt).toContain("If they want to choose first");
  });
});

describe("questions about money", () => {
  // Asked for "il gran totale" (2026-10-21), the assistant answered "Ecco il
  // calcolo…" three times and never gave a number: replies were held to 1-2
  // sentences and it had no figures to quote.
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
    // The model's own formatting in a live run (2026-10-21).
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
