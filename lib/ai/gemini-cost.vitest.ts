import { describe, it, expect, vi } from "vitest";
import { GeminiCostMeter, geminiCostUsd, recordGeminiUsage } from "./gemini-cost";

/**
 * Gemini spend, priced from token counts. api_request_logs booked a flat
 * $0.003 per trip generation while a real one (1.9k tokens in, 6k out on 2.5
 * Flash) costs ~$0.016, so the admin dashboard under-read Gemini ~5x.
 */

describe("geminiCostUsd", () => {
  it("prices a trip generation at Google's paid-tier rates for 2.5 Flash", () => {
    // A production generation, 2026-09-26: prompt=1882, output=6029.
    const usd = geminiCostUsd("gemini-2.5-flash", { promptTokenCount: 1882, candidatesTokenCount: 6029 });
    expect(usd).toBeCloseTo((1882 * 0.3 + 6029 * 2.5) / 1e6, 10);
    expect(usd).toBeGreaterThan(0.015);
  });

  it("bills cached prompt tokens at the cached rate, and thinking tokens as output", () => {
    const usd = geminiCostUsd("gemini-2.5-flash", {
      promptTokenCount: 2000,
      cachedContentTokenCount: 1000,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 400,
    });
    expect(usd).toBeCloseTo((1000 * 0.3 + 1000 * 0.03 + 500 * 2.5) / 1e6, 10);
  });

  it("prices Flash-Lite and Pro at their own rates", () => {
    const usage = { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000 };
    expect(geminiCostUsd("gemini-2.5-flash-lite", usage)).toBeCloseTo(0.5, 10);
    expect(geminiCostUsd("gemini-2.5-pro", usage)).toBeCloseTo(11.25, 10);
  });

  it("prices an unknown model as Pro, so a new model can't make the figure too low", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const usage = { promptTokenCount: 1000, candidatesTokenCount: 1000 };
    expect(geminiCostUsd("gemini-9-ultra", usage)).toBe(geminiCostUsd("gemini-2.5-pro", usage));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("is 0 without usage metadata", () => {
    expect(geminiCostUsd("gemini-2.5-flash", undefined)).toBe(0);
  });
});

describe("GeminiCostMeter", () => {
  const flashCall = { promptTokenCount: 1000, candidatesTokenCount: 1000 };
  const oneCall = geminiCostUsd("gemini-2.5-flash", flashCall);

  it("sums every response inside run(), parallel calls and awaits included", async () => {
    const meter = new GeminiCostMeter();
    await meter.run(async () => {
      recordGeminiUsage("gemini-2.5-flash", flashCall);
      // A multi-city trip: one call per city, in parallel, after an await.
      await Promise.all(
        [1, 2, 3].map(async () => {
          await new Promise((r) => setTimeout(r, 5));
          recordGeminiUsage("gemini-2.5-flash", flashCall);
        })
      );
    });
    expect(meter.usd).toBeCloseTo(oneCall * 4, 12);
  });

  it("keeps concurrent requests apart", async () => {
    const a = new GeminiCostMeter();
    const b = new GeminiCostMeter();
    const call = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await new Promise((r) => setTimeout(r, 1));
        recordGeminiUsage("gemini-2.5-flash", flashCall);
      }
    };
    await Promise.all([a.run(() => call(2)), b.run(() => call(5))]);
    expect(a.usd).toBeCloseTo(oneCall * 2, 12);
    expect(b.usd).toBeCloseTo(oneCall * 5, 12);
  });

  it("keeps what was spent when the request fails", async () => {
    const meter = new GeminiCostMeter();
    await expect(
      meter.run(async () => {
        recordGeminiUsage("gemini-2.5-flash", flashCall);
        throw new Error("model returned non-JSON output");
      })
    ).rejects.toThrow();
    expect(meter.usd).toBeCloseTo(oneCall, 12);
  });

  it("records nothing outside a meter", () => {
    expect(() => recordGeminiUsage("gemini-2.5-flash", flashCall)).not.toThrow();
  });
});
