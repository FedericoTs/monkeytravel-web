/**
 * CSP Nonce Helpers
 *
 * Per-request nonce generation + retrieval used by the strict, nonce-based
 * Content-Security-Policy enforced in production.
 *
 * Flow:
 *   1. middleware.ts generates a fresh nonce for every request via
 *      `generateNonce()` (Edge-runtime safe — uses Web Crypto, no Node
 *      `crypto` module).
 *   2. The nonce is attached to the REQUEST headers under `x-nonce` so
 *      server components / layouts can read it via `getNonce()`, and to
 *      the RESPONSE headers under `Content-Security-Policy` so the browser
 *      enforces the policy.
 *   3. Server components attach `nonce={...}` to every inline `<script>`
 *      they render (JSON-LD, etc.). Next.js automatically propagates the
 *      nonce to its own framework scripts when CSP is set this way.
 *
 * Dev mode (NODE_ENV !== "production"): we skip CSP entirely. Next dev
 * uses `eval()` inside React Fast Refresh + Turbopack's runtime, which
 * would require `unsafe-eval` in `script-src` and defeat the purpose of
 * the migration. Prod is what we lock down.
 */

import { headers } from "next/headers";

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

/**
 * Read the per-request nonce from request headers.
 *
 * Must be called from a server component (or anything that can call
 * `next/headers#headers()`). Returns `undefined` in dev mode (no nonce
 * is set in dev) or if the middleware didn't run (e.g. on a static
 * export with no edge function).
 *
 * Callers should treat `undefined` as "skip the nonce attribute" — when
 * CSP is not enforced (dev), browsers don't need a nonce.
 */
export async function getNonce(): Promise<string | undefined> {
  try {
    const h = await headers();
    return h.get("x-nonce") ?? undefined;
  } catch {
    // Outside a request context (e.g. during static generation) — no nonce.
    return undefined;
  }
}
