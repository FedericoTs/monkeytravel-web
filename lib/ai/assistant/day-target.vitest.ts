/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { dayMentioned, daysMentioned } from "./day-target";

/** The day a message names, in the four languages. */

describe("dayMentioned", () => {
  it("reads the day from anywhere in the message", () => {
    expect(dayMentioned("okay everything is messed up. I need to get rid of day 5 info and add the part where we go to civiavecchia port")).toBe(5);
    expect(dayMentioned("Can we delete it day 5")).toBe(5);
    expect(dayMentioned("replace the museum on Day 12 with a food tour")).toBe(12);
    expect(dayMentioned("añade una cena al día 3")).toBe(3);
    expect(dayMentioned("aggiungi una cena al giorno 4")).toBe(4);
    expect(dayMentioned("adiciona um jantar ao dia 2")).toBe(2);
  });

  it("reads a date as a date, not as a day of the trip", () => {
    expect(dayMentioned("ficamos em porto até dia 14/03 as 15h00. voltamos para lisboa em 14/03")).toBeUndefined();
    expect(dayMentioned("llegamos el día 3.1 por la noche")).toBeUndefined();
    expect(dayMentioned("chegamos no dia 11 de março à noite")).toBeUndefined();
    expect(dayMentioned("llegamos el día 5 de enero")).toBeUndefined();
    expect(dayMentioned("arriviamo il giorno 11 marzo")).toBeUndefined();
    expect(dayMentioned("Março: chegamos no dia 2 de Março")).toBeUndefined();
    expect(
      daysMentioned("Chegada a Lisboa no dia 10/03 às 23:00. Partida para o Porto no dia 13/03. Partida para casa no dia 24/03."),
    ).toEqual([]);
  });

  it("still reads a day beside a slash, a full stop or a word that isn't a month", () => {
    expect(dayMentioned("Day 3 may be too long, cut it")).toBe(3);
    expect(dayMentioned("move the dinner on day 3. 4 of us are coming")).toBe(3);
    expect(daysMentioned("day 2/day 3 swap, we land on 10/03")).toEqual([2, 3]);
    expect(daysMentioned("Day 1 and day 2 in Lisbon, from 10/03")).toEqual([1, 2]);
  });

  it("finds none where there is none", () => {
    expect(dayMentioned("add a coffee stop")).toBeUndefined();
    expect(dayMentioned("spend 2 hours at the Louvre")).toBeUndefined();
    expect(dayMentioned("what about days 5-6?")).toBeUndefined();
    expect(dayMentioned("the holiday 5 minutes away")).toBeUndefined();
  });
});
