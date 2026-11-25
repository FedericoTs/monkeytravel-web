/**
 * Format checks for the PayPal.me, Venmo and Wise handles a user can keep
 * on their profile. PATCH /api/profile runs every handle through
 * isValidPaymentHandle before it is stored.
 */

// =====================================================
// Handle validation regexes
// =====================================================

// PayPal.me: 3-32 chars, letters/digits/period/underscore/hyphen.
// PayPal's published constraint is "letters, numbers, periods, hyphens,
// and underscores; max 32 chars" — we add a 3-char floor to reject
// almost-certainly-invalid stubs that would still 404 on paypal.me.
const PAYPAL_HANDLE_RE = /^[A-Za-z0-9._-]{3,32}$/;

// Venmo: 5-30 chars, letters/digits/period/underscore/hyphen. Venmo's
// signup form enforces the 5-30 range and rejects @ — strip leading
// @ before validating since users habitually paste it.
const VENMO_HANDLE_RE = /^[A-Za-z0-9._-]{5,30}$/;

// Wise: either a wiseTag (@handle) or a longer URL-safe identifier
// (used for "Get paid" public profile pages). 3-64 chars; allow @
// because wiseTags include it.
const WISE_HANDLE_RE = /^@?[A-Za-z0-9._-]{3,64}$/;

// =====================================================
// Helpers
// =====================================================

/**
 * Normalize a raw user-entered handle: trim whitespace, drop a
 * leading "@" (users frequently paste "@alyssa" when they mean
 * "alyssa"). Returns null for empty / null input.
 */
function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@/, "");
  return trimmed.length > 0 ? trimmed : null;
}

// =====================================================
// Validation (the /api/profile PATCH re-validates every
// handle before write)
// =====================================================

/**
 * Validate a handle for the given provider. Strips a leading "@"
 * before checking.
 *
 * Returns true for empty/null input (treating empty as "user clearing
 * the field" — handled separately by the caller as a delete, not an
 * invalid value).
 */
export function isValidPaymentHandle(
  provider: "paypal" | "venmo" | "wise",
  raw: string | null | undefined,
): boolean {
  if (raw == null || raw.trim().length === 0) return true;
  const h = normalizeHandle(raw);
  if (!h) return true;
  switch (provider) {
    case "paypal":
      return PAYPAL_HANDLE_RE.test(h);
    case "venmo":
      return VENMO_HANDLE_RE.test(h);
    case "wise":
      return WISE_HANDLE_RE.test(h);
  }
}

/** Provider key list, iterated by the PATCH /api/profile allowlist. */
export const PAYMENT_PROVIDERS = ["paypal", "venmo", "wise"] as const;

