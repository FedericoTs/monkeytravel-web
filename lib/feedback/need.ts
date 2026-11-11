/**
 * The pre-trip reminders' one question: what do you still need for this trip?
 *
 * Closed answers so they add up, in the order they're asked. Each names a part
 * of the trip we could do more for, and "set" lets someone say nothing's
 * missing. Answers live in user_feedback.extra (`need`, `need_note`), one row
 * per answer like "did you go?", and the newest row for a trip is its answer.
 */
import { latestTripAnswers } from "./trip-answers";

export const NEED_ANSWERS = ["stay", "transport", "book", "phone", "group", "set"] as const;
export type NeedAnswer = (typeof NEED_ANSWERS)[number];

export function isNeedAnswer(value: unknown): value is NeedAnswer {
  return NEED_ANSWERS.includes(value as NeedAnswer);
}

/** Each trip's answer, from rows ordered newest first. */
export function latestNeedAnswers(
  rows: readonly { extra?: Record<string, unknown> | null }[],
): Map<string, NeedAnswer> {
  return latestTripAnswers(rows, "need", isNeedAnswer);
}
