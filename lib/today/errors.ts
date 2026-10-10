/**
 * Why a Today write failed, as a key under common.today.errors. The routes
 * explain in English for the logs, so the screen picks its own words from the
 * status instead of showing theirs.
 */
export type TodayErrorKey = "failed" | "rateLimited" | "amount";

export function todayErrorKey(status: number): TodayErrorKey {
  return status === 429 ? "rateLimited" : "failed";
}

/** Thrown by a Today write the server refused. */
export class TodayWriteError extends Error {
  readonly key: TodayErrorKey;

  constructor(key: TodayErrorKey) {
    super(key);
    this.key = key;
  }
}
