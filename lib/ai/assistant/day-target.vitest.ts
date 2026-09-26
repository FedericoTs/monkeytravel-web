/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { dayMentioned, isUsableActivityName, stripDayMention, withDayTarget } from "./day-target";

/**
 * The trip assistant must act on the day the user named, and ask rather than
 * guess when they named none. The quoted messages are from production
 * (2026-09-20).
 */

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

describe("stripDayMention / isUsableActivityName", () => {
  it("takes the day out of the name", () => {
    expect(stripDayMention("museum on day 2")).toBe("museum");
    expect(stripDayMention("Borghese Gallery from Day 5")).toBe("Borghese Gallery");
    expect(stripDayMention("it day 5")).toBe("it");
  });

  it("refuses a name that is only a pronoun or filler", () => {
    expect(isUsableActivityName("it")).toBe(false);
    expect(isUsableActivityName("day 5 info")).toBe(true); // stripped first by withDayTarget
    expect(isUsableActivityName(stripDayMention("day 5 info"))).toBe(false);
    expect(isUsableActivityName("the Borghese Gallery")).toBe(true);
    expect(isUsableActivityName(undefined)).toBe(false);
  });
});

describe("withDayTarget", () => {
  it("'Can we delete it day 5': a remove on Day 5 with nothing to match, not Day 6's 'Cruise Day'", () => {
    expect(withDayTarget({ type: "remove", activityName: "it day 5" }, "Can we delete it day 5")).toEqual({
      type: "remove",
      activityName: undefined,
      dayNumber: 5,
    });
  });

  it("an add keeps the day the user gave, wherever they gave it", () => {
    const msg = "okay everything is messed up. I need to get rid of day 5 info and add the part where we go to civiavecchia port";
    expect(withDayTarget({ type: "add", preference: msg }, msg).dayNumber).toBe(5);
  });

  it("does not override a day the parser already read", () => {
    expect(withDayTarget({ type: "add", dayNumber: 3 }, "add a tour to day 3, not day 4").dayNumber).toBe(3);
  });

  it("leaves the day empty when none was named, so the handler can ask", () => {
    expect(withDayTarget({ type: "add" }, "add a coffee stop").dayNumber).toBeUndefined();
  });

  it("keeps a real name, minus its day", () => {
    expect(withDayTarget({ type: "replace", activityName: "museum on day 2" }, "replace the museum on day 2 with a food tour")).toMatchObject({
      activityName: "museum",
      dayNumber: 2,
    });
  });
});
