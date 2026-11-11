/**
 * Where the traveller is staying, in their words: a hotel, an address or an
 * area. It goes into the plan's prompt as one line, so it is kept to one line,
 * without control characters, and short.
 */
export const STAY_NAME_MAX = 120;

/** The stay as one clean line, or "" when nothing is left of it. */
export function cleanStayName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STAY_NAME_MAX)
    .trim();
}
