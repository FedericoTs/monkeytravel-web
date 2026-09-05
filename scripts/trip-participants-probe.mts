/**
 * trip_participants probe — Live Trip Phase 2.1.
 *
 * Proves, against a running deployment (BASE, default production):
 *   - the anon key can neither read nor write trip_participants (RLS on, no
 *     policies);
 *   - POST /api/shared/[token]/join joins, updates name + email, leaves, and
 *     keys everything on the mt_anon_voter cookie;
 *   - the per-cookie-per-trip rate limit bites;
 *   - a cookie-less request from a scripting user-agent is refused.
 * Every row it creates is deleted at the end.
 *
 *   npx tsx scripts/trip-participants-probe.mts
 *   BASE=http://localhost:3001 npx tsx scripts/trip-participants-probe.mts
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (env or .env.local).
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const env: Record<string, string> = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const need = (k: string) => process.env[k] ?? env[k] ?? "";
const url = need("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !serviceKey || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(2);
}
const BASE = (process.env.BASE ?? "https://monkeytravel.app").replace(/\/$/, "");
const CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 200)}` : ""}`);
  if (!ok) failures += 1;
}

interface Snapshot {
  count?: number;
  participants?: { id: string; display_name: string | null }[];
  me?: { joined: boolean; display_name: string | null; has_email: boolean };
}

async function call(token: string, path: "join" | "participants", opts: { cookie?: string; body?: unknown; ua?: string }) {
  const res = await fetch(`${BASE}/api/shared/${token}/${path}`, {
    method: path === "join" ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.ua === undefined ? { "User-Agent": CHROME_UA } : opts.ua ? { "User-Agent": opts.ua } : {}),
      ...(opts.cookie ? { Cookie: `mt_anon_voter=${opts.cookie}` } : {}),
    },
    body: path === "join" ? JSON.stringify(opts.body ?? {}) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const data = ((json as { data?: Snapshot } | null)?.data ?? json ?? {}) as Snapshot;
  return { status: res.status, data, setCookie: res.headers.get("set-cookie") ?? "" };
}

const cookie = "probe_" + randomBytes(12).toString("base64url"); // 6 + 16 = 22 chars

(async () => {
  console.log(`trip_participants probe against ${BASE}\n`);

  // 0. a trip to probe with
  const { data: trip, error: tripErr } = await admin
    .from("trips")
    .select("id, share_token, public_slug")
    .not("share_token", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (tripErr || !trip?.share_token) {
    console.error("No shared trip to probe with", tripErr?.message);
    process.exit(2);
  }
  const token = trip.share_token as string;
  console.log(`using trip ${trip.id}\n`);

  try {
    // 1. RLS: anon key reads nothing, writes nothing
    const anonRead = await anon.from("trip_participants").select("id").limit(1);
    check((anonRead.data ?? []).length === 0, "anon key SELECT on trip_participants returns no rows", {
      rows: (anonRead.data ?? []).length,
      error: anonRead.error?.code ?? null,
    });
    const anonWrite = await anon.from("trip_participants").insert({
      trip_id: trip.id,
      participant_cookie_id: cookie + "_rls",
      source: "shared",
    });
    check(!!anonWrite.error, "anon key INSERT on trip_participants is refused", anonWrite.error?.code);

    // 2. join
    const j1 = await call(token, "join", { cookie, body: { action: "join", source: "shared" } });
    check(j1.status === 200 && j1.data.me?.joined === true, "join → 200, me.joined", { status: j1.status, me: j1.data.me });
    check((j1.data.count ?? 0) >= 1, "count ≥ 1 after join", j1.data.count);

    // 3. hydration sees the same cookie
    const g1 = await call(token, "participants", { cookie });
    check(g1.status === 200 && g1.data.me?.joined === true, "GET participants → me.joined for the same cookie", g1.data.me);

    // 4. name + email
    const j2 = await call(token, "join", { cookie, body: { action: "update", display_name: "  Probe   Person ", email: "Probe@Example.com" } });
    check(j2.status === 200 && j2.data.me?.display_name === "Probe Person" && j2.data.me?.has_email === true, "update → name normalised, email stored", j2.data.me);
    const { data: row } = await admin
      .from("trip_participants")
      .select("email, display_name, left_at")
      .eq("trip_id", trip.id)
      .eq("participant_cookie_id", cookie)
      .maybeSingle();
    check(row?.email === "probe@example.com" && row?.left_at === null, "row holds the lower-cased email and is active", row);
    const bad = await call(token, "join", { cookie, body: { action: "update", email: "not an email" } });
    check(bad.status === 400, "an invalid email is refused with 400", bad.status);

    // 5. leave
    const j3 = await call(token, "join", { cookie, body: { action: "leave" } });
    check(j3.status === 200 && j3.data.me?.joined === false, "leave → me.joined false", j3.data.me);
    const { data: left } = await admin
      .from("trip_participants")
      .select("left_at")
      .eq("trip_id", trip.id)
      .eq("participant_cookie_id", cookie)
      .maybeSingle();
    check(!!left?.left_at, "left_at is set (row kept for the tap history)", left);

    // 6. per-cookie-per-trip rate limit (6/min): join/update/bad/leave used 5; the next joins must hit 429 soon
    let limited = false;
    let okBefore = 0;
    for (let i = 0; i < 6 && !limited; i++) {
      const r = await call(token, "join", { cookie, body: { action: "join", source: "shared" } });
      if (r.status === 429) limited = true;
      else if (r.status === 200) okBefore += 1;
    }
    check(limited, "per-cookie-per-trip rate limit returns 429", { okBefore });

    // 7. cookie-less scripting UA is refused; a browser UA gets a cookie minted
    const noUa = await call(token, "join", { ua: "curl/8.0", body: { action: "join" } });
    check(noUa.status === 400, "cookie-less request from curl is refused with 400", noUa.status);
    const minted = await call(token, "join", { body: { action: "join", source: "public" } });
    check(minted.status === 200 && /mt_anon_voter=/.test(minted.setCookie), "cookie-less browser request gets mt_anon_voter minted", {
      status: minted.status,
      cookie: minted.setCookie.slice(0, 40),
    });
    const mintedId = minted.setCookie.match(/mt_anon_voter=([^;]+)/)?.[1];
    if (mintedId) {
      await admin.from("trip_participants").delete().eq("trip_id", trip.id).eq("participant_cookie_id", mintedId);
    }
  } finally {
    await admin.from("trip_participants").delete().eq("trip_id", trip.id).like("participant_cookie_id", "probe_%");
    console.log("\ncleanup: probe rows deleted");
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
