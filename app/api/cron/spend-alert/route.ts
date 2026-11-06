import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeSpend, type SpendGroup } from "@/lib/ops/spend";
import { sendOpsAlert } from "@/lib/ops/alert";
import { readCreditEstimate, type CreditEstimate } from "@/lib/ops/gemini-credit";
import { refuseUnlessCron } from "@/lib/api/cron-auth";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * Hourly: the paid-API spend of the last 24 hours, estimated after Google's free
 * monthly allowances, emailed to the owner when it passes DAILY_SPEND_ALERT_USD
 * (default 6), at most once a day. The month's calls come from the daily sums in
 * api_cost_daily, so only the last 24 hours are summed from the raw logs. It also
 * emails once a day when an API nears its daily limit (api_config.daily_limit),
 * because past it people get fallbacks until midnight UTC. The morning run emails
 * when about a week of the prepaid Gemini credit is left (lib/ops/gemini-credit.ts).
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/spend-alert
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const CREDIT_CHECK_UTC_HOUR = 6;
const LIMIT_WARNING_SHARE = 0.9;

const alertThrottle = createRateLimiter("spend-alert", 1, DAY_MS);

const dateOf = (at: Date) => at.toISOString().slice(0, 10);
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

  const limitUsd = Number(process.env.DAILY_SPEND_ALERT_USD) || 6;
  const now = new Date();
  const from = new Date(now.getTime() - DAY_MS);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const db = createAdminClient();
  const [month, last24h, today, limits] = await Promise.all([
    db
      .from("api_cost_daily")
      .select("api_name, unit_usd, calls, usd:logged_usd")
      .eq("probe", false)
      .gte("day", dateOf(monthStart))
      .lt("day", dateOf(from)),
    db.rpc("api_spend_by_unit", { p_from: from.toISOString(), p_to: now.toISOString() }),
    db.rpc("api_spend_by_unit", { p_from: `${dateOf(now)}T00:00:00.000Z`, p_to: now.toISOString() }),
    db.from("api_config").select("api_name, daily_limit").not("daily_limit", "is", null),
  ]);
  const error = month.error ?? last24h.error ?? today.error ?? limits.error;
  if (error) {
    console.error("[cron/spend-alert] read failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const summary = summarizeSpend((month.data ?? []) as SpendGroup[], (last24h.data ?? []) as SpendGroup[], limitUsd);
  console.log(
    `[cron/spend-alert] last 24 hours: est. ${usd(summary.estimatedUsd)} (${usd(summary.listUsd)} at list price) across ${summary.byApi.length} APIs`
  );

  let alerted = false;
  if (summary.over && (await alertThrottle.check(request, "spend")).allowed) {
    alerted = await sendOpsAlert(`Paid APIs cost an estimated ${usd(summary.estimatedUsd)} in the last 24 hours (limit $${limitUsd})`, [
      `Estimated spend over the last 24 hours passed the daily limit of $${limitUsd}.`,
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
  const callsToday = new Map<string, number>();
  for (const g of (today.data ?? []) as SpendGroup[]) callsToday.set(g.api_name, (callsToday.get(g.api_name) ?? 0) + g.calls);
  const near = (limits.data ?? [])
    .map((l) => ({ api: l.api_name as string, calls: callsToday.get(l.api_name) ?? 0, limit: l.daily_limit as number }))
    .filter((l) => l.calls >= l.limit * LIMIT_WARNING_SHARE);
  const limitAlerted =
    near.length > 0 && (await alertThrottle.check(request, "limit")).allowed
      ? await sendOpsAlert(`Daily limit nearly reached: ${near.map((l) => l.api).join(", ")}`, [
          ...near.map((l) => `${l.api}: ${l.calls} of ${l.limit} calls today (UTC).`),
          "",
          "Past its limit an API stops until midnight UTC: photos become curated ones, lookups find nothing, and AI plans are refused.",
          "If this is real traffic, raise daily_limit in the api_config table. If it isn't, the limit is doing its job.",
        ])
      : false;

  const credit = now.getUTCHours() === CREDIT_CHECK_UTC_HOUR ? await readCreditEstimate() : null;
  const creditAlerted = credit?.low ? await alertLowCredit(credit) : false;
  return NextResponse.json({ ok: true, from: from.toISOString(), to: now.toISOString(), limitUsd, ...summary, alerted, near, limitAlerted, creditAlerted });
}
