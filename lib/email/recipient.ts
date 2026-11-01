/**
 * Reduce a recipient from Resend's payload to a bare, comparable address.
 *
 * `payload.data.to` carries whatever was on the original envelope, and that
 * is RFC 5322 — "Jane Doe <jane@example.com>" is as valid there as a bare
 * address. Lowercasing alone keeps the display name, and every consumer of
 * this value compares by exact bare address:
 *
 *   - dispatchEmail's suppression check does
 *     .eq("recipient_email", recipient) on a bare lowercase string
 *   - optOutMarketing does .ilike("email", e) against users.email
 *
 * so a display-name form matches NEITHER. The bounce is recorded and looks
 * fine in the table while suppressing nothing.
 */
export function normalizeRecipient(raw: string): string {
  const trimmed = (raw ?? "").trim();
  // Angle-bracket form wins when present; otherwise the whole string is
  // already the address. Deliberately does NOT try to validate — an address
  // we cannot parse is still better stored verbatim than dropped.
  const angle = trimmed.match(/<([^>]+)>/);
  return (angle ? angle[1] : trimmed).toLowerCase().trim();
}
