/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The weekly sync was killed at the 60 s cron limit while creating a backlog
 * of contacts, before it logged anything or reconciled opt-outs. Asserted
 * against the source and vercel.json, like the other cron guards.
 */

const SRC = readFileSync(join(__dirname, "route.ts"), "utf8");
const VERCEL = JSON.parse(
  readFileSync(join(__dirname, "../../../../vercel.json"), "utf8")
) as { functions: Record<string, { maxDuration?: number }> };
const KEY = "app/api/cron/sync-resend-audience/route.ts";

describe("audience sync time limit", () => {
  const budgetMs = Number(
    SRC.match(/const CREATE_BUDGET_MS = ([\d_]+);/)?.[1].replace(/_/g, "")
  );

  it("stops creating contacts at a deadline and reports the rest", () => {
    expect(budgetMs).toBeGreaterThan(0);
    expect(SRC).toMatch(/Date\.now\(\) - startedAt > CREATE_BUDGET_MS/);
    expect(SRC).toMatch(/deferred = toCreate\.length - i/);
  });

  it("leaves time after the deadline for the opt-out steps", () => {
    const limit = VERCEL.functions[KEY]?.maxDuration ?? 0;
    expect(limit * 1000 - budgetMs).toBeGreaterThanOrEqual(30_000);
  });

  it("is configured ahead of the cron glob that would cap it at 60 s", () => {
    const keys = Object.keys(VERCEL.functions);
    expect(keys.indexOf(KEY)).toBeGreaterThanOrEqual(0);
    expect(keys.indexOf(KEY)).toBeLessThan(keys.indexOf("app/api/cron/*/route.ts"));
  });
});
