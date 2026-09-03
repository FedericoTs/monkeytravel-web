/**
 * The flag review, as a command instead of an archaeology exercise.
 *
 * WHY
 * ---
 * FLAG_REVIEW_DATES turns CI red a week after a rollout's review date, so the
 * decision cannot be forgotten. But the ANALYSIS behind the decision lived
 * only as prose inside a comment in lib/posthog/flags.ts, which means whoever
 * runs the review re-derives it by hand — and the naive derivation points the
 * wrong way.
 *
 * For the step-1 rollout the raw step-1→step-2 rate reads 31.2% before ship
 * and 41.3% after: a large win, entirely manufactured by the denominator
 * pollution of 2026-08-17. The dwell-qualified rate over the same window is
 * 74.5% (n=745) before and 69.0% (n=42) after — flat to slightly down, and at
 * n=42 indistinguishable from noise in either direction.
 *
 * So this prints both, with a confidence interval on every rate, and states
 * plainly what the data cannot support.
 *
 * WHAT IT CANNOT DO
 * -----------------
 * Read the header of supabase/migrations/20260903140000_wizard_step1_variant.sql.
 * Two limits carry into every number below:
 *
 *   1. Until 2026-09-03 the arm a session saw was recorded ONLY in PostHog,
 *      which captures ~59% of sessions and skews to converters. Server-side
 *      arm data starts accumulating from that date, so any by-arm split here
 *      covers only sessions after it.
 *
 *   2. Assignment FAILS OPEN — resolveEditorialStep1 returns
 *      `flagValue !== false`, so every session where PostHog does not resolve
 *      is counted as "editorial". "classic" therefore means "PostHog resolved
 *      and said no", which selects for consenting, unblocked users. The arms
 *      are not comparable populations. A by-arm p-value here is a description,
 *      not a randomized result, and this script says so every time it prints one.
 *
 * Pre/post is confounded by time and traffic mix; by-arm is confounded by
 * assignment. Neither is a clean experiment. That IS the finding.
 *
 *   node scripts/flag-review.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
// Namespace import, not named: a .mts entry point loads a .ts module through
// tsx as CJS, so named exports are not statically detectable and every one of
// them fails at parse time. Same shape as scripts/audit-queued-emails.mts.
import * as Stats from "../lib/analytics/experiment-stats";

// ...and unwrap the CJS default, same as scripts/audit-queued-emails.mts:
// the namespace object is the CJS wrapper, the exports hang off .default.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = ((Stats as any).default ?? Stats) as typeof Stats;
const { wilson, twoProportionP, requiredN, verdict, formatRate } = S;

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const rawLine of readFileSync(".env.local", "utf8").split(String.fromCharCode(10))) {
      const line = rawLine.trim();
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      const q = v.slice(0, 1);
      if ((q === String.fromCharCode(34) || q === String.fromCharCode(39)) && v.slice(-1) === q) {
        v = v.slice(1, -1);
      }
      if (k === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (k === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

/**
 * The one rollout with a live review date. Kept here rather than imported so
 * this script states its own assumptions: the ship boundary is a timestamp,
 * not "review date minus seven", because a 12-hour boundary error is ~7% of a
 * one-week window.
 */
const REVIEW = {
  flag: "wizard-step1-editorial-v1",
  reviewBy: "2026-09-09",
  shippedAt: "2026-09-02T12:20:00Z",
  // The traffic shift that broke every raw rate. Nothing before it is
  // comparable to anything after it.
  baselineFrom: "2026-08-17T00:00:00Z",
  // Server-side arm recording began here.
  armDataFrom: "2026-09-03T14:00:00Z",
  denominatorStep: "step_1_destination_dates",
  dwellStep: "step1_heartbeat",
  successStep: "step_2_vibes",
};

const { url, key } = creds();
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

interface EventRow { session_id: string; step: string; created_at: string; step1_variant: string | null }
interface Session { firstAt: string; sawStep1: boolean; dwelled: boolean; reached: boolean; arm: string | null }

const h1 = (s: string) => console.log(`\n${s}\n${"=".repeat(s.length)}`);
const line = (k: string, v: string) => console.log(`  ${k.padEnd(34)} ${v}`);

/** One bucket of sessions → the two rates the review turns on. */
function summarise(rows: Session[]) {
  const all = rows.length;
  const dwelled = rows.filter((r) => r.dwelled);
  return {
    raw: wilson(rows.filter((r) => r.reached).length, all),
    dwellQualified: wilson(dwelled.filter((r) => r.reached).length, dwelled.length),
  };
}

// PostgREST cannot run that aggregate directly, so read the raw events for the
// window and fold them here. The window is bounded by baselineFrom, which
// keeps this to tens of thousands of rows rather than the whole table.
async function loadEvents() {
  const cols = "session_id, step, created_at, step1_variant";
  const page = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await db
      .from("wizard_step_events")
      .select(cols)
      .gte("created_at", REVIEW.baselineFrom)
      .neq("session_id", "no_session")
      .in("step", [REVIEW.denominatorStep, REVIEW.dwellStep, REVIEW.successStep])
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`event read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

function foldSessions(events: EventRow[]) {
  const byId = new Map();
  for (const e of events) {
    let s = byId.get(e.session_id);
    if (!s) {
      s = { firstAt: e.created_at, sawStep1: false, dwelled: false, reached: false, arm: null };
      byId.set(e.session_id, s);
    }
    if (e.created_at < s.firstAt) s.firstAt = e.created_at;
    if (e.step === REVIEW.denominatorStep) s.sawStep1 = true;
    if (e.step === REVIEW.dwellStep) s.dwelled = true;
    if (e.step === REVIEW.successStep) s.reached = true;
    // Any non-null arm on any of the session's rows labels the session.
    if (e.step1_variant && !s.arm) s.arm = e.step1_variant;
  }
  // The denominator is "saw step 1", exactly as the prescribed query's HAVING.
  return [...byId.values()].filter((s) => s.sawStep1);
}

const events = await loadEvents();
const sessions = foldSessions(events);

const ship = REVIEW.shippedAt;
const pre = sessions.filter((s) => s.firstAt < ship);
const post = sessions.filter((s) => s.firstAt >= ship);

h1(`Flag review: ${REVIEW.flag}`);
const daysLeft = Math.round((new Date(`${REVIEW.reviewBy}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
line("review by", `${REVIEW.reviewBy} (${daysLeft >= 0 ? `${daysLeft} day(s) away` : `${-daysLeft} day(s) OVERDUE`})`);
line("shipped", REVIEW.shippedAt);
line("baseline window opens", `${REVIEW.baselineFrom} (traffic shift; nothing earlier is comparable)`);
line("sessions read", `${sessions.length} (from ${events.length} events)`);

const preS = summarise(pre);
const postS = summarise(post);

h1("The metric to IGNORE — raw, polluted denominator");
line("pre-ship", formatRate(preS.raw));
line("post-ship", formatRate(postS.raw));
console.log(
  "\n  This is the number that moves without the product changing. The 2026-08-17\n" +
  "  traffic shift filled the denominator with sessions that never dwell, so the\n" +
  "  rate fell mechanically before ship and 'recovers' after it. Do not use it."
);

h1("The metric to TRUST — dwell-qualified (session emitted step1_heartbeat)");
line("pre-ship", formatRate(preS.dwellQualified));
line("post-ship", formatRate(postS.dwellQualified));

const p = twoProportionP(
  preS.dwellQualified.successes, preS.dwellQualified.n,
  postS.dwellQualified.successes, postS.dwellQualified.n
);
const v = verdict(preS.dwellQualified, postS.dwellQualified, p);
line("two-sided p", p.toFixed(4));
line("verdict", v.toUpperCase());

if (v === "inconclusive") {
  const need5 = requiredN(preS.dwellQualified.point, 0.05);
  const have = postS.dwellQualified.n;
  const perDay = have / Math.max(0.5, (Date.now() - new Date(ship).getTime()) / 86_400_000);
  const daysNeeded = perDay > 0 ? Math.ceil((need5 - have) / perDay) : Infinity;
  console.log(
    `\n  Not distinguishable from noise. To resolve a 5pp move against a ` +
    `${(preS.dwellQualified.point * 100).toFixed(1)}% baseline needs ~${need5} dwelled\n` +
    `  post-ship sessions; there are ${have}, arriving at ~${perDay.toFixed(0)}/day, i.e. ` +
    `~${Number.isFinite(daysNeeded) ? daysNeeded : "?"} more day(s).`
  );
  if (Number.isFinite(daysNeeded) && daysNeeded > daysLeft) {
    console.log(
      `  *** The review date lands BEFORE the data can answer the question. Decide\n` +
      `      on the merits, or move the date in FLAG_REVIEW_DATES deliberately —\n` +
      `      do not leave the flag split and unwatched, which is how the front\n` +
      `      door ran for six weeks.`
    );
  }
}

h1("By arm — server-side, from 2026-09-03 only");
const armed = sessions.filter((s) => s.arm && s.firstAt >= REVIEW.armDataFrom);
if (armed.length === 0) {
  console.log(
    "  No server-side arm data yet. Before 2026-09-03 the arm existed only as a\n" +
    "  PostHog property (~59% capture, skewed to converters), so it is not read here."
  );
} else {
  for (const arm of ["editorial", "classic"]) {
    const rows = armed.filter((s) => s.arm === arm);
    const dw = rows.filter((r) => r.dwelled);
    line(`${arm} (dwell-qualified)`, formatRate(wilson(dw.filter((r) => r.reached).length, dw.length)));
    line(`${arm} share of armed sessions`, `${((rows.length / armed.length) * 100).toFixed(1)}% (n=${rows.length})`);
  }
  console.log(
    "\n  NOT a randomized comparison. Assignment fails open: every session where\n" +
    "  the flag does not resolve is labelled 'editorial', so 'classic' means\n" +
    "  'PostHog resolved and said no' — consenting, unblocked users. Read the\n" +
    "  split to learn what the rollout is actually doing, not to pick a winner."
  );
}

h1("Decision");
console.log(
  "  Ramp to 100% and delete the classic branch, or set 0% and revert, then\n" +
  "  remove the entry from FLAG_REVIEW_DATES in lib/posthog/flags.ts.\n" +
  "  Never leave it split: lib/posthog/flag-review-dates.vitest.ts reddens CI\n" +
  "  seven days after the review date, which is the only thing that noticed\n" +
  "  last time.\n"
);
