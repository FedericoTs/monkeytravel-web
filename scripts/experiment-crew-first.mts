/**
 * The crew-first result test, read:
 *
 *   npm run experiment:crew-first [-- 2026-10-14T00:00:00Z]
 *
 * Per arm: the signed-out group sessions whose result was assigned
 * (wizard_step_events.result_variant), how many sent a share link
 * (funnel_events share_link_created) and how many saved (step 'saved'), then
 * the rule fixed in lib/experiments/result-crew-first-review.ts.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
// Namespace import, unwrapped: tsx loads a .ts module from an .mts entry as
// CJS, so named exports are not statically detectable.
import * as ReviewModule from "../lib/experiments/result-crew-first-review";

const R = ((ReviewModule as any).default ?? ReviewModule) as typeof ReviewModule;

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

const FROM = process.argv[2] || "2026-10-13T00:00:00Z";
const { url, key } = creds();
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

type Arm = "control" | "crew_first";

/** Every row of a query, a page at a time. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const results = await all<{ session_id: string; result_variant: Arm; created_at: string }>((from, to) =>
  db
    .from("wizard_step_events")
    .select("session_id, result_variant, created_at")
    .eq("step", "result")
    .not("result_variant", "is", null)
    .gte("created_at", FROM)
    .order("created_at", { ascending: true })
    .range(from, to)
);

// A session's arm is its first assigned result; probes never count.
const arms = new Map<string, Arm>();
for (const r of results) {
  if (!r.session_id || r.session_id === "no_session" || r.session_id.startsWith("e2eprobe-")) continue;
  if (!arms.has(r.session_id)) arms.set(r.session_id, r.result_variant);
}
const sessions = [...arms.keys()];

async function sessionsWith(query: (ids: string[]) => PromiseLike<{ data: { session_id: string | null }[] | null; error: unknown }>) {
  const hit = new Set<string>();
  for (let i = 0; i < sessions.length; i += 200) {
    const { data, error } = await query(sessions.slice(i, i + 200));
    if (error) throw error;
    for (const row of data ?? []) if (row.session_id) hit.add(row.session_id);
  }
  return hit;
}

const shared = await sessionsWith((ids) =>
  db.from("funnel_events").select("session_id").eq("event_type", "share_link_created").gte("created_at", FROM).in("session_id", ids)
);
const saved = await sessionsWith((ids) =>
  db.from("wizard_step_events").select("session_id").eq("step", "saved").gte("created_at", FROM).in("session_id", ids)
);

const counts = (arm: Arm) => {
  const ids = sessions.filter((s) => arms.get(s) === arm);
  return { sessions: ids.length, shared: ids.filter((s) => shared.has(s)).length, saved: ids.filter((s) => saved.has(s)).length };
};
const control = counts("control");
const crewFirst = counts("crew_first");
const review = R.reviewCrewFirst(control, crewFirst);

const pct = (r: { point: number; low: number; high: number }) =>
  `${(r.point * 100).toFixed(1)}% [${(r.low * 100).toFixed(1)}–${(r.high * 100).toFixed(1)}]`;

console.log(`\nCrew-first result test, from ${FROM}\n`);
console.log(`  ${"".padEnd(12)} ${"sessions".padStart(8)}  ${"share rate".padEnd(24)} ${"save rate".padEnd(24)}`);
for (const [name, c, share, save] of [
  ["control", control, review.share.control, review.save.control],
  ["crew_first", crewFirst, review.share.crewFirst, review.save.crewFirst],
] as const) {
  console.log(`  ${name.padEnd(12)} ${String(c.sessions).padStart(8)}  ${pct(share).padEnd(24)} ${pct(save).padEnd(24)}`);
}
console.log(`\n  share: ${review.share.verdict} (p=${review.share.p.toFixed(3)})   save: ${review.save.verdict} (p=${review.save.p.toFixed(3)})`);
console.log(`\n  DECISION: ${review.decision} — ${review.reason}\n`);
