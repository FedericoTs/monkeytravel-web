/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import type { ItineraryDay } from "@/types";
import { composeReply, validateEdits } from "./assistant-anon";

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
});

describe("composeReply", () => {
  const base = { lockedDays: [], lengthRefused: false, locale: "en", currentDays: 5 };

  it("a claim with nothing prepared becomes an honest reply", () => {
    const text = composeReply({ ...base, reply: "I've swapped the Northern Lights Chase to Day 5 and Orca Watching to Day 2 for you.", edits: [] });
    expect(text).toMatch(/^I haven't changed your plan/);
  });

  it("an answer with nothing prepared stays as it is", () => {
    const reply = "Tromsø's aurora season runs from September to March.";
    expect(composeReply({ ...base, reply, edits: [] })).toBe(reply);
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
    expect(text).toContain('finché non tocchi "Applica modifica"');
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
