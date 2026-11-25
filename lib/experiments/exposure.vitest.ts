import { describe, expect, it, vi } from "vitest";
import { createExposureReporter } from "./exposure";
import type { Experiment } from "./registry";

const EXP = { key: "demo", arms: ["control", "new"], starts: 0, reviewBy: "2099-01-01" } as const satisfies Experiment;
const OTHER = { key: "other", arms: ["a", "b"], starts: 0, reviewBy: "2099-01-01" } as const satisfies Experiment;

function setup() {
  const post = vi.fn(async () => new Response(null, { status: 204 }));
  const register = vi.fn();
  const report = createExposureReporter({ post, onPostHog: (callback) => callback({ register }) });
  return { post, register, report };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("recording an exposure", () => {
  it("sends a counted arm once per page and experiment, and sets it as a PostHog property", async () => {
    const { post, register, report } = setup();
    report(EXP, { arm: "new", counted: true });
    report(EXP, { arm: "new", counted: true });
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/experiments/exposure");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ experiment: "demo", arm: "new" });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({ exp_demo: "new" });
  });

  it("sends each experiment on its own", async () => {
    const { post, report } = setup();
    report(EXP, { arm: "control", counted: true });
    report(OTHER, { arm: "b", counted: true });
    await flush();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("records nothing for an arm that isn't counted", async () => {
    const { post, register, report } = setup();
    report(EXP, { arm: "new", counted: false });
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("keeps the page going when the request fails", async () => {
    const post = vi.fn(async () => {
      throw new Error("offline");
    });
    const report = createExposureReporter({ post, onPostHog: () => {} });
    expect(() => report(EXP, { arm: "new", counted: true })).not.toThrow();
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
