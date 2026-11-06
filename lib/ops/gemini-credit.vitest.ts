/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import { estimateCredit, readCreditEstimate, readCreditReading, saveCreditReading } from "./gemini-credit";

const s = vi.hoisted(() => ({
  since: [] as unknown[],
  week: [] as unknown[],
  spendFails: null as "since" | "week" | null,
  log: [] as unknown[],
}));

const NOW = new Date("2026-11-12T12:00:00.000Z");
const READ_AT = "2026-11-05T15:00:00.000Z";
const WEEK_AGO = "2026-11-05T12:00:00.000Z";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q) => {
      const week = (q.value as { p_from: string }).p_from === WEEK_AGO;
      if (s.spendFails === (week ? "week" : "since")) return { data: null, error: { message: "spend failed" } };
      return { data: week ? s.week : s.since, error: null };
    });
    s.log = db.log;
    return db.client;
  },
}));

const gemini = (usd: number) => ({ api_name: "gemini", unit_usd: 0.01, calls: usd * 100, usd });
const places = (usd: number) => ({ api_name: "google_places_photo", unit_usd: 0.007, calls: usd / 0.007, usd });
const reading = { usd: 50, at: READ_AT };

beforeEach(() => {
  delete (globalThis as { __geminiCreditReading?: unknown }).__geminiCreditReading;
  s.since = [];
  s.week = [];
  s.spendFails = null;
  s.log = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("estimateCredit", () => {
  it("takes the Gemini spend logged since off the balance typed, and gives the days left at the last week's pace", () => {
    expect(estimateCredit(reading, [gemini(3), gemini(1.5)], [gemini(14)])).toEqual({
      reading,
      spentUsd: 4.5,
      usd: 45.5,
      perDayUsd: 2,
      lasts: "about 22 days",
      low: false,
    });
  });

  it("counts only Gemini: Google bills the rest separately", () => {
    expect(estimateCredit(reading, [gemini(1), places(20)], [gemini(7), places(30)])).toMatchObject({
      spentUsd: 1,
      usd: 49,
      perDayUsd: 1,
      lasts: "about 49 days",
    });
  });

  it("is low with a week's spending left, and not with more", () => {
    expect(estimateCredit(reading, [gemini(36)], [gemini(14)]).low).toBe(true);
    expect(estimateCredit(reading, [gemini(35.99)], [gemini(14)]).low).toBe(false);
  });

  it("stops at nothing left", () => {
    expect(estimateCredit(reading, [gemini(60)], [gemini(14)])).toMatchObject({ usd: 0, lasts: "less than a day", low: true });
  });

  it("says how long in words", () => {
    expect(estimateCredit({ ...reading, usd: 3 }, [], [gemini(14)]).lasts).toBe("about 1 day");
    expect(estimateCredit({ ...reading, usd: 1.99 }, [], [gemini(14)]).lasts).toBe("less than a day");
    expect(estimateCredit({ ...reading, usd: 4 }, [], [gemini(14)]).lasts).toBe("about 2 days");
  });

  it("gives no days when nothing was spent in the last week, and isn't low while credit is left", () => {
    expect(estimateCredit(reading, [], [])).toMatchObject({ usd: 50, lasts: null, low: false });
    expect(estimateCredit({ ...reading, usd: 0 }, [], [])).toMatchObject({ usd: 0, lasts: null, low: true });
  });
});

describe("readCreditEstimate", () => {
  it("has no estimate before a balance is typed, and asks for nothing", async () => {
    expect(await readCreditEstimate(NOW)).toBeNull();
    expect(s.log).toEqual([]);
  });

  it("works from the last balance typed", async () => {
    await saveCreditReading({ usd: 10, at: "2026-11-01T00:00:00.000Z" });
    await saveCreditReading(reading);
    s.since = [gemini(4)];
    s.week = [gemini(7)];
    expect(await readCreditEstimate(NOW)).toMatchObject({ reading, spentUsd: 4, usd: 46, perDayUsd: 1, lasts: "about 46 days" });
  });

  it("asks for the spend since the reading and over the last 7 days, up to now", async () => {
    await saveCreditReading(reading);
    await readCreditEstimate(NOW);
    const asks = (s.log as FakeQuery[]).map((q) => [q.table, q.value]);
    expect(asks).toContainEqual(["api_spend_by_unit", { p_from: READ_AT, p_to: NOW.toISOString() }]);
    expect(asks).toContainEqual(["api_spend_by_unit", { p_from: WEEK_AGO, p_to: NOW.toISOString() }]);
  });

  it.each(["since", "week"] as const)("gives no estimate when the %s spend can't be read: a wrong one would say all is well", async (read) => {
    await saveCreditReading(reading);
    s.spendFails = read;
    expect(await readCreditEstimate(NOW)).toBeNull();
  });
});

describe("the reading", () => {
  it("is what was saved", async () => {
    expect(await readCreditReading()).toBeNull();
    expect(await saveCreditReading(reading)).toBe(true);
    expect(await readCreditReading()).toEqual(reading);
  });
});
