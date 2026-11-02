/**
 * A per-browser quota kept in an httpOnly cookie: `limit` uses per window,
 * the window starting at the first use. Best-effort by design: clearing
 * cookies resets it, which is why the routes also apply a per-IP limit.
 */
import { cookies } from "next/headers";

export interface CookieQuotaResult {
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

export function cookieQuota(opts: {
  cookie: string;
  limit: number;
  windowMs: number;
  /** What a blocked visitor reads, given the hours until the window resets. */
  blockedMessage: (hoursUntilReset: number) => string;
}) {
  const { cookie, limit, windowMs, blockedMessage } = opts;

  /**
   * Whether one more use is allowed. Does NOT count it: call record() after
   * the use succeeds, so a request that fails for another reason spends
   * nothing.
   */
  async function check(): Promise<CookieQuotaResult> {
    const store = await cookies();
    const now = Date.now();
    const state = parseCookie(store.get(cookie)?.value);

    // Fresh visitor OR previous window expired → allow with full quota
    if (!state || state.resetAt < now) {
      return { allowed: true, used: 0, limit, resetAt: now + windowMs };
    }

    if (state.used >= limit) {
      const hoursUntilReset = Math.ceil((state.resetAt - now) / (60 * 60 * 1000));
      return { allowed: false, used: state.used, limit, resetAt: state.resetAt, message: blockedMessage(hoursUntilReset) };
    }

    return { allowed: true, used: state.used, limit, resetAt: state.resetAt };
  }

  /** Count one use. Starts a fresh window when the previous one expired. */
  async function record(): Promise<void> {
    const store = await cookies();
    const now = Date.now();
    const prev = parseCookie(store.get(cookie)?.value);
    const next: CookieState =
      prev && prev.resetAt >= now
        ? { used: prev.used + 1, resetAt: prev.resetAt }
        : { used: 1, resetAt: now + windowMs };

    store.set({
      name: cookie,
      value: JSON.stringify(next),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      // Cookie lifetime matches the rate window so an idle browser doesn't
      // accumulate dead state.
      maxAge: Math.ceil(windowMs / 1000),
      path: "/",
    });
  }

  return { check, record };
}
