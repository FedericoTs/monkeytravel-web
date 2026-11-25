import { describe, expect, it } from "vitest";
import { assignArm, chosenKey, drawnKey } from "./assign";
import type { Experiment } from "./registry";

const EXP = { key: "demo", arms: ["control", "new"], starts: Date.UTC(2026, 0, 1), reviewBy: "2099-01-01" } as const satisfies Experiment;
const THREE = { key: "trio", arms: ["a", "b", "c"], starts: 0, reviewBy: "2099-01-01" } as const satisfies Experiment;
const AFTER = Date.UTC(2026, 5, 1);

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("drawing an arm", () => {
  it("draws at random after the start, keeps the draw, and counts it", () => {
    const store = memory();
    expect(assignArm(EXP, { asked: null, store, now: AFTER, random: () => 0.7 })).toEqual({ arm: "new", counted: true });
    expect(store.data.get(drawnKey("demo"))).toBe("new");
    // The same browser keeps its arm, whatever the next random number.
    expect(assignArm(EXP, { asked: null, store, now: AFTER, random: () => 0.1 })).toEqual({ arm: "new", counted: true });
  });

  it("splits evenly across every arm, the last included", () => {
    const arm = (r: number) => assignArm(THREE, { asked: null, store: memory(), now: 1, random: () => r }).arm;
    expect([arm(0), arm(0.34), arm(0.67), arm(0.9999999)]).toEqual(["a", "b", "c", "c"]);
  });

  it("doesn't count a browser that can't keep its draw", () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error("full"); } };
    expect(assignArm(EXP, { asked: null, store: broken, now: AFTER, random: () => 0.7 }).counted).toBe(false);
    expect(assignArm(EXP, { asked: null, store: null, now: AFTER, random: () => 0.7 }).counted).toBe(false);
  });

  it("shows the control, uncounted, before the start", () => {
    const store = memory();
    expect(assignArm(EXP, { asked: null, store, now: EXP.starts - 1, random: () => 0.9 })).toEqual({ arm: "control", counted: false });
    expect(store.data.size).toBe(0);
  });

  it("shows a link's choice, keeps it in the browser, and never counts it", () => {
    const store = memory({ [drawnKey("demo")]: "control" });
    expect(assignArm(EXP, { asked: "new", store, now: AFTER, random: () => 0 })).toEqual({ arm: "new", counted: false });
    expect(store.data.get(chosenKey("demo"))).toBe("new");
    expect(assignArm(EXP, { asked: null, store, now: AFTER, random: () => 0 })).toEqual({ arm: "new", counted: false });
  });

  it("ignores a link that names no arm", () => {
    expect(assignArm(EXP, { asked: "sky", store: memory(), now: AFTER, random: () => 0.7 })).toEqual({ arm: "new", counted: true });
  });

  it("follows the switch: off shows the control, an arm's name shows that arm, neither counted", () => {
    const store = memory({ [drawnKey("demo")]: "new" });
    expect(assignArm(EXP, { asked: null, store, now: AFTER, random: () => 0.7, pin: "off" })).toEqual({ arm: "control", counted: false });
    expect(assignArm(EXP, { asked: null, store: memory(), now: AFTER, random: () => 0, pin: "new" })).toEqual({ arm: "new", counted: false });
  });

  it("a link's choice outranks the switch", () => {
    expect(assignArm(EXP, { asked: "new", store: memory(), now: AFTER, random: () => 0, pin: "off" })).toEqual({ arm: "new", counted: false });
  });
});
