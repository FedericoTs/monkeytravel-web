import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { sendOpsAlert } from "@/lib/ops/alert";
import { engineVerdict, type EngineHealth } from "@/lib/ops/engine-health";
import { refuseUnlessCron } from "@/lib/api/cron-auth";
import { isModelOutOfCredit } from "@/lib/ai/model-outage";

/**
 * Hourly: is the plan engine failing the people using it? (engine_health(),
 * lib/ops/engine-health.ts). While it is, the owner gets an email at most every
 * six hours and the run fails; /admin/mission shows the same reading. Google
 * refusing for lack of credit stops everything AI until someone tops up, so one
 * refusal is enough, and the email says what to do.
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/engine-health
 */

export const dynamic = "force-dynamic";

const alertThrottle = createRateLimiter("engine-alert", 1, 6 * 60 * 60_000);

const OUT_OF_CREDIT =
  "Google is refusing AI calls because the prepaid credits are used up. Nothing AI works until they're topped up: https://aistudio.google.com/billing (with the account that administers billing).";

/** Whether Google refused a call for lack of credit in the last hour. */
async function refusedForCredit(admin: ReturnType<typeof createAdminClient>): Promise<boolean> {
  const { data, error } = await admin
    .from("api_request_logs")
    .select("error_message")
    .eq("api_name", "gemini")
    .gte("response_status", 400)
    .gte("timestamp", new Date(Date.now() - 60 * 60_000).toISOString())
    .limit(50);
  if (error) {
    console.error("[cron/engine-health] failed calls unreadable:", error.message);
    return false;
  }
  return (data ?? []).some((row) => isModelOutOfCredit(row.error_message));
}

export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("engine_health", { p_minutes: 60 });
  if (error || !data) {
    // Distinct from a healthy engine: the check did not run.
    console.error("[cron/engine-health] reading failed:", error?.message);
    return NextResponse.json({ ok: false, error: error?.message ?? "No reading" }, { status: 500 });
  }

  const health = data as EngineHealth;
  const verdict = engineVerdict(health);
  const reasons = [
    ...((await refusedForCredit(admin)) ? [OUT_OF_CREDIT] : []),
    ...(verdict.ok ? [] : verdict.reasons),
  ];
  if (reasons.length === 0) return NextResponse.json({ ok: true, health });

  const { allowed } = await alertThrottle.check(request, "engine");
  const alerted = allowed
    ? await sendOpsAlert("Plan engine failing", [...reasons, "", "Live numbers: https://monkeytravel.app/admin/mission"])
    : false;
  return NextResponse.json({ ok: false, health, reasons, alerted }, { status: 500 });
}
