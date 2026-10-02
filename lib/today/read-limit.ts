import "server-only";
import type { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * Today's reads (taps, expenses, feed) by one visitor on one trip. Open
 * screens refresh at most every few seconds (refresh-throttle); this caps
 * someone calling the routes directly. Generous, because visitors without an
 * account or a cookie share their network address's allowance.
 */
const limiter = createRateLimiter("today-read", 300, 60_000);

/** `visitor` is the account or browser cookie; without one, the address is used. */
export async function allowTodayRead(request: NextRequest, trip: string, visitor: string | null | undefined): Promise<boolean> {
  const { allowed } = await limiter.check(request, visitor ? `${visitor}:${trip}` : undefined);
  return allowed;
}
