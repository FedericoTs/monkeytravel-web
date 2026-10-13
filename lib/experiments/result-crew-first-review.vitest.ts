import { describe, expect, it } from "vitest";
import { reviewCrewFirst } from "./result-crew-first-review";

/**
 * The rule fixed before the test reads its data: crew_first stays only if it
 * shares more without saving significantly less.
 */

describe("reviewCrewFirst", () => {
  it("keeps crew_first when it shares more and saves no less", () => {
    const r = reviewCrewFirst({ sessions: 300, shared: 27, saved: 45 }, { sessions: 300, shared: 60, saved: 42 });
    expect(r.share.verdict).toBe("better");
    expect(r.decision).toBe("keep_crew_first");
  });

  it("stops it when saves drop, however much it shares", () => {
    const r = reviewCrewFirst({ sessions: 300, shared: 27, saved: 60 }, { sessions: 300, shared: 70, saved: 30 });
    expect(r.save.verdict).toBe("worse");
    expect(r.decision).toBe("keep_control");
  });

  it("keeps running while the read is inconclusive, and settles on control once it has enough", () => {
    expect(reviewCrewFirst({ sessions: 60, shared: 6, saved: 9 }, { sessions: 60, shared: 8, saved: 9 }).decision).toBe("keep_running");
    expect(reviewCrewFirst({ sessions: 2000, shared: 180, saved: 300 }, { sessions: 2000, shared: 190, saved: 300 }).decision).toBe(
      "keep_control"
    );
  });

  it("draws no conclusion before each arm has enough sessions", () => {
    expect(reviewCrewFirst({ sessions: 0, shared: 0, saved: 0 }, { sessions: 0, shared: 0, saved: 0 }).decision).toBe("keep_running");
    expect(reviewCrewFirst({ sessions: 40, shared: 1, saved: 20 }, { sessions: 40, shared: 20, saved: 2 }).decision).toBe("keep_running");
  });

  it("says no when crew_first shares significantly less", () => {
    expect(reviewCrewFirst({ sessions: 300, shared: 60, saved: 45 }, { sessions: 300, shared: 27, saved: 45 }).decision).toBe(
      "keep_control"
    );
  });
});
