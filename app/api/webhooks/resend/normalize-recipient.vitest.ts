/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { normalizeRecipient } from "./route";

/**
 * Guards the suppression key.
 *
 * Resend's webhook payload carries `to` as it appeared on the envelope, and
 * RFC 5322 allows a display name there. The handler previously stored
 * `recipient.toLowerCase().trim()`, which keeps the display name — while both
 * consumers compare by bare address:
 *
 *   lib/email/send.ts     .eq("recipient_email", recipient)
 *   optOutMarketing       .ilike("email", e)
 *
 * so "ann bernier <ann.bernier@gmail.com>" matched neither. Production held
 * exactly one such row (fixed 2026-08-27): a hard bounce for a registered
 * user that had never suppressed a single send. The row LOOKED right in the
 * table, which is why nothing surfaced it.
 *
 * The cost is asymmetric — a false suppression drops mail to a good address,
 * a missed one torches domain reputation — so the display-name cases matter
 * more than they look.
 */

describe("normalizeRecipient", () => {
  it("extracts the address from a display-name form", () => {
    // The exact production row.
    expect(normalizeRecipient("ann bernier <ann.bernier@gmail.com>")).toBe(
      "ann.bernier@gmail.com"
    );
  });

  it("handles a quoted display name", () => {
    expect(normalizeRecipient('"Bernier, Ann" <Ann.Bernier@Gmail.com>')).toBe(
      "ann.bernier@gmail.com"
    );
  });

  it("leaves a bare address alone apart from case and space", () => {
    expect(normalizeRecipient("  Ann.Bernier@Gmail.com  ")).toBe(
      "ann.bernier@gmail.com"
    );
  });

  it("lowercases so the exact-match lookup can hit", () => {
    // dispatchEmail lowercases its side before comparing; if only one side
    // is normalised the match still fails.
    expect(normalizeRecipient("NOREPLY@MonkeyTravel.APP")).toBe(
      "noreply@monkeytravel.app"
    );
  });

  it("returns empty for empty-ish input rather than throwing", () => {
    // Callers branch on falsy; a throw here would 500 the webhook and make
    // Resend retry a poison payload forever.
    for (const raw of ["", "   "]) {
      expect(normalizeRecipient(raw)).toBe("");
    }
    expect(normalizeRecipient(undefined as unknown as string)).toBe("");
    expect(normalizeRecipient(null as unknown as string)).toBe("");
  });

  it("keeps an unparseable value verbatim instead of dropping it", () => {
    // Storing something odd beats storing nothing: a row we can still see is
    // debuggable, a dropped bounce is invisible.
    expect(normalizeRecipient("not-an-address")).toBe("not-an-address");
  });

  it("takes the bracketed address when both forms are present", () => {
    // Some senders emit "addr@x.com <addr@x.com>".
    expect(normalizeRecipient("ann@x.com <ann@x.com>")).toBe("ann@x.com");
  });

  it("is idempotent — normalising twice changes nothing", () => {
    // The backfill ran this transformation over stored rows; re-running the
    // webhook over an already-clean value must not corrupt it.
    const once = normalizeRecipient("Ann Bernier <ann.bernier@gmail.com>");
    expect(normalizeRecipient(once)).toBe(once);
  });
});
