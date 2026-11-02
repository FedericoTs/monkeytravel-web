/**
 * A duration in minutes as a short string: an activity's length, a travel
 * leg, a day's planned time. "min" and "h" read the same in every language
 * the app speaks, so there is one spelling:
 *  - 0    → "0 min"
 *  - 12   → "12 min"
 *  - 83   → "1 h 23 min"
 *  - 120  → "2 h"
 */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) {
    return `${safe} min`;
  }
  const hours = Math.floor(safe / 60);
  const rem = safe % 60;
  if (rem === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${rem} min`;
}
