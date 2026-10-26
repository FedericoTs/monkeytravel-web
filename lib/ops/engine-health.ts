/** The plan engine over the last stretch of minutes (engine_health() in the database). */
export interface EngineHealth {
  minutes: number;
  /** Generation requests the server logged, and how many of them failed. */
  requests: number;
  errors: number;
  /** Planners who started a generation, and how many saw it fail. */
  client_generating: number;
  client_failed: number;
  /** Successful generations in the last three hours. */
  ok_last_3h: number;
}

export type EngineVerdict = { ok: true } | { ok: false; reasons: string[] };

// Below this many tries a ratio says nothing.
const MIN_SAMPLE = 5;
const MAX_FAILURE_RATE = 0.2;

/** Whether the engine is failing the people using it, and how, in plain words. */
export function engineVerdict(h: EngineHealth): EngineVerdict {
  const reasons: string[] = [];
  if (h.requests >= MIN_SAMPLE && h.errors / h.requests >= MAX_FAILURE_RATE) {
    reasons.push(`${h.errors} of ${h.requests} generation requests failed in the last ${h.minutes} min.`);
  }
  if (h.client_generating >= MIN_SAMPLE && h.client_failed / h.client_generating >= MAX_FAILURE_RATE) {
    reasons.push(`${h.client_failed} of ${h.client_generating} planners saw their generation fail in the last ${h.minutes} min.`);
  }
  if (h.client_generating >= MIN_SAMPLE && h.ok_last_3h === 0) {
    reasons.push(`${h.client_generating} planners started a generation in the last ${h.minutes} min, and none has succeeded for 3 hours.`);
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}
