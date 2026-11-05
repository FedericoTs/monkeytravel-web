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
import { cookieQuota } from "./cookie-quota";

// Enough for a multi-destination exploration session in one sitting while
// still nudging signup. The "you've used your N free trips" copy reads this
// constant, so changing it keeps the message true.
const MAX_GENERATIONS_PER_WINDOW = 5;

const generations = cookieQuota({
  cookie: "mt_anon",
  limit: MAX_GENERATIONS_PER_WINDOW,
  windowMs: 24 * 60 * 60 * 1000,
  blockedMessage: (hours) =>
    `You've used your ${MAX_GENERATIONS_PER_WINDOW} free trips for today. Sign up to keep generating (it's still free), or come back in ${hours}h.`,
});

/**
 * Check whether an anonymous request should be allowed. Does NOT mutate the
 * counter, so a request that fails validation doesn't spend the visitor's
 * quota. Given the request's generation id, a try the stream already counted
 * still reaches the JSON endpoint it falls back to.
 */
export const checkAnonymousRateLimit = generations.check;

/** Count an anonymous generation, once per generation id. */
export const recordAnonymousGeneration = generations.record;

/** Give back the generation counted under this id: it brought no plan. */
export const refundAnonymousGeneration = generations.refund;
