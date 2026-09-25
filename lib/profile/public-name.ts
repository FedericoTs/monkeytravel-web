/**
 * A name that is safe to show publicly (a trip's Explore byline), or null.
 *
 * The email's local part never is: for gmail, local part + "@gmail.com" IS the
 * address. On 2026-09-25, 62 of the 70 public trips of real users showed
 * exactly that as their byline, because the trip page fell back to it when the
 * sign-in metadata carried no display_name (every Google account) and the
 * share prompt published with it silently. Same leak class as the
 * display_name backfill of 2026-09-01.
 */
export function publicNameOrNull(
  name: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.includes("@")) return null;
  const localPart = email?.split("@")[0]?.trim().toLowerCase();
  if (localPart && trimmed.toLowerCase() === localPart) return null;
  return trimmed;
}
