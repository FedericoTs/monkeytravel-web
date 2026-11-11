/**
 * The return email's one question: did the trip happen?
 *
 * Answers live in user_feedback.extra, one row per answer: a second tap, or the
 * reason given after the first, adds a row, and the newest row for a trip is
 * the answer.
 */
import { latestTripAnswers } from "./trip-answers";

export const WENT_ANSWERS = ["yes", "no"] as const;
export type WentAnswer = (typeof WENT_ANSWERS)[number];

/** Closed sets, so the answers add up. Each has a message `reason_<key>`. */
export const WENT_REASONS = {
  yes: ["none", "closed", "packed", "times", "other"],
  no: ["changed", "elsewhere", "later", "plan", "other"],
} as const satisfies Record<WentAnswer, readonly string[]>;

export function isWentAnswer(value: unknown): value is WentAnswer {
  return WENT_ANSWERS.includes(value as WentAnswer);
}

export function isWentReason(answer: WentAnswer, value: unknown): value is string {
  return (WENT_REASONS[answer] as readonly string[]).includes(value as string);
}

/** Each trip's answer, from rows ordered newest first. */
export function latestWentAnswers(
  rows: readonly { extra?: Record<string, unknown> | null }[],
): Map<string, WentAnswer> {
  return latestTripAnswers(rows, "went", isWentAnswer);
}
