import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { WENT_ANSWERS, WENT_REASONS, isWentAnswer, isWentReason, latestWentAnswers } from "./went";

const copy = (locale: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "common.json"), "utf8")).didYouGo as Record<string, string>;

describe("the answers to 'did you go?'", () => {
  it("takes yes or no, nothing else", () => {
    expect(isWentAnswer("yes")).toBe(true);
    expect(isWentAnswer("no")).toBe(true);
    for (const other of ["maybe", "", null, undefined, 1, ["yes"]]) expect(isWentAnswer(other)).toBe(false);
  });

  it("takes only the reasons that belong to that answer", () => {
    expect(isWentReason("yes", "closed")).toBe(true);
    expect(isWentReason("no", "changed")).toBe(true);
    expect(isWentReason("no", "closed")).toBe(false);
    expect(isWentReason("yes", "changed")).toBe(false);
    for (const other of ["", null, undefined, 1]) expect(isWentReason("yes", other)).toBe(false);
  });

  it.each(["en", "es", "it", "pt"])("has words for every reason in %s", (locale) => {
    const words = copy(locale);
    for (const answer of WENT_ANSWERS) {
      for (const reason of WENT_REASONS[answer]) expect(words[`reason_${reason}`], reason).toBeTruthy();
    }
  });
});

describe("each trip's answer", () => {
  it("is the newest one, and rows from other questions don't count", () => {
    const rows = [
      { extra: { trip_id: "a", went: "no", went_reason: "changed" } },
      { extra: { trip_id: "b", went: "yes" } },
      { extra: { trip_id: "a", went: "yes" } },
      { extra: { found_via: "search" } },
      { extra: null },
      {},
      { extra: { trip_id: "c", went: "perhaps" } },
      { extra: { went: "yes" } },
    ];
    expect([...latestWentAnswers(rows)]).toEqual([
      ["a", "no"],
      ["b", "yes"],
    ]);
  });
});
