import { NextRequest, NextResponse } from "next/server";
import baseline from "@/supabase/rls-baseline.json";
import {
  anonWritablePolicies,
  fetchRlsSnapshot,
  rlsDrift,
  type RlsSnapshot,
} from "@/lib/audits/rls-drift";
import { sendOpsAlert } from "@/lib/ops/alert";

/**
 * Nightly: does production row-level security still match the committed
 * baseline? Runs here rather than in GitHub Actions for the reason the
 * account-deletion audit gives: the service-role key already lives on Vercel,
 * and the GitHub workflow keeps pull-request coverage for when secrets exist.
 * Drift or an anon-writable policy emails the owner and fails the run, so a
 * policy changed from the dashboard is noticed within a day instead of when
 * someone next runs the script. Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/audit-rls-drift
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Distinct from "no drift": the check did not run, and that must not read as a pass.
    console.error("[cron/audit-rls-drift] NOT RUNNING — service credentials missing");
    return NextResponse.json(
      { ok: false, error: "Service credentials missing — the audit did not run" },
      { status: 500 }
    );
  }

  let live: RlsSnapshot;
  try {
    live = await fetchRlsSnapshot(url, key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/audit-rls-drift] snapshot failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const drift = rlsDrift(baseline as RlsSnapshot, live);
  const exposed = anonWritablePolicies(live);
  if (!drift.length && !exposed.length) {
    console.log(`[cron/audit-rls-drift] PASS — ${live.length} tables match the baseline`);
    return NextResponse.json({ ok: true, tables: live.length });
  }

  const alerted = await sendOpsAlert("RLS drift in production", [
    ...(exposed.length
      ? [`ANON-WRITABLE POLICIES (${exposed.length}):`, ...exposed.map((e) => `  ${e}`)]
      : []),
    ...(drift.length
      ? [`DRIFT FROM supabase/rls-baseline.json (${drift.length}):`, ...drift.map((p) => `  ${p}`)]
      : []),
    "If the change was intentional, land it as a migration and refresh the baseline in the same commit: npm run rls:baseline",
  ]);
  return NextResponse.json({ ok: false, drift, exposed, alerted }, { status: 500 });
}
