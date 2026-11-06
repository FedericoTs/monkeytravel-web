import { Redis } from "@upstash/redis";
import { createAdminClient } from "@/lib/supabase/admin";
import { logReadError } from "@/lib/supabase/log-read-error";
import type { SpendGroup } from "@/lib/ops/spend";

/**
 * What's left of the prepaid Gemini credit, as an estimate. Google shows the
 * balance only in AI Studio, and at $0 every AI call stops. So the owner types
 * what AI Studio shows on the Costs tab, and this takes off the Gemini spend
 * logged since. Test runs aren't logged, so the real balance can be lower until
 * the next reading.
 *
 * The reading is kept in Upstash when it is configured, else in this instance's
 * memory (local dev, tests).
 */

export interface CreditReading {
  usd: number;
  at: string;
}

export interface CreditEstimate {
  reading: CreditReading;
  /** Logged since the reading. */
  spentUsd: number;
  usd: number;
  /** Over the last week. */
  perDayUsd: number;
  /** How long it lasts at that pace, in words. Null when nothing was spent. */
  lasts: string | null;
  /** A week's spending or less is left. */
  low: boolean;
}

const KEY = "ops:gemini-credit";
const DAY_MS = 24 * 60 * 60 * 1000;

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;
// On globalThis: in dev, two routes can load their own copy of this module.
const local = globalThis as { __geminiCreditReading?: CreditReading };

const cents = (usd: number) => Math.round(usd * 100) / 100;
const geminiUsd = (groups: SpendGroup[]) =>
  groups.reduce((sum, group) => (group.api_name === "gemini" ? sum + group.usd : sum), 0);

function howLong(usd: number, perDayUsd: number): string | null {
  if (perDayUsd <= 0) return null;
  const days = Math.floor(usd / perDayUsd);
  if (days === 0) return "less than a day";
  return days === 1 ? "about 1 day" : `about ${days} days`;
}

export function estimateCredit(reading: CreditReading, sinceReading: SpendGroup[], lastWeek: SpendGroup[]): CreditEstimate {
  const spentUsd = geminiUsd(sinceReading);
  const usd = Math.max(0, reading.usd - spentUsd);
  const lastWeekUsd = geminiUsd(lastWeek);
  const perDayUsd = lastWeekUsd / 7;
  return {
    reading,
    spentUsd: cents(spentUsd),
    usd: cents(usd),
    perDayUsd: cents(perDayUsd),
    lasts: howLong(usd, perDayUsd),
    low: usd <= lastWeekUsd,
  };
}

/** Whether the balance was kept. */
export async function saveCreditReading(reading: CreditReading): Promise<boolean> {
  if (!redis) {
    local.__geminiCreditReading = reading;
    return true;
  }
  try {
    await redis.set(KEY, reading);
    return true;
  } catch (err) {
    console.error("[gemini-credit] balance not saved:", err);
    return false;
  }
}

export async function readCreditReading(): Promise<CreditReading | null> {
  if (!redis) return local.__geminiCreditReading ?? null;
  try {
    return await redis.get<CreditReading>(KEY);
  } catch (err) {
    console.error("[gemini-credit] balance unreadable:", err);
    return null;
  }
}

/** The estimate from the last balance typed. Null with none typed, or when the spend can't be read. */
export async function readCreditEstimate(now = new Date()): Promise<CreditEstimate | null> {
  const reading = await readCreditReading();
  if (!reading) return null;
  const db = createAdminClient();
  const spendSince = (from: string) => db.rpc("api_spend_by_unit", { p_from: from, p_to: now.toISOString() });
  const [since, week] = await Promise.all([
    spendSince(reading.at),
    spendSince(new Date(now.getTime() - 7 * DAY_MS).toISOString()),
  ]);
  if (logReadError("gemini credit: spend since the balance", since).error) return null;
  if (logReadError("gemini credit: last week's spend", week).error) return null;
  return estimateCredit(reading, (since.data ?? []) as SpendGroup[], (week.data ?? []) as SpendGroup[]);
}
