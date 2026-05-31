/**
 * Payment handle deeplink builders for the Settle Up view.
 *
 * Each builder takes a recipient handle + amount (+ currency/note) and
 * returns the canonical provider deeplink, OR null if the input is
 * malformed. Returning null (not throwing) keeps the call sites simple:
 * the SettleUpView simply hides a button whose link can't be built.
 *
 * NO backend integration. These links open the provider's native app
 * (or web fallback) where the user completes the payment manually.
 * We never touch the money — we just save the user from retyping the
 * amount, recipient handle, and trip name into another app.
 *
 * Format references:
 *   - PayPal.me:  https://developer.paypal.com/docs/checkout/paypal-me/
 *                 Schema: https://paypal.me/{handle}/{amount}{ISO4217}
 *                 Note: amount + currency are concatenated WITHOUT a
 *                 separator (e.g. "42EUR" not "42 EUR" or "42-EUR").
 *   - Venmo:      venmo://paycharge?txn=pay&recipients=...&amount=...
 *                 Universal link fallback: https://venmo.com/{handle}
 *                 We use the deeplink because it pre-fills the amount;
 *                 the universal link does not.
 *   - Wise:       https://wise.com/pay/me/{handle}?amount=...&currency=...
 *                 The "pay/me" URL is the public-facing payment page
 *                 each Wise user can enable (Wise calls it "Get paid")
 *                 — clicking it lands the payer on a wise.com page
 *                 pre-filled with amount + currency.
 *
 * Validation strategy:
 *   - Handle must match the provider's published rules (see regex
 *     constants below). Anything else returns null.
 *   - Amount must be a finite positive number. Float drift on the cent
 *     value is normalized via toFixed(2).
 *   - Currency must be a 3-letter ISO-4217 alpha code (we don't enforce
 *     the full list — providers do — but we reject obvious garbage).
 *   - Notes / descriptions are passed through encodeURIComponent so
 *     emoji, ampersands, and accented characters all survive intact.
 *
 * SECURITY: every interpolated value is either validated against a
 * narrow regex (handle, currency) or percent-encoded (note). This
 * keeps the deeplink from being weaponized to inject extra query
 * parameters or break out of the path segment.
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
// because wiseTags include it. We strip the leading @ before building
// the URL since wise.com/pay/me/ doesn't want it in the path.
const WISE_HANDLE_RE = /^@?[A-Za-z0-9._-]{3,64}$/;

// ISO 4217: exactly 3 ASCII letters. Real list is curated by the
// provider — we just reject obvious junk like "$" or "eurodollar".
const CURRENCY_RE = /^[A-Za-z]{3}$/;

// =====================================================
// Helpers
// =====================================================

/**
 * Normalize a raw user-entered handle: trim whitespace, drop a
 * leading "@" (users frequently paste "@alyssa" when they mean
 * "alyssa"). Returns null for empty / null input so the build* fns
 * can short-circuit.
 */
function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@/, "");
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Format an amount as a fixed-2-decimal string. PayPal in particular
 * REJECTS amounts with more than 2 decimals (the deeplink silently
 * resets to 0). toFixed handles JS float drift cleanly for the cent
 * level — we don't need BigInt here because the upstream caller
 * already stores amounts as integer cents and converts to decimals
 * only at render time.
 *
 * Returns null for NaN, Infinity, negatives, and zero (a zero
 * transfer is never a valid settle-up — if balances net out, the
 * SettleUpView simply doesn't render a button for that pair).
 */
function formatAmount(amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toFixed(2);
}

/**
 * Encode + validate an ISO-4217 currency code. Always returns the
 * uppercased 3-letter code — PayPal is case-insensitive but Wise's
 * web app respects case in its URL params, so be consistent.
 */
function normalizeCurrency(currency: string | null | undefined): string | null {
  if (!currency) return null;
  const trimmed = currency.trim();
  if (!CURRENCY_RE.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

// =====================================================
// Public API
// =====================================================

/**
 * Build a PayPal.me deeplink.
 *
 *   buildPayPalLink("alyssaperez", 42.5, "EUR")
 *     → "https://paypal.me/alyssaperez/42.50EUR"
 *
 * Returns null if any input is invalid.
 *
 * NOTE on path encoding: the handle is regex-validated so we don't
 * need to encodeURIComponent it (no reserved chars survive the regex).
 * The amount+currency segment is similarly safe by construction —
 * digits, dot, and uppercase letters only.
 */
export function buildPayPalLink(
  handle: string | null | undefined,
  amount: number,
  currency: string | null | undefined,
): string | null {
  const h = normalizeHandle(handle);
  if (!h || !PAYPAL_HANDLE_RE.test(h)) return null;

  const amt = formatAmount(amount);
  if (!amt) return null;

  const ccy = normalizeCurrency(currency);
  if (!ccy) return null;

  return `https://paypal.me/${h}/${amt}${ccy}`;
}

/**
 * Build a Venmo deeplink.
 *
 *   buildVenmoLink("alyssa-perez", 42.5, "Paris trip ☕")
 *     → "venmo://paycharge?txn=pay&recipients=alyssa-perez&amount=42.50&note=Paris%20trip%20%E2%98%95"
 *
 * Returns null if handle or amount is invalid. The note is optional —
 * pass empty/null to omit the &note= param.
 *
 * Venmo's mobile deeplink (venmo://) opens the app directly with the
 * compose screen pre-filled. On desktop the iOS/Android scheme is a
 * no-op; clients who want a web fallback should detect platform and
 * use https://venmo.com/{handle} instead. The Settle Up view runs in
 * the Capacitor mobile shell on the primary use case (post-trip group
 * splitting), so the deeplink is the right default.
 *
 * Spec confirmed via Venmo's published deeplink format used by their
 * own "Pay or request" button on partner sites:
 *   https://venmo.com/pay/?txn=pay&recipients=...&amount=...&note=...
 *   venmo://paycharge?txn=pay&recipients=...&amount=...&note=...
 *
 * We emit the venmo:// form because the https form prompts for a
 * Venmo login on web (not what a settle-up flow wants) — the deeplink
 * opens the app or shows the user a "Get Venmo" page on bare browsers.
 */
export function buildVenmoLink(
  handle: string | null | undefined,
  amount: number,
  note?: string | null,
): string | null {
  const h = normalizeHandle(handle);
  if (!h || !VENMO_HANDLE_RE.test(h)) return null;

  const amt = formatAmount(amount);
  if (!amt) return null;

  const params = new URLSearchParams({
    txn: "pay",
    recipients: h,
    amount: amt,
  });
  if (note && note.trim().length > 0) {
    // URLSearchParams handles percent-encoding for us; passing a real
    // note string (not pre-encoded) is the correct shape.
    params.set("note", note.trim());
  }

  return `venmo://paycharge?${params.toString()}`;
}

/**
 * Build a Wise (formerly TransferWise) "Pay me" deeplink.
 *
 *   buildWiseLink("alyssaperez", 42.5, "EUR", "Paris trip")
 *     → "https://wise.com/pay/me/alyssaperez?amount=42.50&currency=EUR&description=Paris%20trip"
 *
 * Returns null if any required input is invalid. The description is
 * optional — pass empty/null to omit the &description= param.
 *
 * Wise's "Get paid" feature lets each user publish a public URL at
 * wise.com/pay/me/{handle} that anyone can hit to send them money.
 * Query params for amount, currency, and description pre-fill the form
 * on the destination page — exactly the settle-up UX we want.
 *
 * The leading @ that some users include in their wiseTag is stripped
 * by normalizeHandle so "alyssa" and "@alyssa" both work.
 */
export function buildWiseLink(
  handle: string | null | undefined,
  amount: number,
  currency: string | null | undefined,
  note?: string | null,
): string | null {
  const h = normalizeHandle(handle);
  if (!h || !WISE_HANDLE_RE.test(h)) return null;

  const amt = formatAmount(amount);
  if (!amt) return null;

  const ccy = normalizeCurrency(currency);
  if (!ccy) return null;

  const params = new URLSearchParams({
    amount: amt,
    currency: ccy,
  });
  if (note && note.trim().length > 0) {
    params.set("description", note.trim());
  }

  return `https://wise.com/pay/me/${h}?${params.toString()}`;
}

// =====================================================
// Validation helpers (exported so the settings page can
// give the user inline feedback as they type, and so the
// /api/profile PATCH layer can re-validate before write)
// =====================================================

/**
 * Validate a handle for the given provider. Strips a leading "@"
 * before checking — matches the build* fns' normalization.
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

/**
 * Provider key list — useful for iteration in the SettleUpView's
 * button-row render and in the PATCH /api/profile allowlist.
 */
export const PAYMENT_PROVIDERS = ["paypal", "venmo", "wise"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Column-name mapping. Keeps the SettleUpView free of hardcoded
 * "paypal_handle" strings sprinkled through render code.
 */
export const PAYMENT_HANDLE_COLUMN: Record<PaymentProvider, string> = {
  paypal: "paypal_handle",
  venmo: "venmo_handle",
  wise: "wise_handle",
};
