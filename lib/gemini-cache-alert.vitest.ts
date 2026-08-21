import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The Gemini cache alert used to fire on a $1.55/year problem while asserting
 * "this is a real regression" and pointing at the wrong file. These tests pin
 * the two properties that fix:
 *
 *   1. an immaterial miss must stay silent, however bad the hit rate is
 *   2. a material miss must still be reported
 *
 * and the guard against inferring an annual rate from a burst.
 */

const REAL_NOW = Date.now();

async function freshLogger() {
  vi.resetModules();
  const mod = await import("./gemini");
  return mod.logCacheMetrics;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Drive N eligible calls at 0% cache hit, spaced `stepMs` apart in fake time. */
async function drive(opts: {
  promptTokens: number;
  calls: number;
  stepMs: number;
  model?: string;
  endpoint: string;
}) {
  const log = await freshLogger();
  vi.useFakeTimers();
  vi.setSystemTime(REAL_NOW);
  for (let i = 0; i < opts.calls; i++) {
    log(
      opts.endpoint,
      {
        promptTokenCount: opts.promptTokens,
        candidatesTokenCount: 3000,
        cachedContentTokenCount: 0, // 0% hit, the observed production case
      },
      opts.model ?? "gemini-2.5-flash"
    );
    vi.advanceTimersByTime(opts.stepMs);
  }
}

const cacheWarnings = () =>
  warnSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((m) => m.includes("[Gemini Cache]"));

describe("Gemini cache-hit alert", () => {
  it("stays silent on the real production case (0% hit, ~$1.55/year)", async () => {
    // 1761-token prompts, ~30 generations/day => one every ~48 minutes.
    await drive({
      endpoint: "generateItinerary",
      promptTokens: 1761,
      calls: 25,
      stepMs: 48 * 60 * 1000,
    });
    expect(
      cacheWarnings(),
      "a $1.55/year miss must not page anyone — this is the false alarm being fixed"
    ).toEqual([]);
  });

  it("still fires when the money is real", async () => {
    // Large prompts on the expensive tier at high volume clears $50/year.
    await drive({
      endpoint: "bigExpensiveEndpoint",
      promptTokens: 200_000,
      calls: 25,
      stepMs: 5 * 60 * 1000,
      model: "gemini-2.5-pro",
    });
    const warnings = cacheWarnings();
    expect(warnings.length, "a material miss must be reported").toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/\/year of avoidable input cost/);
  });

  it("does not assert a cause it has not verified", async () => {
    await drive({
      endpoint: "bigExpensiveEndpoint2",
      promptTokens: 200_000,
      calls: 25,
      stepMs: 5 * 60 * 1000,
      model: "gemini-2.5-pro",
    });
    const msg = cacheWarnings()[0] ?? "";
    // The old message blamed a dynamic prefix and named lib/prompts.ts. Both
    // were wrong for the issue that actually fired.
    expect(msg).not.toMatch(/real regression/i);
    expect(msg).not.toMatch(/lib\/prompts\.ts/);
    // It should offer things to CHECK instead.
    expect(msg).toMatch(/byte-identical/);
  });

  it("will not infer an annual rate from a burst", async () => {
    // Same material per-call miss, but all 25 calls inside a few seconds.
    await drive({
      endpoint: "burstEndpoint",
      promptTokens: 200_000,
      calls: 25,
      stepMs: 200,
      model: "gemini-2.5-pro",
    });
    expect(
      cacheWarnings(),
      "10 seconds of traffic cannot justify an annual projection"
    ).toEqual([]);
  });

  it("ignores prompts below the implicit-cache floor entirely", async () => {
    await drive({
      endpoint: "tinyPromptEndpoint",
      promptTokens: 540, // the assistant-anon case: structurally uncacheable
      calls: 40,
      stepMs: 60 * 60 * 1000,
    });
    expect(cacheWarnings()).toEqual([]);
  });
});
