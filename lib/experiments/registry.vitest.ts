import { describe, expect, it } from "vitest";
import { EXPERIMENTS, experimentByKey, STEP2_DEFAULT, STORY_WAY_IN } from "./registry";

/**
 * Every experiment is well formed for the table that records it, and none runs past the day it must be read and
 * decided: this fails after that day until it is decided (taken out, or kept with a new day and a reason).
 */
describe("the experiments", () => {
  it("have keys and arms the exposures table accepts, unique, with a control and at least one other arm", () => {
    const keys = new Set<string>();
    for (const experiment of EXPERIMENTS) {
      expect(experiment.key).toMatch(/^[a-z0-9][a-z0-9_]{1,39}$/);
      expect(keys.has(experiment.key)).toBe(false);
      keys.add(experiment.key);
      expect(experiment.arms.length).toBeGreaterThanOrEqual(2);
      expect(new Set(experiment.arms).size).toBe(experiment.arms.length);
      for (const arm of experiment.arms) expect(arm).toMatch(/^[a-z0-9][a-z0-9_]{0,29}$/);
    }
  });

  it("start before the day they must be decided, and that day hasn't passed", () => {
    for (const experiment of EXPERIMENTS) {
      expect(experiment.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const review = Date.parse(`${experiment.reviewBy}T23:59:59Z`);
      expect(experiment.starts).toBeLessThan(review);
      expect(Date.now(), `${experiment.key} was due to be read and decided by ${experiment.reviewBy}`).toBeLessThanOrEqual(review);
    }
  });

  it("are found by key, and nothing else is", () => {
    expect(experimentByKey("step2_default")).toBe(STEP2_DEFAULT);
    expect(experimentByKey("story_way_in")).toBe(STORY_WAY_IN);
    expect(experimentByKey("no_such_experiment")).toBeUndefined();
  });

  it("story_way_in keeps today's share as its control", () => {
    expect(STORY_WAY_IN.arms[0]).toBe("none");
  });
});
