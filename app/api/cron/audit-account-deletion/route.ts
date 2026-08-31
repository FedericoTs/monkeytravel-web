import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  auditAccountDeletion,
  BLOCKER_REMEDY,
} from "@/lib/audits/account-deletion";

/**
 * Daily cron — can every account still be deleted?
 *
 * WHY THIS RUNS HERE AND NOT IN GITHUB ACTIONS
 * --------------------------------------------
 * The audit needs the service-role key. Vercel already holds it, because the
 * app runs on it; GitHub Actions is a separate store that would need a second
 * copy of the highest-privilege credential this project has, for no functional
 * gain. Running the scheduled check where the credential already lives keeps
 * the blast radius where it is.
 *
 * The GitHub workflow is kept for PULL REQUESTS, where it catches a new
 * foreign key at review time — it just no longer owns the nightly run.
 *
 * WHAT IT GUARDS
 * --------------
 * /api/profile/delete runs in two phases: delete_user_account() over the
 * public schema, then auth.admin.deleteUser(). Any FK into auth.users left on
 * ON DELETE NO ACTION makes phase 2 fail AFTER phase 1 destroyed the person's
 * trips — data gone, account still there, and a 500 that names no constraint.
 *
 * It has happened twice. The 2026-08-04 pass fixed four such keys, measured 0
 * accounts affected and was filed as latent; by 2026-08-31 six more existed
 * and 283 of 495 real accounts could not be deleted. The only symptom is a
 * real person hitting a 500 at the moment they are trying to leave, which is
 * why it went a month unnoticed.
 *
 * FAILURE IS LOUD ON PURPOSE
 * --------------------------
 * A blocker returns 500 so the run shows as FAILED in the Vercel dashboard
 * rather than as a green cron with a sad message in its body. The console line
 * carries a fixed prefix so it can be alerted on.
 *
 * Auth: CRON_SECRET. Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/audit-account-deletion
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // Never run unauthenticated, even if the secret is unset — an unguarded
  // route that reads the schema is not something to leave open by accident.
  if (!secret) return unauthorized();
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorized();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Distinct from "no blockers": the guard did not run at all, and that must
    // not read as a pass. This is the failure mode the GitHub workflow had for
    // five consecutive green runs.
    console.error("[cron/audit-account-deletion] NOT RUNNING — service credentials missing");
    return NextResponse.json(
      { ok: false, error: "Service credentials missing — the audit did not run" },
      { status: 500 }
    );
  }

  const db = createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await auditAccountDeletion(db);

  if (result.error) {
    console.error("[cron/audit-account-deletion] audit could not run:", result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  if (!result.ok) {
    console.error(
      `[cron/audit-account-deletion] ACCOUNTS CANNOT BE DELETED — ${result.blockers.length} blocking foreign key(s)`,
      {
        blockers: result.blockers.map(
          (b) => `${b.child_table}.${b.child_columns} (${b.constraint_name}) ON DELETE ${b.on_delete}`
        ),
        remedy: BLOCKER_REMEDY,
      }
    );
    return NextResponse.json(
      {
        ok: false,
        blockers: result.blockers,
        remedy: BLOCKER_REMEDY,
        emailResidue: result.emailResidue,
      },
      { status: 500 }
    );
  }

  console.log(
    "[cron/audit-account-deletion] PASS — every foreign key into auth.users cascades or nulls"
  );
  return NextResponse.json({ ok: true, emailResidue: result.emailResidue });
}
