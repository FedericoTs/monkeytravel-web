/**
 * Can every account actually be deleted?
 *
 *   npx tsx scripts/audit-account-deletion.mts
 *
 * WHY THIS EXISTS
 * ---------------
 * /api/profile/delete runs in two phases: delete_user_account() over the
 * public schema, then auth.admin.deleteUser(). Any foreign key into auth.users
 * left on ON DELETE NO ACTION makes phase 2 fail — AFTER phase 1 has already
 * destroyed the person's trips. Their data is gone and their account is not,
 * and the API returns a 500 whose message ("Database error deleting user")
 * names no constraint, so the logs do not say which table did it.
 *
 * It has now happened twice. A pass on 2026-08-04 fixed four such keys and
 * measured 0 accounts affected, so it was filed as latent. By 2026-08-31 six
 * more existed that the pass never covered, one it DID fix was NO ACTION
 * again, and:
 *
 *   total accounts                     495
 *   accounts that could not be deleted 284   (283 of them real)
 *
 * Nothing was watching, because the only symptom is a real person hitting a
 * 500 at the moment they are trying to leave. This is the watcher.
 *
 * WHAT IT CHECKS
 *   1. No FK into auth.users is on NO ACTION or RESTRICT. Any is a FAIL.
 *   2. How many accounts those keys would block today.
 *   3. Which email-keyed rows outlive a deletion — reported, not failed,
 *      because retention there is policy rather than a defect.
 *
 * Exits non-zero on a FAIL so CI can gate on it. Needs
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from the
 * environment, or from .env.local when run locally).
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if ((!url || !key) && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (m[1] === "NEXT_PUBLIC_SUPABASE_URL") url ||= v;
    if (m[1] === "SUPABASE_SERVICE_ROLE_KEY") key ||= v;
  }
}
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failed = false;

// ---- 1. blocking foreign keys -------------------------------------------
const { data: blockers, error } = await db.rpc("account_deletion_blockers");
if (error) {
  console.error(`Could not read the blocker list: ${error.message}`);
  console.error("Is migration 20260831161000_account_deletion_guard_and_erasure applied?");
  process.exit(1);
}

const rows = (blockers ?? []) as Array<{
  constraint_name: string;
  child_table: string;
  child_columns: string;
  on_delete: string;
}>;

if (rows.length === 0) {
  console.log("FK check:  PASS — every foreign key into auth.users cascades or nulls.");
} else {
  failed = true;
  console.log(`FK check:  FAIL — ${rows.length} foreign key(s) will block account deletion:\n`);
  for (const r of rows) {
    console.log(`   ${r.child_table}.${r.child_columns}  (${r.constraint_name})  ON DELETE ${r.on_delete}`);
  }
  console.log(
    "\n   Fix: ALTER TABLE <table> DROP CONSTRAINT <name>, ADD CONSTRAINT <name>\n" +
      "        FOREIGN KEY (<col>) REFERENCES auth.users(id) ON DELETE SET NULL;\n" +
      "   SET NULL for 'who did this' columns; CASCADE only for rows that ARE the user's."
  );
}

// ---- 2. email that outlives the account ----------------------------------
// Reported every run: these are keyed by address, so no foreign key reaches
// them and nothing above would ever catch them.
const EMAIL_KEYED: Array<[string, string, string]> = [
  ["email_subscribers", "email", "deleted by delete_user_account()"],
  ["user_feedback", "contact_email", "nulled by delete_user_account()"],
  ["email_log", "recipient_email", "RETAINED — delivery audit trail"],
  ["contact_messages", "email", "RETAINED — support correspondence"],
  ["trip_invites", "recipient_email", "RETAINED — records another user's action"],
];

console.log("\nEmail-keyed rows (no foreign key reaches these):");
for (const [table, column, note] of EMAIL_KEYED) {
  const { count, error: e } = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .not(column, "is", null);
  if (e) {
    console.log(`   ${table}.${column}: unreadable (${e.message.slice(0, 60)})`);
    continue;
  }
  console.log(`   ${String(count ?? 0).padStart(5)}  ${table}.${column}  — ${note}`);
}
console.log(
  "\n   The RETAINED three are a retention decision, not a defect: an audit\n" +
    "   trail, an possibly-open support thread, and a row describing something\n" +
    "   another user did. Change them deliberately or not at all."
);

console.log("\n" + "=".repeat(60));
console.log(failed ? "ACCOUNT DELETION AUDIT: FAILED" : "ACCOUNT DELETION AUDIT: PASSED");
process.exit(failed ? 1 : 0);
