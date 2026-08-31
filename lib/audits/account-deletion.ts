import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Can every account still be deleted?
 *
 * /api/profile/delete runs in two phases: delete_user_account() over the public
 * schema, then auth.admin.deleteUser(). Any foreign key into auth.users left on
 * ON DELETE NO ACTION makes phase 2 fail — AFTER phase 1 has already destroyed
 * the person's trips. Their data is gone and their account is not, and the 500
 * names no constraint, so the logs do not say which table did it.
 *
 * THIS HAS HAPPENED TWICE. A pass on 2026-08-04 fixed four such keys and
 * measured 0 accounts affected, so it was filed as latent. By 2026-08-31 six
 * more existed that it never covered, one it DID fix was NO ACTION again, and
 * 283 of 495 real accounts could not be deleted. Nobody noticed, because the
 * only symptom is a real person hitting a 500 at the moment they try to leave.
 *
 * This module is the shared core so the script and the cron cannot disagree
 * about what "correct" means — the same mistake the subject-line rule made
 * when it existed in two copies and drifted within an hour.
 */

export interface DeletionBlocker {
  constraint_name: string;
  child_table: string;
  child_columns: string;
  on_delete: string;
}

export interface EmailResidue {
  table: string;
  column: string;
  rows: number;
  /** What delete_user_account() does with it, for the report. */
  disposition: string;
}

export interface AccountDeletionAudit {
  ok: boolean;
  blockers: DeletionBlocker[];
  emailResidue: EmailResidue[];
  /** Set when the audit could not run at all, as distinct from finding nothing. */
  error?: string;
}

/**
 * Rows keyed by EMAIL rather than by user id, which no foreign key reaches.
 *
 * Reported every run because nothing else would ever surface them. The
 * RETAINED three are a retention decision, not a defect: an audit trail, a
 * possibly-open support thread, and a record of another user's action.
 */
const EMAIL_KEYED: Array<[string, string, string]> = [
  ["email_subscribers", "email", "deleted by delete_user_account()"],
  ["user_feedback", "contact_email", "nulled by delete_user_account()"],
  ["email_log", "recipient_email", "RETAINED — delivery audit trail"],
  ["contact_messages", "email", "RETAINED — support correspondence"],
  ["trip_invites", "recipient_email", "RETAINED — records another user's action"],
];

/**
 * Run the audit against a service-role client.
 *
 * `ok` is false only when a foreign key would actually block a deletion. The
 * email residue is informational and never fails the run.
 */
export async function auditAccountDeletion(
  db: SupabaseClient
): Promise<AccountDeletionAudit> {
  const { data, error } = await db.rpc("account_deletion_blockers");

  if (error) {
    return {
      ok: false,
      blockers: [],
      emailResidue: [],
      error:
        `Could not read the blocker list: ${error.message}. ` +
        "Is migration 20260831161000_account_deletion_guard_and_erasure applied?",
    };
  }

  const blockers = (data ?? []) as DeletionBlocker[];

  const emailResidue: EmailResidue[] = [];
  for (const [table, column, disposition] of EMAIL_KEYED) {
    const { count, error: countError } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .not(column, "is", null);
    emailResidue.push({
      table,
      column,
      rows: countError ? -1 : count ?? 0,
      disposition: countError ? `unreadable (${countError.message.slice(0, 60)})` : disposition,
    });
  }

  return { ok: blockers.length === 0, blockers, emailResidue };
}

/** The remedy, spelled out wherever the failure is reported. */
export const BLOCKER_REMEDY =
  "ALTER TABLE <table> DROP CONSTRAINT <name>, ADD CONSTRAINT <name> " +
  "FOREIGN KEY (<col>) REFERENCES auth.users(id) ON DELETE SET NULL; " +
  "SET NULL for 'who did this' columns; CASCADE only for rows that ARE the user's.";
