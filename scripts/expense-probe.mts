/**
 * trip expense probe — Live Trip Phase 3.4 (expenses half).
 *
 * Against a running deployment (BASE) + a shared trip (SHARE_TOKEN or the
 * newest), proves:
 *   - the anon key cannot read or write trip_expenses / trip_expense_splits
 *     (member-only RLS; the shared surface goes through the service role);
 *   - POST expense logs an expense and splits it across the trip's
 *     participants (owner + active participants + the payer), the split
 *     summing to the amount;
 *   - the viewer's summary (paid/owed/net) is correct;
 *   - undo removes it (creator only);
 *   - anonymous expenses NEVER enter the authed compute_trip_settlements.
 * Cleans up its rows + probe participants.
 *
 *   SHARE_TOKEN=<uuid> BASE=http://localhost:3001 npx tsx scripts/expense-probe.mts
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
const check = (ok: boolean, label: string, d?: unknown) => { console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${d !== undefined ? "  " + JSON.stringify(d).slice(0, 200) : ""}`); if (!ok) failures++; };

interface Snap { expenses?: { id: string; amountCents: number; paidByName: string | null; paidByIsOwner: boolean; mine: boolean; splits: { shareCents: number }[] }[]; summary?: { totalCents: number; youPaidCents: number; youOweCents: number; netCents: number } }
const cookie = "probe_" + randomBytes(12).toString("base64url");

async function post(token: string, body: unknown, opts: { cookie?: string; ua?: string } = {}) {
  const res = await fetch(`${BASE}/api/shared/${token}/expense`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts.ua === undefined ? { "User-Agent": UA } : opts.ua ? { "User-Agent": opts.ua } : {}), ...(opts.cookie ? { Cookie: `mt_anon_voter=${opts.cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  let j: unknown = null; try { j = await res.json(); } catch { j = null; }
  return { status: res.status, data: (((j as { data?: Snap } | null)?.data ?? j) ?? {}) as Snap };
}

(async () => {
  console.log(`expense probe against ${BASE}\n`);
  let token = process.env.SHARE_TOKEN ?? "";
  if (!token) { const { data } = await admin.from("trips").select("share_token").not("share_token", "is", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(); token = (data?.share_token as string) ?? ""; }
  if (!token) { console.error("no shared trip"); process.exit(2); }
  const { data: trip } = await admin.from("trips").select("id").eq("share_token", token).maybeSingle();
  const tripId = trip?.id as string;
  console.log(`trip ${tripId}\n`);

  // seed two participants so the split has real members
  await admin.from("trip_participants").upsert(
    [
      { trip_id: tripId, participant_cookie_id: "probe_part_a", display_name: "Probe A", source: "shared" },
      { trip_id: tripId, participant_cookie_id: "probe_part_b", display_name: "Probe B", source: "shared" },
    ],
    { onConflict: "trip_id,participant_cookie_id" },
  );

  try {
    // 1. RLS
    const r1 = await anon.from("trip_expenses").insert({ trip_id: tripId, amount: 1, currency: "EUR", category: "other" });
    check(!!r1.error, "anon key CANNOT insert trip_expenses", r1.error?.code);
    const r2 = await anon.from("trip_expense_splits").select("id").limit(1);
    check((r2.data ?? []).length === 0, "anon key sees no trip_expense_splits (member-only)", { rows: (r2.data ?? []).length });

    // 2. add €40 → split across owner + Probe A + Probe B + payer (4) = €10 each
    const add = await post(token, { amount: "40", activity_id: "probe-act" }, { cookie });
    const mine = add.data.expenses?.find((e) => e.mine);
    check(add.status === 200 && !!mine, "expense added (mine)", { status: add.status });
    check(!!mine && mine.splits.length >= 3, "split across the participant cohort", { splits: mine?.splits.length });
    check(!!mine && mine.splits.reduce((s, x) => s + x.shareCents, 0) === mine.amountCents, "splits sum to the amount", { total: mine?.amountCents });
    check(!!mine && mine.paidByName === null && mine.paidByIsOwner === false, "anon payer is not labelled the owner", { name: mine?.paidByName, owner: mine?.paidByIsOwner });
    const sm = add.data.summary;
    check(
      !!sm && sm.youPaidCents === mine?.amountCents && sm.youOweCents > 0 && sm.netCents === sm.youPaidCents - sm.youOweCents,
      "summary: you paid all, owe a share, net = paid − owed",
      sm,
    );

    // 3. anon expense does NOT enter authed settlement
    const { data: settle } = await admin.rpc("compute_trip_settlements", { p_trip_id: tripId });
    const total = (settle ?? []).reduce((s: number, t: { amount: string }) => s + Number(t.amount), 0);
    // our €40 anon expense would add ~€10 skew if it leaked; assert none of the transfers reference it by amount
    check(!(settle ?? []).some((t: { amount: string }) => Number(t.amount) === 10), "no €10 anon-split transfer leaked into settlement", { transfers: (settle ?? []).length, total });

    // 4. bad amount + cookie-less curl
    const bad = await post(token, { amount: "0" }, { cookie });
    check(bad.status === 400, "amount 0 → 400", bad.status);
    const curl = await post(token, { amount: "5" }, { ua: "curl/8.0" });
    check(curl.status === 400, "cookie-less curl → 400", curl.status);

    // 5. undo (creator)
    const undo = await post(token, { undo: true, expense_id: mine!.id }, { cookie });
    check(undo.status === 200 && !undo.data.expenses?.some((e) => e.id === mine!.id), "creator undo removes the expense", { remaining: undo.data.expenses?.length });
  } finally {
    await admin.from("trip_expenses").delete().eq("trip_id", tripId).like("created_by_cookie_id", "probe_%");
    await admin.from("trip_expenses").delete().eq("trip_id", tripId).eq("activity_id", "probe-act");
    await admin.from("trip_participants").delete().eq("trip_id", tripId).like("participant_cookie_id", "probe_%");
    console.log("\ncleanup: probe rows deleted");
  }
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
