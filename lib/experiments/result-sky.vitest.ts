import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SKY_TEST_STARTS, assignSky, syncSkyArm } from "./result-sky";

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const refusing = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

const BEFORE = SKY_TEST_STARTS - 60_000;
const DURING = SKY_TEST_STARTS + 60_000;
const heads = () => 0.2;
const tails = () => 0.8;

describe("before the test starts", () => {
  it("shows the classic screen and counts nobody", () => {
    expect(assignSky({ asked: null, store: memoryStore(), now: BEFORE, random: heads })).toEqual({ arm: "classic", counted: false });
  });

  it("shows the sky to a link, and keeps it in that browser", () => {
    const store = memoryStore();
    expect(assignSky({ asked: "sky", store, now: BEFORE, random: tails })).toEqual({ arm: "sky", counted: false });
    expect(assignSky({ asked: null, store, now: BEFORE, random: tails })).toEqual({ arm: "sky", counted: false });
  });

  it("still knows the sky from the first links", () => {
    expect(assignSky({ asked: null, store: memoryStore({ mt_result_sky: "1" }), now: BEFORE, random: tails }).arm).toBe("sky");
  });
});

describe("during the test", () => {
  it("draws an arm at random, half each way, and counts it", () => {
    expect(assignSky({ asked: null, store: memoryStore(), now: DURING, random: heads })).toEqual({ arm: "sky", counted: true });
    expect(assignSky({ asked: null, store: memoryStore(), now: DURING, random: tails })).toEqual({ arm: "classic", counted: true });
  });

  it("keeps the draw, so a visitor sees the same screen on every plan", () => {
    const store = memoryStore();
    assignSky({ asked: null, store, now: DURING, random: heads });
    expect(assignSky({ asked: null, store, now: DURING, random: tails })).toEqual({ arm: "sky", counted: true });
  });

  it("never counts a screen a link chose", () => {
    const store = memoryStore();
    expect(assignSky({ asked: "classic", store, now: DURING, random: heads })).toEqual({ arm: "classic", counted: false });
    expect(assignSky({ asked: null, store, now: DURING, random: heads })).toEqual({ arm: "classic", counted: false });
  });

  it("doesn't count a browser that can't keep its draw", () => {
    expect(assignSky({ asked: null, store: refusing, now: DURING, random: heads }).counted).toBe(false);
    expect(assignSky({ asked: null, store: null, now: DURING, random: heads }).counted).toBe(false);
  });

  it("stops drawing when switched off, and shows everyone the sky when switched on", () => {
    expect(assignSky({ asked: null, store: memoryStore(), now: DURING, random: heads, pin: "off" })).toEqual({ arm: "classic", counted: false });
    expect(assignSky({ asked: null, store: memoryStore(), now: DURING, random: tails, pin: "on" })).toEqual({ arm: "sky", counted: false });
    // A link still chooses while it's off.
    expect(assignSky({ asked: "sky", store: memoryStore(), now: DURING, random: tails, pin: "off" }).arm).toBe("sky");
  });

  it("ignores anything else in the link", () => {
    expect(assignSky({ asked: "crew_first", store: memoryStore(), now: DURING, random: heads })).toEqual({ arm: "sky", counted: true });
  });
});

describe("what a browser's PostHog events carry", () => {
  /** A browser's PostHog super properties, with whatever was registered before. */
  function browser(before: Record<string, unknown>) {
    const props: Record<string, unknown> = { front_door: "wizard", ...before };
    return {
      props,
      register: (more: Record<string, unknown>) => void Object.assign(props, more),
      unregister: (name: string) => void delete props[name],
    };
  }

  it("a counted browser carries its arm, in place of any other", () => {
    for (const arm of ["sky", "classic"] as const) {
      const posthog = browser({ result_variant: "control" });
      syncSkyArm(posthog, { arm, counted: true });
      expect(posthog.props).toEqual({ front_door: "wizard", result_variant: arm });
    }
  });

  it("any other browser carries none, not even one an earlier test or draw left", () => {
    for (const before of ["crew_first", "sky"]) {
      const posthog = browser({ result_variant: before });
      syncSkyArm(posthog, { arm: "sky", counted: false });
      expect(posthog.props).toEqual({ front_door: "wizard" });
    }
  });

  it("is how the planner gives PostHog every browser's assignment", () => {
    const planner = readFileSync(path.resolve(__dirname, "../../app/[locale]/(app)/trips/new/NewTripWizard.tsx"), "utf8").replace(/\s+/g, " ");
    expect(planner.match(/useEffect\(\(\) => \{[^{}]*syncSkyArm[^{}]*\}, \[[^\]]*\]\);/g)).toEqual([
      "useEffect(() => { onPostHogReady((posthog) => syncSkyArm(posthog, skyTest)); }, [skyTest]);",
    ]);
    expect(planner.match(/register\(\{ result_variant[^}]*\}/g)).toBeNull();
  });
});
