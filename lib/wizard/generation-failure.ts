/**
 * Why did a generation fail?
 *
 * A failed generation used to leave nothing behind that anyone could count.
 * `abandoned` cannot follow `generating` (wizardCompletedRef is set before the
 * request fires), and no failure step existed — so the 22 sessions in the 30
 * days to 2026-09-02 that reached `generating` and never reached `result` were
 * indistinguishable, in the funnel, from someone closing their laptop.
 *
 * This turns the thrown error into one of a few buckets that imply different
 * fixes, so the next person can act on a count instead of a stack trace:
 *
 *   validation  we sent something the server refuses — OUR bug, since the
 *               client is supposed to mirror those rules (the >100-character
 *               destination is exactly this)
 *   rate_limit  the anonymous cap; a product decision, not a defect
 *   timeout     the model took too long
 *   network     the request never completed — offline, tab closed mid-flight
 *   upstream    the server or the model errored
 *   unknown     none of the above; if this bucket grows, the list is wrong
 *
 * Matching is on message text because that is all the client is given. It is
 * deliberately conservative: anything unrecognised stays `unknown` rather than
 * being forced into a neighbouring bucket, since a wrong label here is worse
 * than an honest "we do not know".
 */

export type GenerationFailureCode =
  | "validation"
  | "rate_limit"
  | "timeout"
  | "network"
  | "upstream"
  | "unknown";

/** Server validation copy from lib/gemini.ts validateTripParams, plus the client's own. */
const VALIDATION = [
  "destination name too long",
  "destination is required",
  "destination contains invalid characters",
  "invalid date",
  "trip is too long",
  "end date must be after",
  "maximum trip length",
];
const RATE_LIMIT = ["rate_limit", "rate limit", "too many requests", "429", "daily limit", "quota"];
const TIMEOUT = ["timeout", "timed out", "aborted", "aborterror"];
const NETWORK = ["failed to fetch", "networkerror", "network request failed", "load failed", "err_internet"];
const UPSTREAM = ["500", "502", "503", "504", "internal server error", "upstream", "model", "gemini", "unavailable"];

const has = (haystack: string, needles: string[]) => needles.some((n) => haystack.includes(n));

export function classifyGenerationFailure(err: unknown): GenerationFailureCode {
  const raw =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === "string"
        ? err
        : "";
  const text = raw.toLowerCase().trim();
  if (!text) return "unknown";

  // Order matters. Validation first: those messages are the ones we can fix by
  // mirroring a rule, and some of them also contain words that appear in the
  // vaguer buckets below.
  if (has(text, VALIDATION)) return "validation";
  if (has(text, RATE_LIMIT)) return "rate_limit";
  if (has(text, TIMEOUT)) return "timeout";
  if (has(text, NETWORK)) return "network";
  if (has(text, UPSTREAM)) return "upstream";
  return "unknown";
}
