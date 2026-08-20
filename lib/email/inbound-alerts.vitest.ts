import { describe, it, expect } from "vitest";
import { isDmarcReport, DMARC_RUA_MAILBOX } from "./inbound-alerts";

/**
 * Guards the suppression rule that keeps DMARC aggregate reports out of the
 * human ops inbox.
 *
 * Both directions matter and the failure modes are asymmetric:
 *
 *   - Too NARROW → hundreds of empty `[inbox]` alerts a year, one Resend send
 *     each. Loud and expensive, but self-announcing.
 *   - Too BROAD → a real GDPR erasure request to privacy@ is swallowed
 *     silently against a 30-day statutory clock. Quiet and serious.
 *
 * The over-broad cases are therefore the ones worth being exhaustive about.
 */
describe("isDmarcReport", () => {
  it("suppresses the plain rua= mailbox", () => {
    expect(isDmarcReport([DMARC_RUA_MAILBOX])).toBe(true);
  });

  it("suppresses regardless of case", () => {
    expect(isDmarcReport(["DMARC@MonkeyTravel.app"])).toBe(true);
  });

  it("suppresses display-name wrapped recipients", () => {
    expect(isDmarcReport([`"DMARC Reports" <${DMARC_RUA_MAILBOX}>`])).toBe(true);
  });

  it("suppresses +tag addressing (tag goes before the @, per RFC 5233)", () => {
    expect(isDmarcReport(["dmarc+google.com@monkeytravel.app"])).toBe(true);
  });

  it("suppresses when dmarc@ is one of several recipients", () => {
    expect(isDmarcReport(["support@monkeytravel.app", DMARC_RUA_MAILBOX])).toBe(true);
  });

  // ── Must NOT suppress ──────────────────────────────────────────────────
  // The catch-all means every one of these is a real address that a real
  // person can write to, and privacy@/legal@ carry legal deadlines.

  it.each([
    "privacy@monkeytravel.app",
    "legal@monkeytravel.app",
    "support@monkeytravel.app",
    "hello@monkeytravel.app",
    "feedback@monkeytravel.app",
    "noreply@monkeytravel.app",
  ])("does not suppress %s", (address) => {
    expect(isDmarcReport([address])).toBe(false);
  });

  it("does not suppress a local part that merely ends in dmarc", () => {
    expect(isDmarcReport(["notdmarc@monkeytravel.app"])).toBe(false);
  });

  it("does not suppress a lookalike mailbox on a foreign domain", () => {
    // The regression this file exists for. `dmarc@monkeytravel.app` is a
    // PREFIX of `dmarc@monkeytravel.app.evil.com`, so a substring rule — the
    // obvious first implementation — would let any outsider mute our ops
    // alerting simply by choosing that recipient. The domain must match
    // exactly.
    expect(isDmarcReport(["dmarc@monkeytravel.app.evil.com"])).toBe(false);
    expect(isDmarcReport(["dmarc@example.com"])).toBe(false);
    expect(isDmarcReport(["dmarc@notmonkeytravel.app"])).toBe(false);
  });

  it("handles missing and empty recipient lists", () => {
    expect(isDmarcReport(undefined)).toBe(false);
    expect(isDmarcReport([])).toBe(false);
  });
});
