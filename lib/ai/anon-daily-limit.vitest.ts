/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  created: [] as Array<{ namespace: string; limit: number; windowMs: number }>,
  keys: [] as Array<string | undefined>,
  answer: { allowed: true, remaining: 1 } as { allowed: boolean; remaining: number } | Error,
}));

vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (namespace: string, limit: number, windowMs: number) => {
    s.created.push({ namespace, limit, windowMs });
    return {
      check: async (_request: unknown, key?: string) => {
        s.keys.push(key);
        if (s.answer instanceof Error) throw s.answer;
        return s.answer;
      },
    };
  },
}));

const { withinAnonDailyLimit } = await import("./anon-daily-limit");
const request = {} as NextRequest;

beforeEach(() => {
  s.keys.length = 0;
  s.answer = { allowed: true, remaining: 1 };
});

describe("the daily limit on anonymous AI calls", () => {
  it("counts every visitor under today's date, for a day", async () => {
    expect(await withinAnonDailyLimit(request)).toBe(true);
    expect(s.keys).toEqual([new Date().toISOString().slice(0, 10)]);
    expect(s.created).toEqual([{ namespace: "gemini-anon-day", limit: 300, windowMs: 86_400_000 }]);
  });

  it("says no past the limit", async () => {
    s.answer = { allowed: false, remaining: 0 };
    expect(await withinAnonDailyLimit(request)).toBe(false);
  });

  it("never blocks a call on a limiter error", async () => {
    s.answer = new Error("KV down");
    expect(await withinAnonDailyLimit(request)).toBe(true);
  });
});
