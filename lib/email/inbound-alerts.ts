/**
 * Which inbound mail deserves to wake a human.
 *
 * The root MX for monkeytravel.app is a CATCH-ALL, so every address at the
 * domain resolves and lands in Resend's inbound store. The webhook forwards a
 * `[inbox]` alert to a human for anything that arrives — which is the right
 * default for privacy@ / legal@ / support@, where a GDPR erasure request
 * carries a 30-day statutory clock.
 *
 * DMARC aggregate reports are the exception, and they are not a trickle.
 */

/**
 * The mailbox named in the `rua=` tag of the _dmarc TXT record.
 *
 * Kept as a constant rather than inlined so the DNS record and the suppression
 * rule cannot drift apart silently: if `rua=` is ever repointed, this is the
 * one place to change, and the tests name the same address.
 */
export const DMARC_RUA_MAILBOX = "dmarc@monkeytravel.app";

/** `"DMARC Reports" <dmarc@…>` → `dmarc@…`; a bare address passes through. */
function extractAddress(recipient: string): string {
  const angled = recipient.match(/<([^>]+)>/);
  return (angled ? angled[1] : recipient).trim().toLowerCase();
}

/**
 * True when an inbound message is a DMARC aggregate report.
 *
 * Matched on RECIPIENT, not sender or subject. The sender is a different
 * provider every time (google.com, microsoft.com, yahoo.com, and a long tail
 * of smaller reporters), and while RFC 7489 §7.2.1.1 recommends a
 * `Report domain: … Submitter: … Report-ID: …` subject, it is only a
 * recommendation and reporters do deviate. The recipient is the one field we
 * control: we chose the address, we published it in `rua=`, and nothing else
 * writes to it.
 *
 * The comparison is deliberately EXACT on the domain rather than a substring.
 * A substring test looks equivalent and is not: `dmarc@monkeytravel.app` is a
 * prefix of `dmarc@monkeytravel.app.evil.com`, so a substring rule would let
 * any outsider mute our ops alerting just by choosing that recipient. The
 * local part is compared with its `+tag` stripped, so a future
 * `dmarc+google@…` still matches without loosening the domain check.
 */
export function isDmarcReport(to: string[] | undefined): boolean {
  const [ruaLocal, ruaDomain] = DMARC_RUA_MAILBOX.split("@");

  return (to ?? []).some((recipient) => {
    const [local, domain] = extractAddress(String(recipient)).split("@");
    if (!local || !domain) return false;
    return domain === ruaDomain && local.split("+")[0] === ruaLocal;
  });
}
