/**
 * The emails' one-tap questions about a trip keep one user_feedback row per
 * answer: a tap, then a note sent after it, adds a second row. Rows come newest
 * first, so a trip's first row with a valid answer is its answer.
 */
export function latestTripAnswers<T extends string>(
  rows: readonly { extra?: Record<string, unknown> | null }[],
  key: string,
  isAnswer: (value: unknown) => value is T,
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const { extra } of rows) {
    const trip = extra?.trip_id;
    const answer = extra?.[key];
    if (typeof trip !== "string" || latest.has(trip) || !isAnswer(answer)) continue;
    latest.set(trip, answer);
  }
  return latest;
}
