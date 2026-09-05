/**
 * The Live Trip plan's baseline, reproduced on demand.
 *
 * Phase 0.4 of docs/LIVE_TRIP_MASTER_PLAN.md. Calls get_live_trip_baseline()
 * — the function IS the definition; nothing is computed here — and prints a
 * markdown block. With --append the block is inserted into the plan above
 * "## Decisions log", so the frozen baseline and every weekly re-read come
 * from the same query with the same window.
 *
 *   npx tsx scripts/baseline-snapshot.mts              # print
 *   npx tsx scripts/baseline-snapshot.mts --append     # print + append to the plan
 *   DAYS=56 npx tsx scripts/baseline-snapshot.mts      # different window
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (env or .env.local): the function is
 * revoked from every other role because it aggregates visitor behaviour.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

const DAYS = Number(process.env.DAYS || 28);
const APPEND = process.argv.includes("--append");
const PLAN = "docs/LIVE_TRIP_MASTER_PLAN.md";

type J = Record<string, unknown>;
const admin = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await admin.rpc("get_live_trip_baseline", { p_days: DAYS });
if (error || !data) {
  console.error("get_live_trip_baseline failed:", error?.message);
  process.exit(1);
}
const b = data as J;
const w = b.window as J, wz = b.wizard as J, rc = b.recipients as J, sh = b.sharing as J,
  rt = b.retention as J, lt = b.live_trip as J, g = b.guardrails as J;

const v = (x: unknown, suffix = "") => (x === null || x === undefined ? "—" : `${x}${suffix}`);
const pct = (x: unknown) => v(x, "%");
const views = lt.trip_views_in_window
  ? Object.entries(lt.trip_views_in_window as J).map(([k, n]) => `${k} ${n}`).join(", ")
  : "none in window";

const todtNote =
  Number(lt.trips_completed_in_window) > 0 && lt.todt_measured_since && String(lt.todt_measured_since) >= String(w.from)
    ? ` — trip_views began on ${lt.todt_measured_since}; trips that completed before that date cannot have been observed, so this reads low until a full window of measurement exists (first clean read: ${DAYS} days after ${lt.todt_measured_since})`
    : "";

const stamp = String(w.to_exclusive);
const block = `## Baseline ${stamp} (${w.days} full UTC days, ${w.from} → ${w.to_exclusive} exclusive)

*Produced by \`scripts/baseline-snapshot.mts\` from \`get_live_trip_baseline(${DAYS})\` at ${String(w.computed_at).slice(0, 16)}Z. Every figure reads labelled human data (\`page_views_human\`, automation labels applied to wizard sessions). Re-run the same command for the weekly ritual; never hand-edit these numbers.*

| Area | Metric | Value |
|---|---|---|
| North Star | **TODT** — trips with ≥1 human open on a day inside their dates, of trips completed in the window | **${pct(lt.todt_pct)}** (${v(lt.trips_completed_in_window)} trips)${todtNote} |
| Live trip | trips in progress today / opened today | ${v(lt.trips_in_progress_today)} / ${v(lt.in_progress_opened_today)} |
| Live trip | edited during the trip (trips travelled since 2026-05-01) | ${pct(lt.edited_during_trip_pct)} of ${v(lt.travelled_since_may)} |
| Live trip | trip_views rows in window by source | ${views} |
| Recipients | human recipient sessions (\`/shared/*\`, \`/trip/*\`) | ${v(rc.recipient_sessions)} (${v(rc.recipient_sessions_per_week)}/week) |
| Recipients | recipient → wizard / → auth | ${pct(rc.recipient_to_wizard_pct)} / ${pct(rc.recipient_to_auth_pct)} |
| Recipients | **recipient → participant** (Phase 2 metric) | ${pct(sh.recipient_to_participant_pct)} — not yet built |
| Sharing | trips created / shared / share rate | ${v(sh.trips_created)} (${v(sh.trips_created_per_day)}/day) / ${v(sh.trips_shared)} / ${pct(sh.share_rate_pct)} |
| Sharing | recipient sessions per shared trip | ${v(sh.recipients_per_share)} |
| Sharing | **participants per shared trip** (Phase 2 metric) | ${v(sh.participants_per_shared_trip)} — not yet built |
| K | new users / via invite / referred / **K** | ${v(sh.new_users)} / ${v(sh.signups_via_invite)} / ${v(sh.signups_referred)} / **${v(sh.k_factor)}** |
| Retention | cohort return ≥2 logins | ${pct(rt.return_once_pct)} of ${v(rt.cohort_users)} |
| Retention | post-trip 7-day return (owner opened anything within 7 days after end_date) | ${pct(rt.post_trip_return_7d_pct)} of ${v(rt.trips_ended)} trips |
| Wizard | step-1 → step-2 (wizard arm, as \`get_ux10x_rates\`) | ${pct(wz.step1_to_2_pct)} (${v(wz.step2_sessions)} of ${v(wz.step1_sessions)}) |
| Wizard | step-1 → result / result → saved | ${pct(wz.step1_to_result_pct)} / ${pct(wz.result_to_saved_pct)} |
| Guardrail | saves per day (investigate if < 1 for 3 days) | ${v(g.saves_per_day)} |
| Guardrail | human recipient sessions per week (investigate if < 100) | ${v(rc.recipient_sessions_per_week)} |
| Guardrail | human page views per day | ${v(g.human_views_per_day)} |
| Guardrail | automation share of \`is_bot=false\` views | ${pct(g.automation_share_pct)} |
`;

console.log(block);

if (APPEND) {
  const raw = readFileSync(PLAN, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const marker = "## Decisions log";
  if (!raw.includes(marker)) {
    console.error(`${PLAN}: "${marker}" not found; nothing appended`);
    process.exit(1);
  }
  if (raw.includes(`## Baseline ${stamp} (`)) {
    console.error(`${PLAN}: a baseline block for ${stamp} already exists; nothing appended`);
    process.exit(1);
  }
  const insert = block.replace(/\n/g, eol) + eol;
  writeFileSync(PLAN, raw.replace(marker, insert + marker));
  console.log(`appended to ${PLAN}`);
}
