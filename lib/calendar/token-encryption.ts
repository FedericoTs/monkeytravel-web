/**
 * AES-256-GCM at-rest encryption for OAuth tokens.
 *
 * Phase 2 of calendar-export stores the user's Google Calendar
 * access_token and refresh_token in `public.user_calendar_connections`.
 * Both are bytea columns; ciphertext is produced here so the plaintext
 * never touches Postgres logs, `pg_stat_statements`, or a future leaked
 * DB backup.
 *
 * Why app-layer (not pgsodium)?
 * -----------------------------
 * pgsodium isn't installed on Trawell (verified via list_extensions on
 * 2026-05-29). Enabling it requires a Supabase dashboard toggle + a key
 * rotation procedure that's out of scope for Phase 2. App-layer
 * AES-256-GCM with a Vercel-env-managed key gets us:
 *   - same threat model (DB compromise alone reveals nothing)
 *   - rotate-by-redeploy ergonomics
 *   - zero migration ceremony
 *
 * Ciphertext format (single bytea per token):
 *   [1 byte version][12 byte IV][16 byte auth tag][ciphertext]
 *
 * - Version byte = 0x01 today. Lets us rotate algorithm in-place by
 *   bumping it and dispatching in `decrypt()`.
 * - 12-byte IV is the AES-GCM standard. Random per encrypt.
 * - 16-byte auth tag is GCM's default.
 * - Total overhead: 29 bytes — irrelevant next to a 300-byte JWT.
 *
 * Key management
 * --------------
 * CALENDAR_TOKEN_ENC_KEY is a 64-char hex string (256-bit key).
 * Generate with:  openssl rand -hex 32
 *
 * Without this env, encrypt/decrypt throw. The calling routes
 * (connect / callback / sync) catch and surface a clear "Calendar
 * sync not configured" 503 so the operator sees the misconfiguration
 * in Sentry without 500'ing every user.
 *
 * Rotation
 * --------
 * 1. Generate a new hex key.
 * 2. (Future) Add a `decrypt-with-legacy-key` fallback path before
 *    flipping. For Phase 2 — small user base, easy to revoke + ask
 *    users to reconnect — rotation = revoke all tokens via
 *    `DELETE FROM user_calendar_connections;` and set the new key.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION_BYTE = 0x01;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
/** Hex chars for a 256-bit key. */
const KEY_HEX_LENGTH = 64;

/**
 * Read + validate the encryption key on demand. Module-level reads
 * race Next.js's env loader on cold start; pull on every call (it's
 * a hex parse — microseconds).
 */
function getKey(): Buffer {
  const raw = process.env.CALENDAR_TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error(
      "CALENDAR_TOKEN_ENC_KEY is not set. Generate with `openssl rand -hex 32` and add to Vercel env."
    );
  }
  if (raw.length !== KEY_HEX_LENGTH || !/^[a-f0-9]+$/i.test(raw)) {
    throw new Error(
      `CALENDAR_TOKEN_ENC_KEY must be ${KEY_HEX_LENGTH} hex chars (32 bytes / 256 bits).`
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Encrypt a plaintext token into the v1 framed bytea.
 *
 * @param plaintext - UTF-8 string (OAuth tokens are ASCII-only JWTs).
 * @returns Buffer with [version][iv][tag][ciphertext] layout.
 */
export function encryptToken(plaintext: string): Buffer {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken: plaintext must be a non-empty string");
  }
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION_BYTE]), iv, tag, ciphertext]);
}

/**
 * Decrypt a v1 framed bytea back to plaintext. Throws if the
 * framing/tag/key don't match — never returns garbage.
 */
export function decryptToken(framed: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(framed) ? framed : Buffer.from(framed);
  if (buf.length < 1 + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("decryptToken: ciphertext too short to be valid");
  }
  const version = buf[0];
  if (version !== VERSION_BYTE) {
    throw new Error(
      `decryptToken: unsupported version byte 0x${version.toString(16)}`
    );
  }
  const iv = buf.subarray(1, 1 + IV_LENGTH);
  const tag = buf.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(1 + IV_LENGTH + TAG_LENGTH);
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * True iff the encryption key is configured. Routes use this to
 * surface a friendly 503 (rather than throwing) when the operator
 * hasn't set CALENDAR_TOKEN_ENC_KEY yet.
 */
export function isTokenEncryptionConfigured(): boolean {
  const raw = process.env.CALENDAR_TOKEN_ENC_KEY;
  return (
    typeof raw === "string" &&
    raw.length === KEY_HEX_LENGTH &&
    /^[a-f0-9]+$/i.test(raw)
  );
}
