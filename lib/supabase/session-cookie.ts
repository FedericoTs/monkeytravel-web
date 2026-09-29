/**
 * Whether this browser holds a Supabase session cookie (`sb-<ref>-auth-token`,
 * possibly chunked as `.0`, `.1`, ...). A presence check only: whether the
 * session is valid is for the Supabase client to decide. Without one there is
 * no user to look up, so callers can skip loading that client at all.
 */
export function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)sb-[a-z0-9-]+-auth-token(?:\.\d+)?=/.test(document.cookie);
}
