/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { planChecks, readPlanChecks } from "./plan-checks";

const found = (over: Partial<Parameters<typeof planChecks>[0]> = {}) => ({ asked: 9, known: 3, shutBefore: 0, seasonal: 0, shutAfter: 0, ...over });

describe("what a plan says was checked", () => {
  it("counts the sights looked at, and none shut when none was", () => {
    expect(planChecks(found())).toEqual({ sights: 9, shut: 0, fixed: 0, left: 0 });
  });

  it("says how many were on a day they're shut, how many were put right and how many still are", () => {
    expect(planChecks(found({ shutBefore: 3, shutAfter: 1 }))).toEqual({ sights: 9, shut: 3, fixed: 2, left: 1 });
    expect(planChecks(found({ shutBefore: 2 }))).toEqual({ sights: 9, shut: 2, fixed: 2, left: 0 });
  });

  it("counts a sight shut for the season with the ones shut on their weekday", () => {
    expect(planChecks(found({ shutBefore: 1, seasonal: 2, shutAfter: 2 }))).toEqual({ sights: 9, shut: 3, fixed: 1, left: 2 });
  });

  it("counts the sights of the checked list when no other was asked about", () => {
    expect(planChecks(found({ asked: 0, known: 2 }))).toEqual({ sights: 2, shut: 0, fixed: 0, left: 0 });
  });

  it("says nothing when no sight was looked at", () => {
    expect(planChecks(found({ asked: 0, known: 0 }))).toBeNull();
    expect(planChecks(found({ asked: 0, known: 0, shutBefore: 2 }))).toBeNull();
  });

  it("never says more shut than looked at, or more left than were shut", () => {
    expect(planChecks(found({ asked: 2, known: 0, shutBefore: 5, shutAfter: 4 }))).toEqual({ sights: 2, shut: 2, fixed: 0, left: 2 });
    expect(planChecks(found({ shutBefore: 1, shutAfter: 3 }))).toEqual({ sights: 9, shut: 1, fixed: 0, left: 1 });
  });

  it("takes no part of a number that isn't a count", () => {
    expect(planChecks(found({ asked: Number.NaN, known: -2 }))).toBeNull();
    expect(planChecks(found({ asked: 4.9, shutBefore: -1 }))).toEqual({ sights: 4, shut: 0, fixed: 0, left: 0 });
  });
});

describe("a summary read back from a stored plan", () => {
  it("is the same four counts", () => {
    expect(readPlanChecks({ sights: 9, shut: 3, fixed: 2, left: 1 })).toEqual({ sights: 9, shut: 3, fixed: 2, left: 1 });
  });

  it("works out what was put right from what was shut and what is left, whatever the stored figure says", () => {
    expect(readPlanChecks({ sights: 9, shut: 3, fixed: 99, left: 1 })).toEqual({ sights: 9, shut: 3, fixed: 2, left: 1 });
  });

  it("is nothing for a plan that carries none, or something else under the name", () => {
    for (const other of [undefined, null, "9 sights", 9, [], {}, { sights: 0 }, { sights: "many" }]) expect(readPlanChecks(other)).toBeNull();
  });

  it("keeps the counts adding up when a stored plan's don't", () => {
    expect(readPlanChecks({ sights: 2, shut: 7, left: 5 })).toEqual({ sights: 2, shut: 2, fixed: 0, left: 2 });
  });
});
