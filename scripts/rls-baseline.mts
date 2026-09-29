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

import { anonWritablePolicies, fetchRlsSnapshot, rlsDrift, type RlsSnapshot } from "@/lib/audits/rls-drift";

const ROOT = join(import.meta.dirname, "..");
const BASELINE = join(ROOT, "supabase", "rls-baseline.json");

// ----------------------------------------------------------------------------
// Env — tolerant parser
// ----------------------------------------------------------------------------

/**
 * Read a key from the environment (CI) or .env.local.
 *
 * Deliberately tolerant of `NAME = value` with whitespace around the `=`, and
 * of CRLF line endings: this repo has at least one variable declared with a
 * trailing space in its NAME, which a `^NAME=` match silently misses and which
 * cost real debugging time when it produced a confusing 401.
 */
function env(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) throw new Error(`${name} not set and .env.local not found`);
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} missing from .env.local`);
}

// ----------------------------------------------------------------------------

const write = process.argv.includes("--write");
const live = await fetchRlsSnapshot(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

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

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as RlsSnapshot;
const problems = rlsDrift(baseline, live);
const exposed = anonWritablePolicies(live);

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
