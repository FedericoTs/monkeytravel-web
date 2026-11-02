/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { dayMentioned } from "./day-target";

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

  it("finds none where there is none", () => {
    expect(dayMentioned("add a coffee stop")).toBeUndefined();
    expect(dayMentioned("spend 2 hours at the Louvre")).toBeUndefined();
    expect(dayMentioned("what about days 5-6?")).toBeUndefined();
    expect(dayMentioned("the holiday 5 minutes away")).toBeUndefined();
  });
});
