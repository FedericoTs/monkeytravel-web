/**
 * Is page_views_human actually excluding automation, and only automation?
 *
 * Phase 0.2 of docs/LIVE_TRIP_MASTER_PLAN.md. The view used to be
 * `page_views WHERE is_bot = false`, and is_bot only knows self-declared
 * crawlers. It now also excludes sessions in page_view_session_labels, rebuilt
 * nightly by label_automation_sessions(). This probe is the exit-gate check:
 * it reads with the service role and asserts each rule the migration encodes,
 * plus the one invariant that protects real people.
 *
 * What it proves
 *   - the label table has rows, and every reason is a rule the function has
 *   - 2026-09-01 (the Cittadella sweep) is labelled as legacy_sweep, hundreds
 *     of sessions
 *   - the view excludes them: view count < raw is_bot=false count on that day
 *     by thousands
 *   - no session labelled by a rule that requires "never engaged" ever fired
 *     the engagement beacon
 *   - wizard_landing_fleet never labels a signed-in session, one with a
 *     consent or funnel row, or one whose wizard went past step 1
 *   - the label share over the last 7 days sits in a sane band (5%..45%);
 *     outside it, a rule has gone wrong
 *   - the rollup the dashboard reads already reflects the labels
 *     (dimension 'total' < dimension 'all' on the sweep day)
 *
 * Read-only. Nothing is written.
 *
 *   npx tsx scripts/automation-labels-probe.mts
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

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
const admin = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures += 1;
}

const SWEEP_DAY = "2026-09-01";
const ENGAGED_FROM = "2026-09-02";
const KNOWN_REASONS = new Set([
  "phantom_prefetch", "document_burst", "heavy_unengaged", "ua_city_sweep", "ua_family_sweep",
  "family_conversionless", "ua_lagging_fleet", "nocity_lagging_fleet", "stale_chrome", "legacy_sweep",
  "cookieless_internal_entry", "entry_burst_fleet", "wizard_landing_fleet",
]);
// The rules whose SQL requires that the session never fired the engagement beacon.
const UNENGAGED_ONLY = ["heavy_unengaged", "ua_city_sweep", "ua_family_sweep", "cookieless_internal_entry", "entry_burst_fleet"];
const WIZARD_STEP_1 = ["step_1_destination_dates", "step1_heartbeat"];

async function countExact(table: string, build: (q: any) => any): Promise<number> {
  const q = build(admin.from(table).select("*", { count: "exact", head: true }));
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

(async () => {
  console.log("page_views_human automation-label probe\n");

  // 1. labels exist, reasons are the known three
  const { data: reasons, error: rErr } = await admin
    .from("page_view_session_labels")
    .select("reason")
    .limit(5000);
  check(!rErr, "label table readable with the service role", rErr?.message);
  const seen = new Set((reasons ?? []).map((r) => r.reason));
  check(seen.size > 0, "label table has rows", [...seen]);
  check([...seen].every((r) => KNOWN_REASONS.has(r)), "every reason is one of the known rules", [...seen]);

  // 2. the sweep day is labelled, hundreds of sessions, as legacy_sweep
  const sweepLabels = await countExact("page_view_session_labels", (q) =>
    q.eq("day", SWEEP_DAY).eq("reason", "legacy_sweep"),
  );
  check(sweepLabels >= 300, `${SWEEP_DAY} carries >= 300 legacy_sweep labels (Cittadella)`, sweepLabels);

  // 3. the view excludes them
  const rawHuman = await countExact("page_views", (q) =>
    q.eq("is_bot", false).gte("created_at", `${SWEEP_DAY}T00:00:00Z`).lt("created_at", `2026-09-02T00:00:00Z`),
  );
  const viewHuman = await countExact("page_views_human", (q) =>
    q.gte("created_at", `${SWEEP_DAY}T00:00:00Z`).lt("created_at", `2026-09-02T00:00:00Z`),
  );
  check(rawHuman - viewHuman >= 3000, `view excludes thousands of ${SWEEP_DAY} rows that is_bot alone kept`, { rawHuman, viewHuman, excluded: rawHuman - viewHuman });

  // 4. the "never engaged" rules never label an engaged session (days with engagement data)
  const { data: labelled, error: lErr } = await admin
    .from("page_view_session_labels")
    .select("session_id")
    .gte("day", ENGAGED_FROM)
    .in("reason", UNENGAGED_ONLY)
    .limit(5000);
  check(!lErr, "labels for engagement-era days readable", lErr?.message);
  const ids = (labelled ?? []).map((r) => r.session_id);
  let engagedButLabelled = 0;
  // 100 ids per request: 500 UUIDs overflow the request URL
  for (let i = 0; i < ids.length; i += 100) {
    engagedButLabelled += await countExact("session_engagement", (q) => q.in("session_id", ids.slice(i, i + 100)));
  }
  check(engagedButLabelled === 0, "no session labelled by a never-engaged rule fired the engagement beacon", { checked: ids.length, engagedButLabelled });

  // 5. 7-day label share in a sane band
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const raw7 = await countExact("page_views", (q) => q.eq("is_bot", false).gte("created_at", since));
  const view7 = await countExact("page_views_human", (q) => q.gte("created_at", since));
  const share = raw7 ? (raw7 - view7) / raw7 : 0;
  check(share >= 0.05 && share <= 0.45, "7-day label share is in the 5%..45% band", { raw7, view7, sharePct: +(share * 100).toFixed(1) });

  // 6. the rollup the dashboard reads reflects the labels
  const { data: roll, error: roErr } = await admin
    .from("page_view_rollup")
    .select("dimension, views")
    .eq("day", SWEEP_DAY)
    .in("dimension", ["all", "total"]);
  check(!roErr, "rollup readable", roErr?.message);
  const all = (roll ?? []).filter((r) => r.dimension === "all").reduce((a, r) => a + r.views, 0);
  const total = (roll ?? []).filter((r) => r.dimension === "total").reduce((a, r) => a + r.views, 0);
  check(all > 0 && total > 0 && all - total >= 6000, `rollup ${SWEEP_DAY}: 'total' (human) sits >= 6,000 below 'all' (raw)`, { all, total });

  // 7. wizard_landing_fleet keeps to its definition
  const { data: fleet, error: fErr } = await admin
    .from("page_view_session_labels")
    .select("session_id")
    .eq("reason", "wizard_landing_fleet")
    .limit(5000);
  check(!fErr && (fleet ?? []).length > 0, "wizard_landing_fleet has labels", fErr?.message ?? (fleet ?? []).length);
  const fleetIds = (fleet ?? []).map((r) => r.session_id);
  let signedIn = 0, consented = 0, funnel = 0, pastStep1 = 0;
  for (let i = 0; i < fleetIds.length; i += 100) {
    const chunk = fleetIds.slice(i, i + 100);
    signedIn += await countExact("wizard_step_events", (q) => q.in("session_id", chunk).not("user_id", "is", null));
    consented += await countExact("consent_events", (q) => q.in("session_id", chunk));
    funnel += await countExact("funnel_events", (q) => q.in("session_id", chunk));
    pastStep1 += await countExact("wizard_step_events", (q) =>
      q.in("session_id", chunk).not("step", "in", `(${WIZARD_STEP_1.join(",")})`),
    );
  }
  check(
    signedIn + consented + funnel + pastStep1 === 0,
    "wizard_landing_fleet labels no signed-in, consenting, converting or past-step-1 session",
    { checked: fleetIds.length, signedIn, consented, funnel, pastStep1 },
  );

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
