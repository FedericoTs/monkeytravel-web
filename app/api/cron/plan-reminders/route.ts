import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseUnlessCron } from "@/lib/api/cron-auth";
import { utcToday } from "@/lib/plans/plan-reminder-dates";
import { sendDuePlanReminders } from "@/lib/plans/plan-reminders";

/**
 * Daily cron: the reminders before kept plans' trips that are due today, each
 * once, and the addresses whose trip has begun deleted
 * (lib/plans/plan-reminders.ts). Runs after the trip emails (07:00 UTC).
 *
 * Auth: CRON_SECRET as a Bearer token; without it, 401.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;
  try {
    const run = await sendDuePlanReminders(createAdminClient(), utcToday());
    return NextResponse.json({ ok: true, ...run });
  } catch (err) {
    console.error("[cron/plan-reminders] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Run failed" }, { status: 500 });
  }
}
