/**
 * trip_today_actions probe — Live Trip Phase 3.3.
 *
 * Against a running deployment (BASE) + a LIVE shared trip (SHARE_TOKEN, or
 * the newest shared trip), proves:
 *   - the anon key can read trip_today_actions (public SELECT, for realtime)
 *     but cannot write it;
 *   - POST today-action applies running_late / skip / done, keyed on the
 *     mt_anon_voter cookie, and a double-tap is idempotent (one active row);
 *   - undo (soft) removes it and only the actor may undo;
 *   - cookie-less scripting UAs are refused.
 * Cleans up its rows.
 *
 *   SHARE_TOKEN=<uuid> BASE=http://localhost:3001 npx tsx scripts/today-actions-probe.mts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const env: Record<string, string> = {};
if (existsSync(".env.local")) for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const need = (k: string) => process.env[k] ?? env[k] ?? "";
const url = need("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !serviceKey || !anonKey) { console.error("Missing supabase env"); process.exit(2); }
const BASE = (process.env.BASE ?? "https://monkeytravel.app").replace(/\/$/, "");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
let failures = 0;
const check = (ok: boolean, label: string, detail?: unknown) => { console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail !== undefined ? "  " + JSON.stringify(detail).slice(0, 180) : ""}`); if (!ok) failures++; };

interface Action { id: string; action_type: string; activity_id: string | null; undone_at: string | null; mine?: boolean }
const cookie = "probe_" + randomBytes(12).toString("base64url");

async function call(token: string, body: unknown, opts: { cookie?: string; ua?: string } = {}) {
  const res = await fetch(`${BASE}/api/shared/${token}/today-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts.ua === undefined ? { "User-Agent": UA } : opts.ua ? { "User-Agent": opts.ua } : {}), ...(opts.cookie ? { Cookie: `mt_anon_voter=${opts.cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  let j: unknown = null; try { j = await res.json(); } catch { j = null; }
  const data = ((j as { data?: Action[] } | null)?.data ?? j ?? []) as Action[];
  return { status: res.status, data };
}

(async () => {
  console.log(`today-actions probe against ${BASE}\n`);
  let token = process.env.SHARE_TOKEN ?? "";
  if (!token) {
    const { data } = await admin.from("trips").select("id, share_token").not("share_token", "is", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    token = (data?.share_token as string) ?? "";
  }
  if (!token) { console.error("no shared trip"); process.exit(2); }
  const { data: trip } = await admin.from("trips").select("id").eq("share_token", token).maybeSingle();
  const tripId = trip?.id as string;
  console.log(`trip ${tripId}\n`);

  try {
    // 1. RLS: anon reads (public), anon cannot write
    const anonRead = await anon.from("trip_today_actions").select("id").limit(1);
    check(!anonRead.error, "anon key CAN SELECT trip_today_actions (public read for realtime)", anonRead.error?.code ?? "ok");
    const anonWrite = await anon.from("trip_today_actions").insert({ trip_id: tripId, day_number: 2, action_type: "skip", actor_role: "participant", actor_cookie_id: cookie + "_rls" });
    check(!!anonWrite.error, "anon key CANNOT INSERT trip_today_actions", anonWrite.error?.code);

    // 2. running_late apply + idempotent double-tap
    const r1 = await call(token, { action_type: "running_late", day_number: 2 }, { cookie });
    check(r1.status === 200 && r1.data.some((a) => a.action_type === "running_late" && a.mine), "running_late applied (mine)", r1.status);
    const r2 = await call(token, { action_type: "running_late", day_number: 2 }, { cookie });
    const lateCount = r2.data.filter((a) => a.action_type === "running_late" && a.mine && a.undone_at === null).length;
    check(r2.status === 200 && lateCount === 1, "double-tap is idempotent (one active running_late)", { lateCount });

    // 3. skip a specific activity
    const r3 = await call(token, { action_type: "skip", day_number: 2, activity_id: "c-d2a2" }, { cookie });
    const skip = r3.data.find((a) => a.action_type === "skip" && a.activity_id === "c-d2a2" && a.mine);
    check(!!skip, "skip applied on the activity", { found: !!skip });

    // 4. undo the skip (mine) ; a stranger cannot undo it
    const stranger = "probe_" + randomBytes(12).toString("base64url");
    const rStranger = await call(token, { undo: true, action_id: skip!.id }, { cookie: stranger });
    const stillThere = rStranger.data.find((a) => a.id === skip!.id && a.undone_at === null);
    check(rStranger.status === 200 && !!stillThere, "a different cookie CANNOT undo my action", { stillActive: !!stillThere });
    const rUndo = await call(token, { undo: true, action_id: skip!.id }, { cookie });
    const gone = !rUndo.data.find((a) => a.id === skip!.id && a.undone_at === null);
    check(rUndo.status === 200 && gone, "actor can undo their own action (soft)", { gone });

    // 5. done (day-level)
    const rDone = await call(token, { action_type: "done", day_number: 2 }, { cookie });
    check(rDone.status === 200 && rDone.data.some((a) => a.action_type === "done" && a.activity_id === null && a.mine), "done (day-level) applied", rDone.status);

    // 6. bad input + cookie-less scripting UA
    const rBad = await call(token, { action_type: "nope", day_number: 2 }, { cookie });
    check(rBad.status === 400, "invalid action_type → 400", rBad.status);
    const rCurl = await call(token, { action_type: "skip", day_number: 2, activity_id: "c-d2a1" }, { ua: "curl/8.0" });
    check(rCurl.status === 400, "cookie-less curl → 400", rCurl.status);
  } finally {
    await admin.from("trip_today_actions").delete().eq("trip_id", tripId).like("actor_cookie_id", "probe_%");
    console.log("\ncleanup: probe rows deleted");
  }
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
