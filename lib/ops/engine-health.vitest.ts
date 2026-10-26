import { describe, expect, it } from "vitest";
import { engineVerdict, type EngineHealth } from "./engine-health";

const quiet: EngineHealth = { minutes: 60, requests: 12, errors: 0, client_generating: 11, client_failed: 0, ok_last_3h: 30 };

describe("engineVerdict", () => {
  it("is fine when generations succeed", () => {
    expect(engineVerdict(quiet)).toEqual({ ok: true });
  });

  it("flags a server failure rate of a fifth or more", () => {
    const v = engineVerdict({ ...quiet, errors: 3 });
    expect(v.ok).toBe(false);
    expect(v.ok ? [] : v.reasons).toEqual(["3 of 12 generation requests failed in the last 60 min."]);
  });

  it("flags planners who saw their generation fail, which the server may never log", () => {
    const v = engineVerdict({ ...quiet, client_failed: 4 });
    expect(v.ok ? [] : v.reasons).toEqual(["4 of 11 planners saw their generation fail in the last 60 min."]);
  });

  it("flags people trying while nothing has succeeded for hours", () => {
    const v = engineVerdict({ ...quiet, requests: 0, ok_last_3h: 0, client_generating: 6 });
    expect(v.ok ? [] : v.reasons).toEqual([
      "6 planners started a generation in the last 60 min, and none has succeeded for 3 hours.",
    ]);
  });

  it("says nothing on too few tries to judge", () => {
    expect(engineVerdict({ minutes: 60, requests: 2, errors: 2, client_generating: 3, client_failed: 3, ok_last_3h: 0 })).toEqual({ ok: true });
  });
});
