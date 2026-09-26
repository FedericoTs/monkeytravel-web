/**
 * Anonymous AI rate limiting
 *
 * Anonymous visitors can generate trips without signing up, so the landing
 * pages' "no signup" promise holds at the moment of peak interest.
 *
 * A cookie-keyed counter allows MAX_GENERATIONS_PER_WINDOW per 24h, then asks
 * the visitor to sign up. Clearing cookies resets it, which is why the
 * generate routes also apply a per-IP limit.
 */
import { cookies } from "next/headers";

const COOKIE_NAME = "mt_anon";
// Enough for a multi-destination exploration session in one sitting while
// still nudging signup. The "you've used your N free trips" copy reads this
// constant, so changing it keeps the message true.
const MAX_GENERATIONS_PER_WINDOW = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface AnonRateLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
  resetAt: number;
  /** Human-readable reason to show the user when blocked */
  message?: string;
}

interface CookieState {
  used: number;
  resetAt: number;
}

function parseCookie(raw: string | undefined): CookieState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CookieState>;
    if (typeof parsed.used !== "number" || typeof parsed.resetAt !== "number") {
      return null;
    }
    return { used: parsed.used, resetAt: parsed.resetAt };
  } catch {
    return null;
  }
}

/**
 * Check whether an anonymous request should be allowed. Does NOT mutate the
 * counter — call `recordAnonymousGeneration()` after a successful generation
 * to increment.
 *
 * Why split check from record: lets the API route abort cleanly on other
 * validation errors without "spending" the user's quota.
 */
export async function checkAnonymousRateLimit(): Promise<AnonRateLimitResult> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  const now = Date.now();

  const state = parseCookie(raw);

  // Fresh visitor OR previous window expired → allow with full quota
  if (!state || state.resetAt < now) {
    return {
      allowed: true,
      used: 0,
      limit: MAX_GENERATIONS_PER_WINDOW,
      resetAt: now + WINDOW_MS,
    };
  }

  // Window still active — check remaining
  if (state.used >= MAX_GENERATIONS_PER_WINDOW) {
    const hoursUntilReset = Math.ceil((state.resetAt - now) / (60 * 60 * 1000));
    return {
      allowed: false,
      used: state.used,
      limit: MAX_GENERATIONS_PER_WINDOW,
      resetAt: state.resetAt,
      message: `You've used your ${MAX_GENERATIONS_PER_WINDOW} free trips for today. Sign up to keep generating (it's still free), or come back in ${hoursUntilReset}h.`,
    };
  }

  return {
    allowed: true,
    used: state.used,
    limit: MAX_GENERATIONS_PER_WINDOW,
    resetAt: state.resetAt,
  };
}

/**
 * Increment the anonymous counter after a successful generation. Safe to
 * call multiple times (writes a fresh window if the previous one expired).
 */
export async function recordAnonymousGeneration(): Promise<void> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  const now = Date.now();

  const prev = parseCookie(raw);
  const inActiveWindow = prev && prev.resetAt >= now;

  const next: CookieState = inActiveWindow
    ? { used: prev.used + 1, resetAt: prev.resetAt }
    : { used: 1, resetAt: now + WINDOW_MS };

  store.set({
    name: COOKIE_NAME,
    value: JSON.stringify(next),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Cookie lifetime matches the rate window so an idle browser doesn't
    // accumulate dead state.
    maxAge: Math.ceil(WINDOW_MS / 1000),
    path: "/",
  });
}
