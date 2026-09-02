/**
 * One-time recovery for accounts stranded by the cross-device confirmation bug.
 *
 * Before #86, the confirmation email linked to GoTrue's /auth/v1/verify, which
 * completes a PKCE flow whose code_verifier lives in the browser that STARTED
 * the signup. Confirm on your phone after signing up on your laptop and the
 * account is marked confirmed and you never get a session. You are stranded:
 * the account exists, you cannot get in, and nothing tells you why.
 *
 * As of 2026-09-02 there are 28 such accounts all-time. This targets the 8 who
 * signed up within 30 days and whose address has never bounced — recent enough
 * that the intent is still live, and deliverable enough not to hurt the domain
 * reputation the trip reminders depend on.
 *
 * WHY THE COPY IS WRITTEN HERE rather than reusing the magiclink template:
 * that template says "Didn't try to sign in? You can safely ignore this email."
 * These people did NOT just try to sign in — we are initiating — so that
 * footer would be actively misleading. A recovery email has to say why it
 * arrived.
 *
 * NO Supabase auth email is sent, so the low, project-wide auth-email cap is
 * untouched and real signup confirmations cannot be throttled by this run:
 * admin.generateLink returns the link without mailing it, and we send it
 * ourselves through the same Resend path the auth hook uses.
 *
 * DRY RUN BY DEFAULT. Nothing leaves the building without --send.
 *
 *   node scripts/recover-stranded-signups.mjs                  # list only
 *   node scripts/recover-stranded-signups.mjs --test you@x.com # one test send
 *   node scripts/recover-stranded-signups.mjs --send           # the real thing
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function envs() {
  const out = {};
  const want = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "EMAIL_FROM", "NEXT_PUBLIC_APP_URL"];
  for (const k of want) out[k] = process.env[k] ?? "";
  if (existsSync(".env.local")) {
    for (const rawLine of readFileSync(".env.local", "utf8").split(String.fromCharCode(10))) {
      const line = rawLine.trim();
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      const q = v.slice(0, 1);
      if ((q === String.fromCharCode(34) || q === String.fromCharCode(39)) && v.slice(-1) === q) v = v.slice(1, -1);
      if (want.includes(k) && !out[k]) out[k] = v;
    }
  }
  return out;
}

const env = envs();
const APP = env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
const FROM = env.EMAIL_FROM || "MonkeyTravel <hello@send.monkeytravel.app>";
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const TEST_TO = args.includes("--test") ? args[args.indexOf("--test") + 1] : null;
const GAP_MS = 5000;
const TEMPLATE_ID = "stranded_recovery";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function body(link) {
  const text = [
    "Your MonkeyTravel account is ready — here is a way in.",
    "",
    "You confirmed your email a little while ago, but a bug on our side meant the",
    "confirmation link could not sign you in if you opened it on a different device",
    "than the one you signed up on. That is fixed, and this link will get you in.",
    "",
    link,
    "",
    "The link is good for 24 hours. If you would rather not, you can ignore this —",
    "we will not email you about it again.",
    "",
    "The MonkeyTravel Team",
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#111827">Your account is ready — here's a way in</h1>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151">
      You confirmed your email a little while ago, but a bug on our side meant the confirmation
      link couldn't sign you in if you opened it on a different device than the one you signed
      up on. That's fixed, and this link will get you in.
    </p>
    <p style="margin:22px 0">
      <a href="${esc(link)}" style="display:inline-block;background:#FF6B6B;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">Sign in to MonkeyTravel</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280">
      The link is good for 24 hours. If you'd rather not, you can ignore this — we won't email
      you about it again.
    </p>
    <p style="margin:18px 0 0;font-size:13px;color:#6b7280">The MonkeyTravel Team</p>
  </div>
</body></html>`;
  return { text, html };
}

async function mintLink(email) {
  // Returns the token WITHOUT mailing anything, so the Supabase auth-email cap
  // is never touched. Same URL shape app/api/auth/send-email/route.ts builds.
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new Error(error?.message || "no token_hash");
  const cb = new URL("/auth/callback", APP);
  cb.searchParams.set("token_hash", data.properties.hashed_token);
  cb.searchParams.set("type", "magiclink");
  cb.searchParams.set("locale", "en");
  cb.searchParams.set("next", "/trips/new");
  return cb.toString();
}

async function send(to, link) {
  const { text, html } = body(link);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: "Your MonkeyTravel account is ready", html, text }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `resend ${res.status}`);
  return json?.id ?? null;
}

// The set, defined exactly as the PR describes it.
const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const { data: trips } = await db.from("trips").select("user_id").is("deleted_at", null);
const withTrip = new Set((trips ?? []).map((t) => t.user_id));
const { data: bounced } = await db
  .from("email_log")
  .select("recipient_email, bounced_at, complained_at, template_id");
const badAddr = new Set(
  (bounced ?? []).filter((r) => r.bounced_at || r.complained_at).map((r) => (r.recipient_email || "").toLowerCase())
);
const alreadyRecovered = new Set(
  (bounced ?? []).filter((r) => r.template_id === TEMPLATE_ID).map((r) => (r.recipient_email || "").toLowerCase())
);

const cutoff = Date.now() - 30 * 86_400_000;
const targets = (users?.users ?? []).filter((u) => {
  const email = (u.email || "").toLowerCase();
  if (!email || email.includes("@test.local") || email.startsWith("mt-probe") || email.startsWith("mt-e2e")) return false;
  if ((u.app_metadata?.provider ?? "email") !== "email") return false;
  if (!u.email_confirmed_at) return false;          // never confirmed is a different problem
  if (u.last_sign_in_at) return false;              // they got in; not stranded
  if (withTrip.has(u.id)) return false;             // has a trip, so clearly got in somehow
  if (new Date(u.created_at).getTime() < cutoff) return false;  // intent is stale
  if (badAddr.has(email)) return false;             // never re-mail a bouncing address
  if (alreadyRecovered.has(email)) return false;    // idempotent across runs
  return true;
});

console.log("");
console.log(`Stranded accounts eligible for recovery: ${targets.length}`);
for (const u of targets) {
  const days = Math.round((Date.now() - new Date(u.created_at).getTime()) / 86_400_000);
  const masked = (u.email || "").replace(/^(.).*(@.*)$/, "$1***$2");
  console.log(`  - ${masked}  signed up ${days}d ago, confirmed, never signed in, no trip`);
}

if (TEST_TO) {
  console.log("");
  console.log(`=== TEST SEND to ${TEST_TO} ===`);
  const link = await mintLink(TEST_TO);
  const id = await send(TEST_TO, link);
  console.log(`  sent (message ${id})`);
  console.log(`  link: ${link.slice(0, 96)}…`);
  process.exit(0);
}

if (!SEND) {
  console.log("");
  console.log("DRY RUN — nothing was sent. Re-run with --send to deliver, or --test <address> for one.");
  process.exit(0);
}

console.log("");
console.log(`=== SENDING to ${targets.length} recipients, ${GAP_MS / 1000}s apart ===`);
let sent = 0;
for (const u of targets) {
  const email = u.email;
  try {
    const link = await mintLink(email);
    const messageId = await send(email, link);
    sent++;
    console.log(`  ok   ${email.replace(/^(.).*(@.*)$/, "$1***$2")} (${messageId})`);
    // Logged so a second run skips them and so bounces are attributable.
    await db.from("email_log").insert({
      recipient_email: email.toLowerCase(),
      template_id: TEMPLATE_ID,
      message_id: messageId,
      status: "sent",
      sent_at: new Date().toISOString(),
      metadata: { reason: "cross_device_confirmation_stranded", user_id: u.id },
    });
  } catch (e) {
    console.log(`  *** FAILED ${email.replace(/^(.).*(@.*)$/, "$1***$2")}: ${e.message}`);
  }
  await sleep(GAP_MS);
}
console.log("");
console.log(`Done: ${sent}/${targets.length} sent.`);
