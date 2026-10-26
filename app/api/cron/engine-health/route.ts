import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { sendOpsAlert } from "@/lib/ops/alert";
import { engineVerdict, type EngineHealth } from "@/lib/ops/engine-health";

/**
 * Hourly: is the plan engine failing the people using it? (engine_health(),
 * lib/ops/engine-health.ts). While it is, the owner gets an email at most every
 * six hours and the run fails; /admin/mission shows the same reading.
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/engine-health
 */

export const dynamic = "force-dynamic";

const alertThrottle = createRateLimiter("engine-alert", 1, 6 * 60 * 60_000);

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await createAdminClient().rpc("engine_health", { p_minutes: 60 });
  if (error || !data) {
    // Distinct from a healthy engine: the check did not run.
    console.error("[cron/engine-health] reading failed:", error?.message);
    return NextResponse.json({ ok: false, error: error?.message ?? "No reading" }, { status: 500 });
  }

  const health = data as EngineHealth;
  const verdict = engineVerdict(health);
  if (verdict.ok) return NextResponse.json({ ok: true, health });

  const { allowed } = await alertThrottle.check(request, "engine");
  const alerted = allowed
    ? await sendOpsAlert("Plan engine failing", [...verdict.reasons, "", "Live numbers: https://monkeytravel.app/admin/mission"])
    : false;
  return NextResponse.json({ ok: false, health, reasons: verdict.reasons, alerted }, { status: 500 });
}
