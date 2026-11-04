import { tripSpanDays } from "@/lib/dates/iso-date";
import { DESTINATION_ALLOWLIST, DESTINATION_MAX_LENGTH, DESTINATION_MIN_LENGTH } from "@/lib/trips/request-limits";

// The gate applies the server's destination rules. Left to the server alone,
// a pasted prompt starts generating and bounces off with an untranslated
// "Destination name too long" behind a Retry button that resends the same text.

export type DestinationProblem = "short" | "long" | "chars";

/** The first of the server's destination rules the text breaks, or null. */
export function destinationProblem(destination: string): DestinationProblem | null {
  if (destination.length < DESTINATION_MIN_LENGTH) return "short";
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
