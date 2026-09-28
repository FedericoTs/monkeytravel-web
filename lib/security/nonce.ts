/**
 * Per-request nonce for the nonce-based Content-Security-Policy that
 * middleware.ts sends on pages rendered per request (lib/security/csp.ts).
 * Next reads it from the policy and stamps it on every script it emits;
 * our own inline scripts are admitted by hash instead, so no component
 * needs to read the nonce.
 *
 * Dev mode (NODE_ENV !== "production"): no CSP is sent at all. Next dev
 * uses `eval()` inside React Fast Refresh + Turbopack's runtime, which
 * would require `unsafe-eval` in `script-src`.
 */

/**
 * Generate a 128-bit random nonce, base64-encoded.
 *
 * Uses Web Crypto (`globalThis.crypto.getRandomValues`) — works in the
 * Edge runtime where `node:crypto.randomBytes` is unavailable.
 *
 * 16 bytes = 128 bits = ~22 chars base64. Comfortably above the CSP
 * spec's recommended 128-bit minimum entropy.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // Edge-safe base64 — btoa is available in the Edge runtime.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
