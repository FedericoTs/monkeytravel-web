/**
 * Validate a 'next' / 'redirect' query param so OAuth callbacks and post-
 * auth redirects can't be turned into authenticated open-redirects.
 *
 * Attack closed:
 *   GET /auth/callback?next=https://evil.com
 *   GET /auth/login?redirect=//evil.com
 * Both used to flow straight into `NextResponse.redirect(next)` /
 * `router.push(redirect)`, taking an already-trusted post-login user
 * onto an attacker-controlled clone — high-confidence phishing primitive.
 *
 * Rules (kept deliberately conservative — easier to widen later than to
 * narrow without breaking real flows):
 *  - Must be a string.
 *  - Must start with '/' (single slash; relative path).
 *  - Must NOT start with '//' or '/\\' — protocol-relative URLs that
 *    browsers resolve against the current scheme: `//evil.com` →
 *    `https://evil.com`.
 *  - Must NOT contain '\\' anywhere — IE/Edge legacy and some embedded
 *    WebViews fold backslashes into forward slashes, so `/\\evil.com`
 *    becomes `//evil.com` after normalization. Cheap to ban outright.
 *  - Must NOT contain a scheme (`://`) — defence against `/x://evil.com`
 *    style payloads that aren't caught by the leading-slash check but
 *    have been used historically against URL parsers.
 *  - Must NOT contain control characters (\r, \n, \t) — header injection
 *    surface for the Location header that NextResponse.redirect writes.
 *
 * NOTE: we intentionally do NOT use `new URL(next, origin)` to extract a
 * pathname. `new URL('//evil.com', 'https://monkeytravel.app')` yields
 * `https://evil.com/` — the constructor itself is the attack surface
 * here, so allowlist on the raw string instead.
 */
export function isSafeNext(next: string | null | undefined): next is string {
  if (typeof next !== "string" || next.length === 0) return false;
  // Hard length cap — Location header can't be unbounded and a 4 KB next=
  // is always an attack, never a real flow.
  if (next.length > 2048) return false;
  // Reject control chars (CR/LF/tab + the whole C0 + DEL range). These
  // would let an attacker inject a second header or terminate the
  // Location value early.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(next)) return false;
  // Reject any backslash — see rule above.
  if (next.includes("\\")) return false;
  // Must be a relative path rooted at /.
  if (!next.startsWith("/")) return false;
  // Reject protocol-relative URLs.
  if (next.startsWith("//")) return false;
  // Reject `/x://evil.com` style — anything containing `://` is suspect.
  if (next.includes("://")) return false;
  return true;
}

/**
 * Return `next` if it passes `isSafeNext`, otherwise the fallback path.
 * Caller stays responsible for any locale-prefixing it does after.
 *
 * @example
 *   const next = searchParams.get("next");
 *   return NextResponse.redirect(`${origin}${safeNextOrDefault(next, "/trips")}`);
 */
export function safeNextOrDefault(
  next: string | null | undefined,
  fallback: string = "/",
): string {
  return isSafeNext(next) ? next : fallback;
}
