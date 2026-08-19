/**
 * Detect drift between production RLS and the committed baseline.
 *
 * WHY THIS EXISTS
 * The 2026-08-19 audit found six tables that anyone could write with the public
 * anon key, and 8 of the 10 offending policies existed in production and in NO
 * migration. Across the database there were ~130 live policies against 89
 * declared, and only 34 of 88 migrations touched RLS at all. So most of this
 * database's authorization was config that no code review ever saw, and a table
 * could be opened from the Supabase UI with no diff, no history and no alarm.
 *
 * Fixing the six instances did not fix that. This does: it pins the whole
 * authorization surface in git and fails when production stops matching.
 *
 * Usage:
 *   npx tsx scripts/rls-baseline.mts --write   # snapshot prod -> baseline file
 *   npx tsx scripts/rls-baseline.mts           # compare; exit 1 on drift
 *
 * The check is deliberately DIRECTIONLESS: it reports any difference rather
 * than trying to judge which changes are dangerous. A legitimate policy change
 * is expected to land here as a reviewed baseline update in the same commit as
 * its migration — that review is the point.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const BASELINE = join(ROOT, "supabase", "rls-baseline.json");

// ----------------------------------------------------------------------------
// Env — tolerant parser
// ----------------------------------------------------------------------------

/**
 * Read a key from .env.local.
 *
 * Deliberately tolerant of `NAME = value` with whitespace around the `=`, and
 * of CRLF line endings: this repo has at least one variable declared with a
 * trailing space in its NAME, which a `^NAME=` match silently misses and which
 * cost real debugging time when it produced a confusing 401.
 */
function env(name: string): string {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) throw new Error(".env.local not found");
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} missing from .env.local`);
}

type Snapshot = Array<Record<string, unknown>>;

async function fetchSnapshot(): Promise<Snapshot> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url}/rest/v1/rpc/rls_snapshot`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`rls_snapshot failed: HTTP ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as Snapshot;
}

// ----------------------------------------------------------------------------
// Diff
// ----------------------------------------------------------------------------

const byTable = (s: Snapshot) =>
  new Map(s.map((t) => [String(t.table), t]));

/** Stable string for one table's authorization surface. */
const fingerprint = (t: Record<string, unknown>) => JSON.stringify(t);

function diff(baseline: Snapshot, live: Snapshot): string[] {
  const b = byTable(baseline);
  const l = byTable(live);
  const problems: string[] = [];

  for (const [name, table] of l) {
    if (!b.has(name)) {
      const pols = (table.policies as unknown[])?.length ?? 0;
      problems.push(`NEW TABLE  ${name}  (rls_enabled=${table.rls_enabled}, ${pols} policies)`);
    }
  }
  for (const [name] of b) {
    if (!l.has(name)) problems.push(`DROPPED TABLE  ${name}`);
  }
  for (const [name, liveT] of l) {
    const baseT = b.get(name);
    if (!baseT) continue;
    if (fingerprint(baseT) === fingerprint(liveT)) continue;

    if (baseT.rls_enabled !== liveT.rls_enabled) {
      problems.push(`RLS TOGGLED  ${name}  ${baseT.rls_enabled} -> ${liveT.rls_enabled}`);
    }
    if (JSON.stringify(baseT.grants) !== JSON.stringify(liveT.grants)) {
      problems.push(
        `GRANTS CHANGED  ${name}\n     was:  ${JSON.stringify(baseT.grants)}\n     now:  ${JSON.stringify(liveT.grants)}`
      );
    }
    const bp = new Map(
      (baseT.policies as Array<Record<string, unknown>>).map((p) => [String(p.name), p])
    );
    const lp = new Map(
      (liveT.policies as Array<Record<string, unknown>>).map((p) => [String(p.name), p])
    );
    for (const [pn, pol] of lp) {
      if (!bp.has(pn)) {
        problems.push(
          `NEW POLICY  ${name}.${pn}  ${pol.cmd} roles=${JSON.stringify(pol.roles)} using=${pol.using} check=${pol.with_check}`
        );
      } else if (JSON.stringify(bp.get(pn)) !== JSON.stringify(pol)) {
        problems.push(
          `POLICY CHANGED  ${name}.${pn}\n     was:  ${JSON.stringify(bp.get(pn))}\n     now:  ${JSON.stringify(pol)}`
        );
      }
    }
    for (const [pn] of bp) {
      if (!lp.has(pn)) problems.push(`POLICY REMOVED  ${name}.${pn}`);
    }
  }
  return problems;
}

/**
 * Flag the specific shape that caused the 2026-08-19 incident: a permissive
 * write policy whose expression is literally `true`, reachable by anon or
 * public. Reported separately from drift because it is worth shouting about
 * even when the baseline was updated to include it.
 */
function anonWritable(live: Snapshot): string[] {
  const out: string[] = [];
  for (const t of live) {
    for (const p of (t.policies ?? []) as Array<Record<string, unknown>>) {
      const cmd = String(p.cmd);
      if (!["INSERT", "UPDATE", "DELETE", "ALL"].includes(cmd)) continue;
      if (p.permissive !== true) continue;
      const roles = (p.roles as string[]) ?? [];
      if (!roles.some((r) => r === "anon" || r === "public")) continue;
      if (p.using === "true" || p.with_check === "true") {
        out.push(`${t.table}.${p.name} (${cmd}, roles=${roles.join(",")})`);
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------------------

const write = process.argv.includes("--write");
const live = await fetchSnapshot();

if (write) {
  writeFileSync(BASELINE, JSON.stringify(live, null, 2) + "\n");
  const policies = live.reduce(
    (n, t) => n + ((t.policies as unknown[])?.length ?? 0),
    0
  );
  console.log(`✓ baseline written: ${live.length} tables, ${policies} policies`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("✗ no baseline. Run with --write first.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Snapshot;
const problems = diff(baseline, live);
const exposed = anonWritable(live);

if (exposed.length) {
  console.error(`\n✗ ANON-WRITABLE POLICIES IN PRODUCTION (${exposed.length}):`);
  exposed.forEach((e) => console.error(`   ${e}`));
}

if (problems.length) {
  console.error(`\n✗ RLS DRIFT — production differs from the committed baseline (${problems.length}):\n`);
  problems.forEach((p) => console.error(`   ${p}`));
  console.error(
    `\n  If the change was intentional, land it as a migration and refresh the` +
      `\n  baseline in the SAME commit:  npx tsx scripts/rls-baseline.mts --write\n`
  );
}

if (problems.length || exposed.length) process.exit(1);
console.log(`✓ no RLS drift (${live.length} tables, ${baseline.length} in baseline)`);
