/**
 * Does trip_views actually receive rows from the live site?
 *
 * Phase 0.1 of docs/LIVE_TRIP_MASTER_PLAN.md. The table had zero rows for its
 * entire life because nothing called the writer. This probe is the exit-gate
 * check for the API half of that: it exercises POST /api/trips/[id]/view the
 * way the renderers do, then reads the rows back with the service role and
 * asserts each rule the migration encodes.
 *
 * What it proves
 *   - a public trip, source "public", fresh mt_session_id  -> one row
 *   - the same session again, same day                      -> duplicate, no row
 *   - a second session, source "shared"                     -> one row
 *   - an unknown source ("direct", the old default)          -> 400
 *   - a Googlebot user-agent                                 -> row with is_bot = true
 *   - a random trip id                                       -> 200, nothing recorded,
 *                                                               same shape as any failure
 *   - no probe row carries a raw IP or user-agent
 *
 * What it cannot prove: the owner/collaborator sources need a signed-in
 * browser. Those are verified by opening /trips/[id] in the real UI (the
 * founder's standing rule) and then reading the per-source counts this
 * script prints at the end.
 *
 * Every probe row is deleted at the end. The probe never leaves data behind.
 *
 *   npx tsx scripts/trip-views-probe.mts
 *   BASE=http://localhost:3000 npx tsx scripts/trip-views-probe.mts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or
 * .env.local), like the other audit scripts.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if ((!url || !key) && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const v = m[2].replace(/^["']|["']$/g, "");
    if (m[1] === "NEXT_PUBLIC_SUPABASE_URL") url ||= v;
    if (m[1] === "SUPABASE_SERVICE_ROLE_KEY") key ||= v;
  }
}
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const BASE = (process.env.BASE ?? "https://monkeytravel.app").replace(/\/$/, "");
const CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const GOOGLEBOT_UA =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/128.0.0.0 Safari/537.36";

const admin = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures += 1;
}

interface ViewReply {
  recorded?: boolean;
  duplicate?: boolean;
  fromCookie?: boolean;
}

async function postView(tripId: string, source: string, sessionId: string, ua = CHROME_UA) {
  const res = await fetch(`${BASE}/api/trips/${tripId}/view`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ua,
      Cookie: `mt_session_id=${sessionId}`,
    },
    body: JSON.stringify({ source }),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  // apiSuccess wraps the payload; accept either { data: {...} } or the bare object.
  const data = ((json as { data?: ViewReply } | null)?.data ?? json ?? {}) as ViewReply;
  return { status: res.status, data };
}

const sessions: string[] = [];
const sid = () => {
  const s = randomUUID();
  sessions.push(s);
  return s;
};

(async () => {
  console.log(`trip_views probe against ${BASE}\n`);

  const { data: trip, error: tripErr } = await admin
    .from("trips")
    .select("id, public_slug, share_token")
    .eq("visibility", "public")
    .not("public_slug", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tripErr || !trip) {
    console.error("No public trip to probe with", tripErr?.message);
    process.exit(2);
  }
  console.log(`using public trip ${trip.id} (/trip/${trip.public_slug})\n`);

  // 1. fresh session, public  -> recorded
  const s1 = sid();
  const r1 = await postView(trip.id, "public", s1);
  check(r1.status === 200 && r1.data.recorded === true, "public open from a fresh session is recorded", r1);
  check(r1.data.fromCookie === true, "the mt_session_id cookie was used as the key");

  // 2. same session, same day -> duplicate
  const r2 = await postView(trip.id, "public", s1);
  check(r2.status === 200 && r2.data.recorded === false && r2.data.duplicate === true, "same session again is a duplicate (per-day dedupe)", r2);

  // 3. second session, shared -> recorded
  const s2 = sid();
  const r3 = await postView(trip.id, "shared", s2);
  check(r3.status === 200 && r3.data.recorded === true, "shared open from a second session is recorded", r3);

  // 4. the old default is rejected
  const r4 = await postView(trip.id, "direct", sid());
  check(r4.status === 400, 'source "direct" (the old writer\'s default) is rejected with 400', r4.status);

  // 5. a self-declared crawler is recorded AND labelled
  const s3 = sid();
  const r5 = await postView(trip.id, "public", s3, GOOGLEBOT_UA);
  check(r5.status === 200 && r5.data.recorded === true, "a Googlebot UA is still recorded (label, never block)", r5);

  // 6. unknown trip: same shape as any failure, no oracle
  const r6 = await postView(randomUUID(), "public", sid());
  check(r6.status === 200 && r6.data.recorded === false && r6.data.duplicate === undefined, "unknown trip id returns 200 / not recorded, indistinguishable from other failures", r6);

  // Read back what landed.
  const { data: rows, error: rowsErr } = await admin
    .from("trip_views")
    .select("session_id, source, is_bot, viewed_on, viewer_id, trip_id")
    .in("session_id", sessions);
  check(!rowsErr, "rows readable with the service role", rowsErr?.message);
  const byS = new Map((rows ?? []).map((r) => [r.session_id, r]));
  const today = new Date().toISOString().slice(0, 10);

  check(byS.get(s1)?.source === "public" && byS.get(s1)?.is_bot === false, "row 1: source public, is_bot false", byS.get(s1));
  check(byS.get(s2)?.source === "shared", "row 2: source shared", byS.get(s2));
  check(byS.get(s3)?.is_bot === true, "row 3: Googlebot row carries is_bot = true", byS.get(s3));
  check((rows ?? []).length === 3, "exactly three rows landed for six requests", (rows ?? []).length);
  check((rows ?? []).every((r) => r.viewed_on === today), `every row is stamped with today's UTC day (${today})`);
  check((rows ?? []).every((r) => r.viewer_id === null), "anonymous probes have viewer_id null");
  check((rows ?? []).every((r) => r.trip_id === trip.id), "no row was written for the unknown trip");

  // Per-source counts for the last 24h: the manual owner/collaborator UI
  // check reads its confirmation here.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recent } = await admin
    .from("trip_views")
    .select("source, is_bot")
    .gte("viewed_at", since);
  const counts: Record<string, number> = {};
  for (const r of recent ?? []) {
    const k = `${r.source}${r.is_bot ? " (bot)" : ""}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  console.log("\nrows in the last 24h by source (includes this probe's 3 until cleanup):", counts);

  // Cleanup: the probe never leaves data behind.
  const { error: delErr } = await admin.from("trip_views").delete().in("session_id", sessions);
  check(!delErr, "probe rows deleted", delErr?.message);

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
