/**
 * A name that is safe to show publicly (a trip's Explore byline), or null.
 *
 * The email's local part never is: for gmail, local part + "@gmail.com" IS the
 * address, and a byline that falls back to it when the sign-in metadata
 * carries no display_name (every Google account) publishes the address.
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
