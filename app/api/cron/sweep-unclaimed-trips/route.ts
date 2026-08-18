import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * Daily cron — deletes ownerless anonymous trips nobody ever claimed.
 *
 * An anonymous planner who shares a trip creates a row with no user_id, a
 * secret claim_token, and a 30-day claim_expires_at (see
 * /api/trips/anonymous). Most of those will never be claimed: the planner
 * shared a link, never signed up, and moved on. Without this sweep the table
 * would accumulate them forever.
 *
 * SAFETY — three independent conditions, all required, so there is no code
 * path that can touch a real user's trip:
 *   user_id IS NULL      a claimed trip has an owner and is permanently safe
 *   claim_token NOT NULL claimed rows have their token cleared by the RPC
 *   claim_expires_at < now()
 *
 * The trips_user_id_required_for_non_templates CHECK guarantees every
 * ownerless non-template row carries BOTH a token and an expiry, so no
 * anonymous row can hide from this filter by having a null expiry.
 *
 * Note this is a HARD delete, not the soft delete used for user-owned trips.
 * A soft delete exists so an owner can recover a trip they removed by mistake;
 * an unclaimed anonymous row has no owner to recover it, and leaving tombstones
 * would defeat the point of the sweep.
 *
 * Schedule: daily via vercel.json. Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/sweep-unclaimed-trips
 *
 * Auth: CRON_SECRET. Without it, 401. Vercel sends the secret automatically.
 */

// Bounded per run so a backlog can never approach the 60s function cap. At one
// run a day this clears far more than the loop realistically produces; if it
// ever saturates, the leftovers simply go on the next day's run.
const MAX_DELETIONS_PER_RUN = 500;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing for cron");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) return unauthorized();
  if (auth !== `Bearer ${secret}`) return unauthorized();

  const svc = serviceClient();
  const nowIso = new Date().toISOString();
  const startedAt = Date.now();

  try {
    // Select first, delete by explicit id list. Deleting straight off the
    // filter would work, but resolving the ids up front bounds the write,
    // makes the run auditable in logs, and means a filter mistake shows up as
    // a surprising id count rather than as missing rows.
    const { data: doomed, error: selectError } = await svc
      .from("trips")
      .select("id")
      .is("user_id", null)
      .not("claim_token", "is", null)
      .lt("claim_expires_at", nowIso)
      .limit(MAX_DELETIONS_PER_RUN);

    if (selectError) {
      console.error("[sweep-unclaimed] select failed:", selectError);
      return NextResponse.json(
        { ok: false, error: "select_failed" },
        { status: 500 }
      );
    }

    const ids = (doomed ?? []).map((r) => r.id as string);
    if (ids.length === 0) {
      return NextResponse.json({
        ok: true,
        deleted: 0,
        note: "nothing expired",
        ms: Date.now() - startedAt,
      });
    }

    // The ownership conditions are repeated on the DELETE itself, not just the
    // SELECT. Between the two statements a planner could have signed up and
    // claimed one of these ids; re-asserting user_id IS NULL means that row is
    // skipped instead of having a just-claimed trip deleted underneath them.
    const { error: deleteError, count } = await svc
      .from("trips")
      .delete({ count: "exact" })
      .in("id", ids)
      .is("user_id", null)
      .not("claim_token", "is", null)
      .lt("claim_expires_at", nowIso);

    if (deleteError) {
      console.error("[sweep-unclaimed] delete failed:", deleteError);
      return NextResponse.json(
        { ok: false, error: "delete_failed" },
        { status: 500 }
      );
    }

    const deleted = count ?? 0;
    console.log(
      `[sweep-unclaimed] deleted ${deleted}/${ids.length} expired unclaimed anonymous trips`
    );

    return NextResponse.json({
      ok: true,
      deleted,
      selected: ids.length,
      // A gap means someone claimed a trip mid-run — expected and healthy.
      claimedDuringRun: ids.length - deleted,
      capped: ids.length === MAX_DELETIONS_PER_RUN,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[sweep-unclaimed] unexpected error:", err);
    return NextResponse.json({ ok: false, error: "unexpected" }, { status: 500 });
  }
}
