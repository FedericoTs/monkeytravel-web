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

/** Server validation copy from lib/gemini.ts validateTripParams and lib/ai/anchors-core.ts validateAnchors, plus the client's own. */
const VALIDATION = [
  "anchor",
  "destination name too long",
  "destination is required",
  "destination contains invalid characters",
  "invalid date",
  "trip is too long",
  "end date must be after",
  "maximum trip length",
  "maximum trip duration",
  "cannot be in the past",
  "invalid characters in",
  "invalid input detected",
  "requirements text too long",
  "must-do",
  "invalid destinations",
  "is before trip start",
  "date must be yyyy-mm-dd",
  "not a valid calendar date",
  "support at most",
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

/** What a validation failure asks the traveller to change. */
export type ValidationFix = "dates" | "duration" | "destination" | "fixed_plans" | "notes" | "other";

export function validationFix(message: string): ValidationFix {
  const text = message.toLowerCase();
  if (has(text, ["support at most", "maximum trip duration", "maximum trip length", "trip is too long"])) return "duration";
  if (text.includes("anchor")) return "fixed_plans";
  if (has(text, ["cannot be in the past", "end date must be after", "invalid date", "is before trip start",
                 "date must be yyyy-mm-dd", "not a valid calendar date"])) return "dates";
  if (text.includes("destination")) return "destination";
  if (has(text, ["requirements", "must-do", "invalid input detected"])) return "notes";
  return "other";
}

/** The wizard step that holds the field to change: notes and must-dos are on step 2. */
export function validationFixStep(fix: ValidationFix): 1 | 2 {
  return fix === "notes" ? 2 : 1;
}

/**
 * The server's own words for a failure the buckets cannot explain (unknown) or
 * that blames the request (validation), so the next one can be read from the
 * table. Quoted values can be what the traveller typed, so they are blanked.
 */
export function failureDetail(err: unknown, code: GenerationFailureCode): string | undefined {
  if (code !== "unknown" && code !== "validation") return undefined;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const detail = message.replace(/"[^"]*"/g, '""').replace(/\s+/g, " ").trim().slice(0, 80);
  return detail || undefined;
}
