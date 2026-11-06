import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { summarizeSpend, previousUtcDay, monthToDateBefore, type SpendGroup } from "@/lib/ops/spend";
import { sendOpsAlert } from "@/lib/ops/alert";
import { readCreditEstimate, type CreditEstimate } from "@/lib/ops/gemini-credit";
import { refuseUnlessCron } from "@/lib/api/cron-auth";

/**
 * Daily: yesterday's paid-API spend, estimated after Google's free monthly
 * allowances, emailed to the owner when it passes DAILY_SPEND_ALERT_USD
 * (default 20). The sums come from api_spend_by_unit, for the month before
 * yesterday and for yesterday. It also emails when about a week of the prepaid
 * Gemini credit is left (lib/ops/gemini-credit.ts). Runs each morning
 * (vercel.json); manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/spend-alert
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const usd = (n: number) => `$${n.toFixed(2)}`;
const row = (api: string, calls: string, list: string, estimated: string) =>
  `${api.padEnd(28)} ${calls.padStart(7)} ${list.padStart(10)} ${estimated.padStart(10)}`;

const alertLowCredit = (credit: CreditEstimate) =>
  sendOpsAlert(`Gemini credit is running low: about ${usd(credit.usd)} left`, [
    `About ${usd(credit.usd)} of the prepaid Gemini credit is left${credit.lasts ? `, ${credit.lasts} at the last week's pace` : ""}.`,
    `That's the ${usd(credit.reading.usd)} AI Studio showed on ${credit.reading.at.slice(0, 10)}, less ${usd(credit.spentUsd)} logged since. Test runs aren't logged, so it can be less.`,
    "",
    "At $0 every AI call stops until it's topped up: https://aistudio.google.com/billing (with the account that administers billing).",
    "Then type the new balance on the Costs tab of /admin, and this email stops.",
  ]);

export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "Service credentials missing" }, { status: 500 });
  }

  const limitUsd = Number(process.env.DAILY_SPEND_ALERT_USD) || 20;
  const day = previousUtcDay();
  const month = monthToDateBefore(day);
  const db = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [before, yesterday] = await Promise.all([
    db.rpc("api_spend_by_unit", { p_from: month.start, p_to: month.end }),
    db.rpc("api_spend_by_unit", { p_from: day.start, p_to: day.end }),
  ]);
  const error = before.error ?? yesterday.error;
  if (error) {
    console.error("[cron/spend-alert] read failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const summary = summarizeSpend((before.data ?? []) as SpendGroup[], (yesterday.data ?? []) as SpendGroup[], limitUsd);
  console.log(
    `[cron/spend-alert] ${day.label}: est. ${usd(summary.estimatedUsd)} (${usd(summary.listUsd)} at list price) across ${summary.byApi.length} APIs (limit $${limitUsd})`
  );

  let alerted = false;
  if (summary.over) {
    alerted = await sendOpsAlert(`Paid APIs cost an estimated ${usd(summary.estimatedUsd)} on ${day.label} (limit $${limitUsd})`, [
      `Estimated spend on ${day.label} (UTC) passed the daily limit of $${limitUsd}.`,
      "Estimate: Places calls past each SKU's free monthly allowance at list price,",
      "everything else as logged. The Google Cloud bill is the source of truth.",
      "",
      row("API", "calls", "list", "estimated"),
      ...summary.byApi.map((a) => row(a.apiName, String(a.calls), usd(a.listUsd), usd(a.estimatedUsd))),
      row("total", "", usd(summary.listUsd), usd(summary.estimatedUsd)),
      "",
      "Kill switches: /admin (API control). Detail: the Costs tab of /admin.",
    ]);
  }
  const credit = await readCreditEstimate();
  const creditAlerted = credit?.low ? await alertLowCredit(credit) : false;
  return NextResponse.json({ ok: true, day: day.label, limitUsd, ...summary, alerted, creditAlerted });
}
