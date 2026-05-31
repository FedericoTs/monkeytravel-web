/**
 * Export ALL users from Supabase to out/audience-contacts.json (consumed
 * by scripts/sync-resend-audience.mts).
 *
 * This is the "import the entire user DB" variant — one-off bootstrap of
 * the Resend audience, no marketing-opt-in filter. The opt-in-only flow
 * lives at scripts/export-audience-contacts.mts and stays the default
 * for any ongoing sync.
 *
 * Compliance note:
 *   - Resend audience membership ≠ broadcast send. Importing here only
 *     populates the contact list. Future marketing broadcasts MUST still
 *     respect per-recipient opt-out (Resend's `unsubscribed` flag + the
 *     HMAC unsubscribe link wired in lib/email/send.ts).
 *   - All imported contacts land with `unsubscribed: false`, but the
 *     Resend list includes a one-click unsubscribe link on every
 *     marketing send. Transactional sends are exempt.
 *   - Email_subscribers (the waitlist) is union'd in if present.
 *
 * Excludes:
 *   - loadtest+% (synthetic test users)
 *   - %@example.com / %@test.local
 *   - Personal test aliases that contain "+test" (federicosciuca+test, etc.)
 *
 * Prints counts only — never the email list.
 *
 *   npx tsx scripts/export-all-users-to-resend.mts
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

interface Contact {
  email: string;
  firstName?: string;
  locale?: string;
}

function firstName(displayName?: string | null): string | undefined {
  if (!displayName) return undefined;
  const trimmed = displayName.trim();
  if (!trimmed) return undefined;
  // Skip auto-derived "firstName" that's just an email-prefix-with-dots
  // (e.g. "federicosciuca", "marcodallolio.md"). Heuristic: contains a
  // dot OR is all-lowercase + has digits. Resend prefers blank to junk.
  const first = trimmed.split(/\s+/)[0];
  if (!first) return undefined;
  const looksLikeHandle =
    /\./.test(first) ||
    (/^[a-z]+\d+$/.test(first)) ||
    (/^[a-z0-9]+$/.test(first) && first.length > 10);
  if (looksLikeHandle) return undefined;
  return first;
}

function isExcluded(email: string): boolean {
  const e = email.toLowerCase();
  if (e.startsWith("loadtest+")) return true;
  if (e.endsWith("@example.com")) return true;
  if (e.endsWith("@test.local")) return true;
  // Personal test aliases the operator created during prior testing
  if (e.includes("+test")) return true;
  if (e.includes("test+")) return true;
  return false;
}

async function main() {
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("email, display_name, preferred_language")
    .not("email", "is", null);
  if (usersErr) throw new Error(`users query failed: ${usersErr.message}`);

  // Optional union with email_subscribers waitlist if present
  const { data: subs } = await supabase
    .from("email_subscribers")
    .select("email");

  const byEmail = new Map<string, Contact>();

  for (const s of subs ?? []) {
    if (!s.email) continue;
    const email = String(s.email).trim().toLowerCase();
    if (!email || isExcluded(email)) continue;
    byEmail.set(email, { email });
  }

  for (const u of users ?? []) {
    if (!u.email) continue;
    const email = String(u.email).trim().toLowerCase();
    if (!email || isExcluded(email)) continue;
    byEmail.set(email, {
      email,
      firstName: firstName(u.display_name),
      locale: (u.preferred_language as string | undefined) || undefined,
    });
  }

  const contacts = [...byEmail.values()];
  const outDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "audience-contacts.json");
  fs.writeFileSync(file, JSON.stringify(contacts, null, 2), "utf8");

  console.log(`Total users in DB:     ${users?.length ?? 0}`);
  console.log(`Waitlist subscribers:  ${subs?.length ?? 0}`);
  console.log(`After exclusions:      ${contacts.length}`);
  console.log(`With first name:       ${contacts.filter((c) => c.firstName).length}`);
  console.log(`Wrote: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
