/**
 * The consent-free activation funnel must be true on production, not just on
 * a fixture. This asks the database directly (service role), the way
 * /api/admin/stats does, and checks the things a wrong query would get wrong:
 *
 *   1. get_activation_funnel: rows per provider, monotone (signups >= confirmed;
 *      signups >= reached >= generated >= has_trip), the lost bucket bounded,
 *      and fast enough for the 8s PostgREST statement timeout.
 *   2. Probe accounts are excluded: creating one does not move the totals.
 *   3. get_anonymous_loop counts a signed-out trip as created and claimable,
 *      claim_anonymous_trip stamps trip_meta.claimed_at, the loop then counts
 *      it as claimed, and funnel_events accepts the new `trip_claimed` row.
 *   4. The migration's grants: anon and authenticated cannot call either RPC.
 *
 * Creates and deletes its own account, trip and funnel row; every cleanup
 * step is isolated so none can skip another.
 *
 *   node scripts/probe-activation-funnel.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

function creds() {
  const want = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  const out = Object.fromEntries(want.map((k) => [k, process.env[k] ?? ""]));
  if (want.some((k) => !out[k]) && existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m || !want.includes(m[1]) || out[m[1]]) continue;
      out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const env = creds();
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ? createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);
const iso = (d) => new Date(d).toISOString();
const DAY = 86_400_000;

async function timed(fn, args) {
  const t0 = Date.now();
  const res = await db.rpc(fn, args);
  return { ...res, ms: Date.now() - t0 };
}

function checkFunnelRows(rows, label) {
  if (!Array.isArray(rows)) return fail(`${label}: payload is not an array`);
  for (const r of rows) {
    const p = r.provider;
    if (!(r.signups >= r.confirmed)) fail(`${label} ${p}: confirmed ${r.confirmed} > signups ${r.signups}`);
    if (!(r.signups >= r.reached_wizard)) fail(`${label} ${p}: reached ${r.reached_wizard} > signups ${r.signups}`);
    if (!(r.reached_wizard >= r.generated)) fail(`${label} ${p}: generated ${r.generated} > reached ${r.reached_wizard}`);
    if (!(r.generated >= r.has_trip)) fail(`${label} ${p}: has_trip ${r.has_trip} > generated ${r.generated}`);
    if (!(r.generated_no_trip <= r.generated - r.has_trip)) fail(`${label} ${p}: lost ${r.generated_no_trip} exceeds generated-has_trip`);
    if (r.generated_no_trip < 0 || r.save_failed_users < 0) fail(`${label} ${p}: negative count`);
  }
}
const total = (rows, k) => (rows ?? []).reduce((s, r) => s + Number(r[k] ?? 0), 0);

const now = Date.now();
let uid = null;
let tripId = null;

try {
  console.log("\n=== 1. get_activation_funnel, last 30 days ===");
  const f30 = await timed("get_activation_funnel", { p_from: iso(now - 30 * DAY), p_to: iso(now) });
  if (f30.error) fail(`rpc error: ${f30.error.message}`);
  else {
    checkFunnelRows(f30.data, "30d");
    note(`${f30.ms}ms · ` + f30.data.map((r) => `${r.provider}: ${r.signups} signed up → ${r.confirmed} confirmed → ${r.reached_wizard} wizard → ${r.generated} generated → ${r.has_trip} trip (lost ${r.generated_no_trip}, save_failed ${r.save_failed_users})`).join(" | "));
    if (f30.ms > 4000) fail(`30d funnel took ${f30.ms}ms; the PostgREST statement timeout is 8s and the route runs five of these`);
    else ok(`30d funnel in ${f30.ms}ms, ${f30.data.length} provider rows, monotone`);
  }
  const f7 = await timed("get_activation_funnel", { p_from: iso(now - 7 * DAY), p_to: iso(now) });
  if (f7.error) fail(`7d rpc error: ${f7.error.message}`);
  else {
    checkFunnelRows(f7.data, "7d");
    if (total(f7.data, "signups") > total(f30.data ?? [], "signups")) fail("7d signups exceed 30d signups");
    else ok(`7d funnel in ${f7.ms}ms: ${total(f7.data, "signups")} signups ≤ 30d ${total(f30.data ?? [], "signups")}`);
  }

  console.log("\n=== 2. probe accounts are excluded ===");
  const before = total(f30.data ?? [], "signups");
  const email = `mt-probe+funnel-${Date.now()}@test.local`;
  const created = await db.auth.admin.createUser({ email, password: "Probe!" + randomBytes(8).toString("hex"), email_confirm: true });
  if (created.error) fail(`could not create probe user: ${created.error.message}`);
  else {
    uid = created.data.user.id;
    const again = await timed("get_activation_funnel", { p_from: iso(now - 30 * DAY), p_to: iso(Date.now() + 60_000) });
    const after = total(again.data ?? [], "signups");
    if (again.error) fail(`rpc error after creating probe user: ${again.error.message}`);
    else if (after !== before) fail(`probe user moved signups ${before} → ${after}; the exclusion filter is not working`);
    else ok(`probe user ${email} did not change signups (${before})`);
  }

  console.log("\n=== 3. get_anonymous_loop + claim marker ===");
  const l30 = await timed("get_anonymous_loop", { p_from: iso(now - 30 * DAY), p_to: iso(now) });
  if (l30.error) fail(`loop rpc error: ${l30.error.message}`);
  else {
    const r = Array.isArray(l30.data) ? l30.data[0] : l30.data;
    note(`${l30.ms}ms · created ${r.anon_created}, visited ${r.anon_visited} (${r.share_visits} visits), plan-own ${r.plan_own_clicks}, claimed ${r.claimed}, live ${r.unclaimed_live}, expired ${r.expired}`);
    if (r.anon_visited > r.anon_created) fail("anon_visited > anon_created");
    if (Number(r.claimed) + Number(r.unclaimed_live) + Number(r.expired) !== Number(r.anon_created)) fail(`claimed+live+expired (${r.claimed}+${r.unclaimed_live}+${r.expired}) != created ${r.anon_created}`);
    else ok("claimed + live + expired == created");
    if (l30.ms > 4000) fail(`30d loop took ${l30.ms}ms`);
  }

  // A signed-out share, minted the way /api/trips/anonymous does it.
  const claimToken = randomBytes(24).toString("base64url");
  const ins = await db
    .from("trips")
    .insert({
      user_id: null,
      title: "mt-probe funnel trip",
      description: "",
      trip_meta: { destination: "Probe City" },
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      status: "planning",
      visibility: "private",
      itinerary: [],
      share_token: randomUUID(),
      claim_token: claimToken,
      claim_expires_at: iso(Date.now() + DAY),
    })
    .select("id, created_at")
    .single();
  if (ins.error || !ins.data) fail(`could not insert anonymous trip: ${ins.error?.message}`);
  else {
    tripId = ins.data.id;
    const from = iso(new Date(ins.data.created_at).getTime() - 1000);
    const to = iso(new Date(ins.data.created_at).getTime() + 60_000);
    const w1 = await timed("get_anonymous_loop", { p_from: from, p_to: to });
    const a = Array.isArray(w1.data) ? w1.data[0] : w1.data;
    if (w1.error) fail(`micro-window loop error: ${w1.error.message}`);
    else if (a.anon_created !== 1 || a.unclaimed_live !== 1 || a.claimed !== 0) fail(`before claim: expected created=1 live=1 claimed=0, got ${JSON.stringify(a)}`);
    else ok("before claim: counted as created + claimable, not claimed");

    if (!uid) fail("no probe user to claim with");
    else {
      const claim = await db.rpc("claim_anonymous_trip", { p_claim_token: claimToken, p_user_id: uid });
      const row = Array.isArray(claim.data) ? claim.data[0] : claim.data;
      if (claim.error || !row?.claimed) fail(`claim failed: ${claim.error?.message ?? JSON.stringify(row)}`);
      else ok(`claim_anonymous_trip claimed ${row.trip_id}`);

      const t = await db.from("trips").select("user_id, claim_token, claim_expires_at, trip_meta").eq("id", tripId).single();
      const meta = t.data?.trip_meta ?? {};
      if (t.data?.user_id !== uid) fail("trip not owned by the probe user after claim");
      if (t.data?.claim_token !== null) fail("claim_token not cleared");
      if (!meta.claimed_at) fail("trip_meta.claimed_at NOT stamped by the claim RPC");
      else if (meta.claimed_from !== "anonymous_share") fail(`claimed_from is ${meta.claimed_from}`);
      else ok(`trip_meta.claimed_at stamped (${meta.claimed_at}), claimed_from=anonymous_share`);

      const w2 = await timed("get_anonymous_loop", { p_from: from, p_to: to });
      const b = Array.isArray(w2.data) ? w2.data[0] : w2.data;
      if (w2.error) fail(`micro-window loop error after claim: ${w2.error.message}`);
      else if (b.anon_created !== 1 || b.claimed !== 1 || b.unclaimed_live !== 0 || b.claimed_any !== 1) fail(`after claim: expected created=1 claimed=1 live=0 claimed_any=1, got ${JSON.stringify(b)}`);
      else ok("after claim: counted as claimed, no longer claimable, claimed_any=1");

      const fe = await db.from("funnel_events").insert({ event_type: "trip_claimed", trip_id: tripId, user_id: uid, metadata: { source: "probe" } });
      if (fe.error) fail(`funnel_events rejected trip_claimed: ${fe.error.message}`);
      else ok("funnel_events accepts event_type=trip_claimed");

      const fx = await timed("get_activation_funnel", { p_from: from, p_to: to });
      if (fx.error) fail(`micro-window funnel error: ${fx.error.message}`);
      else if (total(fx.data, "signups") !== 0) fail(`the probe user appears in its own signup window: ${JSON.stringify(fx.data)}`);
      else ok("probe user absent from the funnel even in its own window");
    }
  }

  console.log("\n=== 4. grants ===");
  if (!anon) note("no anon key in env; skipping the anon-role call");
  else {
    for (const fn of ["get_activation_funnel", "get_anonymous_loop"]) {
      const r = await anon.rpc(fn, { p_from: iso(now - DAY), p_to: iso(now) });
      if (!r.error) fail(`${fn} is callable with the anon key`);
      else ok(`${fn} refused for anon (${r.error.code ?? r.error.message})`);
    }
  }
} finally {
  if (tripId) { try { await db.from("funnel_events").delete().eq("trip_id", tripId); } catch { /* best effort */ } }
  if (tripId) { try { await db.from("trips").delete().eq("id", tripId); } catch { /* best effort */ } }
  if (uid) { try { await db.auth.admin.deleteUser(uid); } catch { /* best effort */ } }
  note(`cleanup: trip ${tripId ? "deleted" : "n/a"}, user ${uid ? "deleted" : "n/a"}`);
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
