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
  /** The use counted last, when it came with an id. */
  lastUse?: string;
}

function parseCookie(raw: string | undefined): CookieState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CookieState>;
    if (typeof parsed.used !== "number" || typeof parsed.resetAt !== "number") {
      return null;
    }
    return {
      used: parsed.used,
      resetAt: parsed.resetAt,
      ...(typeof parsed.lastUse === "string" ? { lastUse: parsed.lastUse } : {}),
    };
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
   * nothing. The use counted last is still allowed at the limit when asked
   * under its `useId`: it is the same use, asked of a second endpoint.
   */
  async function check(useId?: string): Promise<CookieQuotaResult> {
    const store = await cookies();
    const now = Date.now();
    const state = parseCookie(store.get(cookie)?.value);

    // Fresh visitor OR previous window expired → allow with full quota
    if (!state || state.resetAt < now) {
      return { allowed: true, used: 0, limit, resetAt: now + windowMs };
    }

    if (state.used >= limit && !(useId && state.lastUse === useId)) {
      const hoursUntilReset = Math.ceil((state.resetAt - now) / (60 * 60 * 1000));
      return { allowed: false, used: state.used, limit, resetAt: state.resetAt, message: blockedMessage(hoursUntilReset) };
    }

    return { allowed: true, used: state.used, limit, resetAt: state.resetAt };
  }

  /**
   * Count one use, once only when it comes with an id. Starts a fresh window
   * when the previous one expired.
   */
  async function record(useId?: string): Promise<void> {
    const store = await cookies();
    const now = Date.now();
    const prev = parseCookie(store.get(cookie)?.value);
    const current = prev && prev.resetAt >= now ? prev : null;
    if (useId && current?.lastUse === useId) return;
    write(store, {
      used: (current?.used ?? 0) + 1,
      resetAt: current?.resetAt ?? now + windowMs,
      ...(useId ? { lastUse: useId } : {}),
    });
  }

  /** Give back the use counted under `useId`, which delivered nothing. Any other use stays counted. */
  async function refund(useId: string): Promise<void> {
    const store = await cookies();
    const prev = parseCookie(store.get(cookie)?.value);
    if (!prev || prev.resetAt < Date.now() || prev.lastUse !== useId) return;
    write(store, { used: prev.used - 1, resetAt: prev.resetAt });
  }

  function write(store: Awaited<ReturnType<typeof cookies>>, state: CookieState) {
    store.set({
      name: cookie,
      value: JSON.stringify(state),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      // Cookie lifetime matches the rate window so an idle browser doesn't
      // accumulate dead state.
      maxAge: Math.ceil(windowMs / 1000),
      path: "/",
    });
  }

  return { check, record, refund };
}
