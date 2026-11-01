/**
 * What the trip assistant panel says when a request fails, as a message key
 * under common.ai.assistant.errors and its values. The routes' own error
 * text is English and stays in the logs; the panel speaks from these codes.
 */

export type AssistantErrorKey =
  | "limitDay"
  | "limitMonth"
  | "notAllowed"
  | "datesOwnerOnly"
  | "outdated"
  | "locked"
  | "tooManyDays";

/** The `code` values the assistant routes send with an error. */
export const ASSISTANT_ERROR_CODES = {
  notAllowed: "NOT_ALLOWED",
  datesOwnerOnly: "DATES_OWNER_ONLY",
  outdated: "OUTDATED",
  locked: "LOCKED",
  tooManyDays: "TOO_MANY_DAYS",
} as const;

/** The message for a failed response, or null when only the generic one fits. */
export function assistantErrorMessage(
  status: number,
  body: unknown,
): { key: AssistantErrorKey; values?: Record<string, string | number> } | null {
  const b = (body && typeof body === "object" ? body : {}) as {
    code?: unknown;
    names?: unknown;
    max?: unknown;
    usage?: { periodType?: unknown };
  };
  if (status === 429) return { key: b.usage?.periodType === "monthly" ? "limitMonth" : "limitDay" };
  switch (b.code) {
    case ASSISTANT_ERROR_CODES.notAllowed:
      return { key: "notAllowed" };
    case ASSISTANT_ERROR_CODES.datesOwnerOnly:
      return { key: "datesOwnerOnly" };
    case ASSISTANT_ERROR_CODES.outdated:
      return { key: "outdated" };
    case ASSISTANT_ERROR_CODES.locked: {
      const names = Array.isArray(b.names) ? b.names.filter((n) => typeof n === "string").slice(0, 3) : [];
      return { key: "locked", values: { names: names.join(", ") } };
    }
    case ASSISTANT_ERROR_CODES.tooManyDays:
      return typeof b.max === "number" ? { key: "tooManyDays", values: { max: b.max } } : null;
  }
  return null;
}
