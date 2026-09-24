/**
 * Showing who an email invite was sent to, without handing the address to
 * whoever holds the link.
 *
 * An invite sent to a specific address can only be accepted by that account
 * (app/api/invites/[token]/route.ts). The invite page therefore has to tell a
 * signed-out visitor WHICH account to use, but invite links get forwarded, so
 * the full address stays private: enough to recognise your own inbox, not
 * enough to learn someone else's.
 */

/** "federico@gmail.com" → "f•••o@gmail.com"; "ab@x.io" → "a•••@x.io". */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const masked = local.length <= 2 ? `${local[0]}•••` : `${local[0]}•••${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}

/** Same comparison the accept route uses. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").toLowerCase().trim();
  const y = (b ?? "").toLowerCase().trim();
  return x.length > 0 && x === y;
}
