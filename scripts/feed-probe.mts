/**
 * Today activity-feed probe — Live Trip Phase 3.5.
 *
 * Against a running deployment (BASE) + a shared trip (SHARE_TOKEN or the
 * newest), seeds one of each source row (a named participant, a chip action),
 * then GETs /api/shared/[token]/feed and proves the merge:
 *   - a named join and the chip action both appear;
 *   - activity ids are resolved to names for the chip;
 *   - the stream is newest-first;
 *   - the chip carries its actor;
 *   - an invalid token is rejected.
 * The chip writes themselves are already covered by the 3.3 probe;
 * this asserts only what 3.5 adds — the merge. Cleans up its own rows.
 *
 *   SHARE_TOKEN=<uuid> BASE=http://localhost:3001 npx tsx scripts/feed-probe.mts
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const env: Record<string, string> = {};
if (existsSync(".env.local")) for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const need = (k: string) => process.env[k] ?? env[k] ?? "";
const url = need("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) { console.error("Missing supabase env"); process.exit(2); }
const BASE = (process.env.BASE ?? "https://monkeytravel.app").replace(/\/$/, "");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
const check = (ok: boolean, label: string, d?: unknown) => { console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${d !== undefined ? "  " + JSON.stringify(d).slice(0, 220) : ""}`); if (!ok) failures++; };

interface FeedEvent { id: string; kind: string; at: string; actorName: string | null; actorIsOwner: boolean; activityName: string | null; minutes?: number; swapTo?: string | null }
const suffix = randomBytes(6).toString("hex");

async function getFeed(token: string): Promise<{ status: number; events: FeedEvent[] }> {
  const res = await fetch(`${BASE}/api/shared/${token}/feed`, { cache: "no-store" as RequestCache });
  let j: unknown = null; try { j = await res.json(); } catch { j = null; }
  const data = ((j as { data?: { events?: FeedEvent[] } } | null)?.data ?? j) as { events?: FeedEvent[] } | null;
  return { status: res.status, events: Array.isArray(data?.events) ? data!.events! : [] };
}

(async () => {
  console.log(`feed probe against ${BASE}\n`);
  let token = process.env.SHARE_TOKEN ?? "";
  if (!token) { const { data } = await admin.from("trips").select("share_token").not("share_token", "is", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(); token = (data?.share_token as string) ?? ""; }
  if (!token) { console.error("no shared trip"); process.exit(2); }
  const { data: trip } = await admin.from("trips").select("id, user_id, itinerary").eq("share_token", token).maybeSingle();
  const tripId = trip?.id as string;
  const days = (trip?.itinerary as { day_number?: number; activities?: { id?: string; name?: string }[] }[] | null) ?? [];
  const firstAct = days.flatMap((d) => d.activities ?? []).find((a) => a?.id && a?.name);
  const actId = firstAct?.id ?? null;
  const actName = firstAct?.name ?? null;
  console.log(`trip ${tripId} · activity ${actId ? `"${actName}" (${actId})` : "(none — chip name resolution not asserted)"}\n`);

  const partCookie = `probe_feed_${suffix}`;
  const now = Date.now();
  try {
    // seed one of each source, spaced in time so ordering is deterministic
    await admin.from("trip_participants").upsert(
      [{ trip_id: tripId, participant_cookie_id: partCookie, display_name: `Feed Joiner ${suffix}`, source: "shared", joined_at: new Date(now - 3 * 60_000).toISOString() }],
      { onConflict: "trip_id,participant_cookie_id" },
    );
    await admin.from("trip_today_actions").insert({
      trip_id: tripId, day_number: 1, action_type: "skip", activity_id: actId,
      actor_cookie_id: partCookie, actor_name: `Feed Chipper ${suffix}`, actor_role: "participant",
      payload: {}, created_at: new Date(now - 2 * 60_000).toISOString(),
    });

    const { status, events } = await getFeed(token);
    check(status === 200, "GET feed → 200", status);

    const join = events.find((e) => e.kind === "join" && e.actorName === `Feed Joiner ${suffix}`);
    check(!!join, "named participant join appears", { found: !!join });

    const skip = events.find((e) => e.kind === "skip" && e.actorName === `Feed Chipper ${suffix}`);
    check(!!skip, "chip action appears with its actor", { found: !!skip });
    if (actName) check(skip?.activityName === actName, "chip activity id resolved to a name", { name: skip?.activityName });

    // ordering: newest-first (chip seeded last → before join)
    const idx = (id?: string) => (id ? events.findIndex((e) => e.id === id) : -1);
    check(idx(skip?.id) < idx(join?.id), "stream is newest-first", { skip: idx(skip?.id), join: idx(join?.id) });

    // invalid token rejected
    const badRes = await fetch(`${BASE}/api/shared/not-a-uuid/feed`, { cache: "no-store" as RequestCache });
    check(badRes.status === 400, "invalid token → 400", badRes.status);
  } finally {
    await admin.from("trip_today_actions").delete().eq("trip_id", tripId).like("actor_cookie_id", "probe_feed_%");
    await admin.from("trip_participants").delete().eq("trip_id", tripId).like("participant_cookie_id", "probe_feed_%");
    console.log("\ncleanup: probe rows deleted");
  }
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
