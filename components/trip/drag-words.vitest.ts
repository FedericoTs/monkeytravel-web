import { describe, expect, it } from "vitest";
import en from "@/messages/en/common.json";
import es from "@/messages/es/common.json";
import it_ from "@/messages/it/common.json";
import pt from "@/messages/pt/common.json";

/** What a screen reader hears while a stop moves (TripDayList), in every language. */
describe("the drag announcements", () => {
  it.each([
    ["en", en],
    ["es", es],
    ["it", it_],
    ["pt", pt],
  ])("name the stop, its place and its day in %s", (_locale, messages) => {
    for (const key of ["pickedUp", "over", "dropped", "cancelled"] as const) {
      for (const value of ["{name}", "{position}", "{count}", "{day}"]) {
        expect(messages.drag[key], `${key} has ${value}`).toContain(value);
      }
    }
    expect(messages.drag.instructions).not.toMatch(/[{}]/);
  });
});
