import { tripSpanDays } from "@/lib/dates/iso-date";

// Exact copy of DESTINATION_ALLOWLIST in lib/gemini.ts — letters, spaces,
// hyphens, commas, dots, parentheses, apostrophes, &, /, digits.
export const DESTINATION_ALLOWLIST = /^[\p{L}\p{M}\s\-,.'()&/0-9]+$/u;
// The server's destination length rule (lib/gemini.ts validateTripParams).
// Unmirrored, a pasted prompt passes the gate, starts generating, and bounces
// off the server with an untranslated "Destination name too long" behind a
// Retry button that resends the same text. Keep it at 100, exactly where the
// server puts it: a lower bound would block names that generate fine.
export const DESTINATION_MAX_LENGTH = 100;

export type DestinationProblem = "short" | "long" | "chars";

/** The first of the server's destination rules the text breaks, or null. */
export function destinationProblem(destination: string): DestinationProblem | null {
  if (destination.length < 2) return "short";
  if (destination.length > DESTINATION_MAX_LENGTH) return "long";
  if (!DESTINATION_ALLOWLIST.test(destination)) return "chars";
  return null;
}

export type Step1Blocker = DestinationProblem | "too_many_days" | "dates";

/**
 * What still keeps step 1 from going on: the destination first, then the
 * dates, each as lib/gemini.ts validateTripParams would refuse it at generate
 * time. The span is day-inclusive (the server's math): at least two days and
 * at most `maxDays`. Null when nothing does.
 */
export function step1Blocker(
  destination: string,
  startDate: string,
  endDate: string,
  maxDays: number
): Step1Blocker | null {
  const problem = destinationProblem(destination);
  if (problem) return problem;
  const span = tripSpanDays(startDate, endDate);
  if (span > maxDays) return "too_many_days";
  return span < 2 ? "dates" : null;
}
