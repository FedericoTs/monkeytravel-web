/**
 * A suppressed reminder row must be revivable; a sent one must never be revived.
 *
 * The 2026-08-27 manual hold suppressed 670 rows and nothing in the product
 * could undo it: enqueue_trip_notifications deletes only `pending` rows before
 * re-inserting, while the unique index on (trip_id, slot) covers every status,
 * so `ON CONFLICT DO NOTHING` silently dropped the whole cascade for 129 trips
 * / 106 users. The RPC now revives a SUPPRESSED row on conflict instead.
 *
 * The dangerous half of that change is the guard: revive `suppressed`, never
 * `sent`. Without it a date change would mail the same reminder twice. This
 * probe asserts both directions against the real database.
 *
 * Creates and deletes its own user and trip. Sends no email: it only moves
 * queue rows, and every row it creates is deleted before it could ever come
 * due (they are scheduled weeks out, and the cron only reads `pending` rows
 * whose moment has passed).
 *
 *   node scripts/probe-enqueue-revive.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

const { url, key } = creds();
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);

const day = (n) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const rows = async (tripId) => {
  const { data } = await db
    .from("scheduled_notifications")
    .select("slot, status, skipped_reason, scheduled_for")
    .eq("trip_id", tripId)
    .order("scheduled_for", { ascending: true });
  return data ?? [];
};

const email = `mt-probe+enqueue-${Date.now()}@test.local`;
const { data: created, error: cErr } = await db.auth.admin.createUser({
  email, password: "Probe!" + Math.random().toString(36).slice(2, 12), email_confirm: true,
});
if (cErr) { console.error("could not create probe user:", cErr.message); process.exit(1); }
const uid = created.user.id;

let tripId = null;
try {
  console.log("\n=== 1. a fresh trip queues its full cascade ===");
  const { data: trip, error: tErr } = await db
    .from("trips")
    .insert({
      user_id: uid,
      title: "mt-probe enqueue revive",
      description: "",
      start_date: day(30),
      end_date: day(34),
      status: "planning",
      visibility: "private",
      itinerary: [],
    })
    .select("id")
    .single();
  if (tErr || !trip) { fail(`could not create the probe trip: ${tErr?.message}`); throw new Error("stop"); }
  tripId = trip.id;

  const { data: n1, error: e1 } = await db.rpc("enqueue_trip_notifications", { p_trip_id: tripId, p_user_id: uid });
  if (e1) fail(`enqueue failed: ${e1.message}`);
  const after1 = await rows(tripId);
  note(`enqueue returned ${n1}; rows: ${after1.map((r) => `${r.slot}=${r.status}`).join(", ")}`);
  if (after1.length !== 5) fail(`expected 5 queued slots, got ${after1.length}`);
  else if (after1.some((r) => r.status !== "pending")) fail("a freshly queued row is not pending");
  else ok("5 slots queued, all pending");

  console.log("\n=== 2. a suppressed row is revived by re-enqueue (the hold's failure mode) ===");
  const victim = "weather_3d";
  await db
    .from("scheduled_notifications")
    .update({ status: "suppressed", skipped_reason: "manual_hold_probe" })
    .eq("trip_id", tripId)
    .eq("slot", victim);
  const held = (await rows(tripId)).find((r) => r.slot === victim);
  if (held?.status !== "suppressed") fail("could not stage a suppressed row");
  else note(`staged ${victim} as suppressed/${held.skipped_reason}`);

  // A date change is what calls the RPC again in production.
  await db.from("trips").update({ start_date: day(31), end_date: day(35) }).eq("id", tripId);
  const { error: e2 } = await db.rpc("enqueue_trip_notifications", { p_trip_id: tripId, p_user_id: uid });
  if (e2) fail(`re-enqueue failed: ${e2.message}`);
  const after2 = await rows(tripId);
  const revived = after2.find((r) => r.slot === victim);
  if (!revived) fail(`${victim} vanished after re-enqueue`);
  else if (revived.status !== "pending") fail(`${victim} is still ${revived.status} after re-enqueue — the hold would still be permanent`);
  else if (revived.skipped_reason !== null) fail(`${victim} was revived but kept skipped_reason=${revived.skipped_reason}`);
  else ok(`${victim} revived to pending with skipped_reason cleared`);
  if (after2.length !== 5) fail(`expected 5 rows after re-enqueue, got ${after2.length} (a duplicate would mean a second email)`);
  else ok("still exactly 5 rows — no duplicate slot");

  console.log("\n=== 3. a SENT row is never revived (the double-send guard) ===");
  const sentSlot = "pack_early_14d";
  const before = (await rows(tripId)).find((r) => r.slot === sentSlot);
  await db
    .from("scheduled_notifications")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("trip_id", tripId)
    .eq("slot", sentSlot);
  await db.from("trips").update({ start_date: day(32), end_date: day(36) }).eq("id", tripId);
  const { error: e3 } = await db.rpc("enqueue_trip_notifications", { p_trip_id: tripId, p_user_id: uid });
  if (e3) fail(`third enqueue failed: ${e3.message}`);
  const after3 = await rows(tripId);
  const stillSent = after3.find((r) => r.slot === sentSlot);
  if (!stillSent) fail(`${sentSlot} vanished`);
  else if (stillSent.status !== "sent") fail(`${sentSlot} was flipped back to ${stillSent.status} — this WOULD send a second email`);
  else ok(`${sentSlot} stayed sent through a date change`);
  if (stillSent && before && stillSent.scheduled_for !== before.scheduled_for) {
    fail(`${sentSlot} had its scheduled_for rewritten (${before.scheduled_for} -> ${stillSent.scheduled_for})`);
  } else if (stillSent) ok("...and kept its original scheduled_for");
  if (after3.length !== 5) fail(`expected 5 rows, got ${after3.length}`);

  console.log("\n=== 4. the other slots still moved with the new dates ===");
  const moved = after3.filter((r) => r.status === "pending");
  if (moved.length !== 4) fail(`expected 4 pending rows, got ${moved.length}`);
  else ok("the four unsent slots are pending and re-dated");
} catch (err) {
  if (err.message !== "stop") fail(`unexpected error: ${err.message}`);
} finally {
  if (tripId) { try { await db.from("scheduled_notifications").delete().eq("trip_id", tripId); } catch { /* best effort */ } }
  if (tripId) { try { await db.from("trips").delete().eq("id", tripId); } catch { /* best effort */ } }
  try { await db.auth.admin.deleteUser(uid); } catch { /* best effort */ }
  note("probe user, trip and queue rows deleted");
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
