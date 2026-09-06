/**
 * In-trip day-digest enqueue probe — Live Trip Phase 4.1.
 *
 * Against the live DB, proves the migration + enqueue_trip_day_digests RPC:
 *   - a future N-day trip queues exactly the days-2..N digests, each stamped
 *     06:00 UTC on the day before that day (matching lib/notifications/digest);
 *   - the slots satisfy the widened CHECK (an insert proves it);
 *   - re-running is idempotent (no duplicates);
 *   - muting wipes the pending digests;
 *   - anon/authenticated cannot EXECUTE the enqueue family (lockdown migration).
 * Mutates one fixture trip's dates and restores them + deletes its probe rows.
 *
 *   KEY_FLOWS_TRIP_ID=<uuid> npx tsx scripts/digest-probe.mts
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

const env: Record<string, string> = {};
if (existsSync(".env.local")) for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const need = (k: string) => process.env[k] ?? env[k] ?? "";
const url = need("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !serviceKey) { console.error("Missing supabase env"); process.exit(2); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = anonKey ? createClient(url, anonKey, { auth: { persistSession: false } }) : null;
let failures = 0;
const check = (ok: boolean, label: string, d?: unknown) => { console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${d !== undefined ? "  " + JSON.stringify(d).slice(0, 200) : ""}`); if (!ok) failures++; };

const DAY_MS = 86_400_000;
function ymd(offsetDays: number): string {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
// Mirror of lib/notifications/digest.plannedDigests, inlined so the probe is
// standalone and checks the RPC against the arithmetic independently.
function expectedDigests(start: string, end: string): { day: number; slot: string; iso: string }[] {
  const s = Date.parse(`${start}T00:00:00Z`), e = Date.parse(`${end}T00:00:00Z`);
  const n = Math.min(21, Math.round((e - s) / DAY_MS) + 1);
  const now = Date.now(); const out = [];
  for (let k = 2; k <= n; k++) {
    const iso = new Date(s + (k - 2) * DAY_MS + 6 * 3_600_000).toISOString();
    if (Date.parse(iso) > now) out.push({ day: k, slot: `in_trip_day_${k}`, iso });
  }
  return out;
}

async function pendingDigests(tripId: string) {
  const { data } = await admin.from("scheduled_notifications")
    .select("slot, scheduled_for, status").eq("trip_id", tripId).like("slot", "in_trip_day_%").eq("status", "pending")
    .order("scheduled_for", { ascending: true });
  return data ?? [];
}

(async () => {
  console.log("digest enqueue probe (live DB)\n");
  let tripId = process.env.KEY_FLOWS_TRIP_ID ?? "";
  if (!tripId) {
    const { data } = await admin.from("trips").select("id").not("user_id", "is", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    tripId = (data?.id as string) ?? "";
  }
  if (!tripId) { console.error("no trip"); process.exit(2); }
  const { data: trip } = await admin.from("trips").select("id, user_id, start_date, end_date, reminders_muted, status").eq("id", tripId).single();
  if (!trip?.user_id) { console.error("trip has no owner"); process.exit(2); }
  const userId = trip.user_id as string;
  const orig = { start_date: trip.start_date, end_date: trip.end_date, reminders_muted: trip.reminders_muted, status: trip.status };
  console.log(`trip ${tripId} (owner ${userId})\n`);

  const START = ymd(3), END = ymd(7); // a 5-day future trip → digests for days 2..5
  const expected = expectedDigests(START, END);

  try {
    // wipe any stale probe rows, set a known future window
    await admin.from("scheduled_notifications").delete().eq("trip_id", tripId).like("slot", "in_trip_day_%");
    await admin.from("trips").update({ start_date: START, end_date: END, reminders_muted: false, status: "planning" }).eq("id", tripId);

    // 1. enqueue
    const { data: n1, error: e1 } = await admin.rpc("enqueue_trip_day_digests", { p_trip_id: tripId, p_user_id: userId });
    check(!e1, "RPC executes", e1?.message);
    check(n1 === expected.length, `enqueued days 2..N (expected ${expected.length})`, { returned: n1 });

    const rows1 = await pendingDigests(tripId);
    check(rows1.length === expected.length, "pending digest rows match expected count", { got: rows1.length });

    // 2. each expected day present, stamped 06:00 UTC on the day before day K
    let allMatch = true;
    for (const exp of expected) {
      const row = rows1.find((r) => r.slot === exp.slot);
      const iso = row ? new Date(row.scheduled_for as string).toISOString() : null;
      if (!row || iso !== exp.iso) { allMatch = false; console.log(`      mismatch ${exp.slot}: got ${iso} want ${exp.iso}`); }
    }
    check(allMatch, "every digest stamped 06:00 UTC on the day before its day");
    check(rows1.every((r) => /:00:00/.test(new Date(r.scheduled_for as string).toISOString().slice(11)) && new Date(r.scheduled_for as string).getUTCHours() === 6), "all stamps are exactly 06:00 UTC");

    // 3. idempotent re-enqueue — no duplicates
    await admin.rpc("enqueue_trip_day_digests", { p_trip_id: tripId, p_user_id: userId });
    const rows2 = await pendingDigests(tripId);
    check(rows2.length === expected.length, "re-enqueue is idempotent (no duplicates)", { got: rows2.length });

    // 4. muting wipes pending digests
    await admin.from("trips").update({ reminders_muted: true }).eq("id", tripId);
    const { data: n3 } = await admin.rpc("enqueue_trip_day_digests", { p_trip_id: tripId, p_user_id: userId });
    const rows3 = await pendingDigests(tripId);
    check(n3 === 0 && rows3.length === 0, "muted trip → 0 digests, pending wiped", { returned: n3, remaining: rows3.length });

    // 5. anon/authenticated cannot execute the enqueue family (lockdown migration)
    if (anon) {
      const { error: aerr } = await anon.rpc("enqueue_trip_day_digests", { p_trip_id: tripId, p_user_id: userId });
      check(!!aerr, "anon key CANNOT execute enqueue_trip_day_digests", aerr?.code ?? aerr?.message);
      const { error: derr } = await anon.rpc("dormant_followup_candidates", { p_stagger_days: 7 });
      check(!!derr, "anon key CANNOT execute dormant_followup_candidates", derr?.code ?? derr?.message);
    }
  } finally {
    await admin.from("scheduled_notifications").delete().eq("trip_id", tripId).like("slot", "in_trip_day_%");
    await admin.from("trips").update(orig).eq("id", tripId);
    console.log("\ncleanup: probe digest rows deleted, trip dates/mute/status restored");
  }
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
