/**
 * Test the Supabase "Send Email" auth hook by POSTing a real, signed
 * Standard-Webhooks payload to the production endpoint.
 *
 * What this tests:
 *   1. The signature passes verification (proves SEND_EMAIL_HOOK_SECRET
 *      on Vercel matches what we expect locally).
 *   2. The render step succeeds (React Email + i18n copy compiles).
 *   3. Resend accepts the send (RESEND_API_KEY + sender domain valid).
 *   4. The recipient gets a real branded email.
 *
 * What this does NOT test:
 *   - That the confirmation LINK works end-to-end. The `token_hash` is a
 *     fake placeholder, so clicking the link will get a 401 from
 *     Supabase's verify endpoint. That's expected — we're only testing
 *     the email delivery + branding, not the auth flow.
 *
 * Usage:
 *   $env:SEND_EMAIL_HOOK_SECRET = "v1,whsec_..."  # paste from Vercel
 *   npx tsx scripts/test-auth-hook.mts <recipient> [action_type] [locale]
 *
 *   action_type: signup | recovery | magiclink | email_change | reauthentication | invite
 *   locale: en | it | es
 *
 * Example:
 *   npx tsx scripts/test-auth-hook.mts federicosciuca@droplab.io signup en
 */

import crypto from "node:crypto";

// ----------------------------------------------------------------------------
// Args
// ----------------------------------------------------------------------------

const recipient = process.argv[2];
const actionType = process.argv[3] ?? "signup";
const locale = process.argv[4] ?? "en";

if (!recipient || !recipient.includes("@")) {
  console.error("Usage: npx tsx scripts/test-auth-hook.mts <recipient> [action_type] [locale]");
  process.exit(1);
}

const secret = process.env.SEND_EMAIL_HOOK_SECRET;
if (!secret) {
  console.error("✗ SEND_EMAIL_HOOK_SECRET env var is required.");
  console.error("  Pull it from Vercel: vercel env pull /tmp/.env.tmp && source it");
  process.exit(1);
}

const HOOK_URL = process.env.HOOK_URL ?? "https://monkeytravel.app/api/auth/send-email";

// ----------------------------------------------------------------------------
// Build the payload — same shape Supabase Auth (GoTrue) sends
// ----------------------------------------------------------------------------

const payload = {
  user: {
    email: recipient,
    user_metadata: {
      display_name: "Test User",
      full_name: "Test User",
      locale,
    },
  },
  email_data: {
    // token_hash is a fake placeholder. Clicking the link will fail at
    // Supabase /auth/v1/verify with a 401 — that's expected. We're testing
    // email DELIVERY + BRANDING, not end-to-end auth.
    token: "123456",
    token_hash: `test-hook-${Date.now()}`,
    redirect_to: "https://monkeytravel.app/trips",
    email_action_type: actionType,
    site_url: "https://monkeytravel.app",
  },
};

const rawBody = JSON.stringify(payload);

// ----------------------------------------------------------------------------
// Sign — exactly matches lib/email/verify-hook.ts
// ----------------------------------------------------------------------------

function normaliseSecret(s: string): string {
  let out = s.trim();
  if (out.startsWith("v1,")) out = out.slice(3);
  if (out.startsWith("whsec_")) out = out.slice("whsec_".length);
  return out;
}

const id = `msg_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
const timestamp = Math.floor(Date.now() / 1000).toString();
const key = Buffer.from(normaliseSecret(secret), "base64");
const signedContent = `${id}.${timestamp}.${rawBody}`;
const sigBase64 = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
const sigHeader = `v1,${sigBase64}`;

// ----------------------------------------------------------------------------
// Send
// ----------------------------------------------------------------------------

console.log(`→ POST ${HOOK_URL}`);
console.log(`→ action: ${actionType} · locale: ${locale} · recipient: ${recipient}`);
console.log(`→ webhook-id: ${id}`);
console.log(`→ webhook-timestamp: ${timestamp}`);
console.log(`→ signature length: ${sigBase64.length}`);
console.log();

const response = await fetch(HOOK_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": sigHeader,
  },
  body: rawBody,
});

const responseText = await response.text();

console.log(`← status: ${response.status} ${response.statusText}`);
console.log(`← body: ${responseText.slice(0, 500)}`);
console.log();

if (response.ok) {
  console.log(`✓ Hook fired successfully. Check ${recipient} inbox in ~30 seconds.`);
  console.log(`✓ Verify in Resend dashboard: https://resend.com/emails`);
} else {
  console.log(`✗ Hook returned non-2xx. Probable causes:`);
  console.log(`  - 401: signature mismatch (secret on Vercel differs from local env)`);
  console.log(`  - 400: payload validation failed`);
  console.log(`  - 500: render or send failure (check Vercel function logs)`);
  process.exit(1);
}
