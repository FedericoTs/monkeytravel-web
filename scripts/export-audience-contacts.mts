/**
 * Export the marketing-eligible contact list from Supabase to
 * out/audience-contacts.json (consumed by scripts/sync-resend-audience.mts).
 *
 * Eligible = explicit opt-in only:
 *   - users where notification_settings.marketingNotifications = true
 *   - email_subscribers (landing-page waitlist — opted in by signing up)
 *
 * Uses the service-role key (bypasses RLS) — server-side only. Self-loads
 * .env.local so the secret never appears on the command line. Prints COUNTS
 * only (never the email list) to avoid leaking PII into logs.
 *
 *   npx tsx scripts/export-audience-contacts.mts
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── minimal .env.local loader (no dep) ──────────────────────────────────
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
  return displayName.trim().split(/\s+/)[0] || undefined;
}

async function main() {
  // 1. Opted-in users.
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("email, display_name, preferred_language, notification_settings")
    .filter("notification_settings->>marketingNotifications", "eq", "true");
  if (usersErr) throw new Error(`users query failed: ${usersErr.message}`);

  // 2. Waitlist subscribers.
  const { data: subs, error: subsErr } = await supabase
    .from("email_subscribers")
    .select("email");
  if (subsErr) throw new Error(`email_subscribers query failed: ${subsErr.message}`);

  // 3. Merge, dedupe by lowercased email (user row wins for name/locale).
  const byEmail = new Map<string, Contact>();
  for (const s of subs ?? []) {
    if (!s.email) continue;
    const email = String(s.email).trim().toLowerCase();
    if (email) byEmail.set(email, { email });
  }
  for (const u of users ?? []) {
    if (!u.email) continue;
    const email = String(u.email).trim().toLowerCase();
    if (!email) continue;
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

  // Counts only — never print the emails.
  console.log(`Opted-in users:        ${users?.length ?? 0}`);
  console.log(`Waitlist subscribers:  ${subs?.length ?? 0}`);
  console.log(`Total unique contacts: ${contacts.length}`);
  console.log(`Wrote: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
