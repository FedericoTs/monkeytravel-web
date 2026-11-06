import type { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/api/rate-limit";

// Well above a normal day, and below the Gemini API's own daily limit, so abuse
// from anonymous visitors stops before it uses up what signed-in people need.
const ANON_AI_CALLS_PER_DAY = 300;

const limiter = createRateLimiter("gemini-anon-day", ANON_AI_CALLS_PER_DAY, 24 * 60 * 60 * 1000);

/** Counts an anonymous AI call against today's total, across every visitor. A limiter error never blocks one. */
export async function withinAnonDailyLimit(request: NextRequest): Promise<boolean> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    return (await limiter.check(request, today)).allowed;
  } catch {
    return true;
  }
}
