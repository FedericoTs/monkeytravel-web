import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { recoveryLooksBroken, type RecoveryHealth } from "@/lib/ops/auth-health";
import { sendOpsAlert } from "@/lib/ops/alert";

/**
 * Weekly: is the password reset still working? A reset that fails silently
 * throws nothing, so the only evidence is Supabase's auth audit log: people
 * asking for resets while nobody's password ever changes. Read through the
 * service-role-only function auth_recovery_health. Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/auth-health
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOW_DAYS = 14;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "Service credentials missing" }, { status: 500 });
  }

  const db = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("auth_recovery_health", { p_days: WINDOW_DAYS });
  if (error) {
    console.error("[cron/auth-health] read failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const health = (Array.isArray(data) ? data[0] : data) as RecoveryHealth | undefined;
  if (!health) {
    return NextResponse.json({ ok: false, error: "No result from auth_recovery_health" }, { status: 500 });
  }

  const broken = recoveryLooksBroken(health);
  console.log(`[cron/auth-health] last ${WINDOW_DAYS} days: ${health.recoveries} reset requests by ${health.recovery_users} people, ${health.password_changes} password changes`);

  let alerted = false;
  if (broken) {
    alerted = await sendOpsAlert("Password reset may be broken", [
      `In the last ${WINDOW_DAYS} days ${health.recovery_users} people requested a password reset (${health.recoveries} requests) and nobody's password changed.`,
      "That is the signature of a reset link that lands somewhere it cannot be completed.",
      "Check: auth.audit_log_entries (user_recovery_requested vs user_updated_password) and app/[locale]/(app)/auth/reset-password.",
    ]);
  }
  return NextResponse.json({ ok: true, windowDays: WINDOW_DAYS, ...health, broken, alerted });
}
