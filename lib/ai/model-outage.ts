/**
 * Google refuses every call while the project's prepaid credits are used up, so no
 * try can work until someone tops them up. The generation routes answer these words
 * instead of "try again", and the wizard recognises them
 * (lib/wizard/generation-failure.ts). Client-safe.
 */
export const MODEL_OUTAGE_MESSAGE = "The trip planner is temporarily unavailable";

/** Sent with that answer by every AI route, so its page can say so in the traveller's language. */
export const MODEL_OUTAGE_CODE = "MODEL_OUTAGE";

export function isModelOutOfCredit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /prepayment credits|"code":\s*402\b/.test(message);
}

/** Whether a failed AI response says the model is out of service. */
export function isModelOutageResponse(body: unknown): boolean {
  return (body as { code?: unknown } | null | undefined)?.code === MODEL_OUTAGE_CODE;
}
