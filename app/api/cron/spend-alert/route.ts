import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { summarizeSpend, previousUtcDay, type SpendRow } from "@/lib/ops/spend";
import { sendOpsAlert } from "@/lib/ops/alert";

/**
 * Daily: yesterday's paid-API spend from api_request_logs, emailed to the
 * owner when it passes DAILY_SPEND_ALERT_USD (default 20). Runs each morning
 * (vercel.json); manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/spend-alert
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
    return NextResponse.json({ ok: false, error: "Service credentials missing" }, { status: 500 });
  }

  const limitUsd = Number(process.env.DAILY_SPEND_ALERT_USD) || 20;
  const day = previousUtcDay();
  const db = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from("api_request_logs")
    .select("api_name, cost_usd, request_params")
    .gte("timestamp", day.start)
    .lt("timestamp", day.end)
    .limit(50000);
  if (error) {
    console.error("[cron/spend-alert] read failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const summary = summarizeSpend((data ?? []) as SpendRow[], limitUsd);
  console.log(`[cron/spend-alert] ${day.label}: $${summary.totalUsd} across ${summary.byApi.length} APIs (limit $${limitUsd})`);

  let alerted = false;
  if (summary.over) {
    alerted = await sendOpsAlert(`Paid APIs cost $${summary.totalUsd} on ${day.label} (limit $${limitUsd})`, [
      `Spend on ${day.label} (UTC) passed the daily limit of $${limitUsd}.`,
      "",
      ...summary.byApi.map((a) => `${a.apiName.padEnd(28)} $${a.usd.toFixed(2).padStart(8)}  ${a.calls} calls`),
      "",
      "Kill switches: /admin (API control). Detail: /admin/costs.",
    ]);
  }
  return NextResponse.json({ ok: true, day: day.label, limitUsd, ...summary, alerted });
}
