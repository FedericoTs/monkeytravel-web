/**
 * Whether a cookie holds a Supabase session (`sb-<ref>-auth-token`, possibly
 * chunked as `.0`, `.1`, ...). Starting a sign-in sets verifier cookies named
 * `sb-<ref>-auth-token-...-code-verifier`, which stay when it isn't finished
 * and are not a session.
 */
export function isSessionCookieName(name: string): boolean {
  return /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/.test(name);
}

/**
 * Whether this browser holds a Supabase session cookie. A presence check only:
 * whether the session is valid is for the Supabase client to decide. Without
 * one there is no user to look up, so callers can skip loading that client at
 * all.
 */
export function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((cookie) => isSessionCookieName(cookie.split("=")[0].trim()));
}
