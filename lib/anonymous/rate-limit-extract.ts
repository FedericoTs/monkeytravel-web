/**
 * Anonymous rate limit for the "Start Anywhere" extraction endpoint.
 *
 * Separate from the trip-generation cookie (mt_anon, 2/24h) so a user
 * who tries 8 photos before finding one that works doesn't burn their
 * generation quota. Extraction is cheaper than full generation
 * (~$0.002 vs ~$0.003 per call) so we can be more generous.
 *
 * 10 extractions per 24h per cookie is enough for genuine exploration
 * without inviting batch-scraping abuse. Best-effort — cookie clearing
 * bypasses it, matching the rest of the anonymous primitives.
 */
import { cookies } from "next/headers";

const COOKIE_NAME = "mt_anon_extract";
const MAX_PER_WINDOW = 10;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ExtractRateLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
  resetAt: number;
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
    if (typeof parsed.used !== "number" || typeof parsed.resetAt !== "number") return null;
    return { used: parsed.used, resetAt: parsed.resetAt };
  } catch {
    return null;
  }
}

export async function checkExtractRateLimit(): Promise<ExtractRateLimitResult> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  const now = Date.now();
  const state = parseCookie(raw);

  if (!state || state.resetAt < now) {
    return { allowed: true, used: 0, limit: MAX_PER_WINDOW, resetAt: now + WINDOW_MS };
  }

  if (state.used >= MAX_PER_WINDOW) {
    const hoursUntilReset = Math.ceil((state.resetAt - now) / (60 * 60 * 1000));
    return {
      allowed: false,
      used: state.used,
      limit: MAX_PER_WINDOW,
      resetAt: state.resetAt,
      message: `You've used your ${MAX_PER_WINDOW} free extractions for today. Sign up to keep using Start Anywhere, or come back in ${hoursUntilReset}h.`,
    };
  }

  return { allowed: true, used: state.used, limit: MAX_PER_WINDOW, resetAt: state.resetAt };
}

export async function recordExtract(): Promise<void> {
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
    maxAge: Math.ceil(WINDOW_MS / 1000),
    path: "/",
  });
}
