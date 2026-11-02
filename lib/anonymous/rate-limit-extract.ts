/**
 * Anonymous rate limit for the "Start Anywhere" extraction endpoint.
 *
 * Separate from the trip-generation cookie (mt_anon) so a user who tries
 * several photos before finding one that works doesn't burn their generation
 * quota. Extraction is cheaper than full generation, so the limit is more
 * generous.
 *
 * 10 extractions per 24h per cookie is enough for genuine exploration
 * without inviting batch-scraping abuse. Best-effort — cookie clearing
 * bypasses it, matching the rest of the anonymous primitives.
 */
import { cookieQuota } from "./cookie-quota";

const MAX_PER_WINDOW = 10;

const extractions = cookieQuota({
  cookie: "mt_anon_extract",
  limit: MAX_PER_WINDOW,
  windowMs: 24 * 60 * 60 * 1000,
  blockedMessage: (hours) =>
    `You've used your ${MAX_PER_WINDOW} free extractions for today. Sign up to keep using Start Anywhere, or come back in ${hours}h.`,
});

export const checkExtractRateLimit = extractions.check;
export const recordExtract = extractions.record;
