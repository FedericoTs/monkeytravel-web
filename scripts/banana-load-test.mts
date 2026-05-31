/**
 * Banana economy load + idempotency regression test.
 *
 * Why this exists:
 *   2026-05-31 we discovered the gamification reward loop had been silently
 *   broken for weeks — THREE stacked DB issues (UUID coercion crash, missing
 *   CHECK allowlist entries, no UNIQUE index for idempotency) meant ~zero
 *   bananas had been credited via `add_bananas` since the gamification path
 *   shipped. Every layer above the DB was happy. The bugs only surfaced when
 *   Alyssa reported "I have 4 trips and 0 bananas".
 *
 *   This script catches that class of regression by exercising the real RPC
 *   end-to-end against the real schema and verifying both ledger sums and
 *   idempotency in one shot. Run it before any banana-economy migration
 *   ships and the next "silent regression" stops being silent.
 *
 * What it does:
 *   1. UPSERTs N synthetic users (default 100; --users N to override).
 *   2. For each user, calls `add_bananas` RPC 12 times: 10 activity_completion
 *      (1 banana each) + 1 first_steps achievement_bonus (5) + 1 streak_3
 *      achievement_bonus (5). Per-user expected total: 20 bananas.
 *   3. Runs the RPC calls in batches of 20 with Promise.all to stress the
 *      `uniq_banana_tx_credit_idempotency` partial index under concurrent
 *      write load.
 *   4. SELECTs every loadtest user and asserts banana_balance === 20.
 *   5. Sums banana_transactions for the loadtest users and asserts
 *      total === N * 20.
 *   6. RE-RUNS the entire write phase. Asserts the second run added ZERO
 *      transactions (DB-level idempotency holds across runs, not just within
 *      a run).
 *
 * What it does NOT do:
 *   - Exercise the /api/bananas/award HTTP endpoint. That endpoint requires
 *     auth + trip ownership; this script is a DB-layer integrity test, not a
 *     full route test. The route's own E2E test lives in tests/e2e/.
 *
 * Safety:
 *   - Uses the service-role key — bypasses RLS. Run against staging, not
 *     prod, unless you know what you're doing. The loadtest+ email prefix
 *     scopes every query so cleanup is surgical.
 *   - --cleanup removes every loadtest+ row + associated transactions.
 *
 * Usage:
 *   npx tsx scripts/banana-load-test.mts             # 100 users, then verify
 *   npx tsx scripts/banana-load-test.mts --users 500 # custom scale
 *   npx tsx scripts/banana-load-test.mts --cleanup   # purge loadtest rows
 *
 * Reads .env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── .env.local loader (no dep — same pattern as export-audience-contacts.mts) ─
function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "✗ Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

// ── arg parsing ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cleanup = args.includes("--cleanup");
const usersFlagIdx = args.findIndex((a) => a === "--users");
const USERS =
  usersFlagIdx >= 0 && args[usersFlagIdx + 1]
    ? parseInt(args[usersFlagIdx + 1], 10)
    : 100;
if (!Number.isFinite(USERS) || USERS < 1) {
  console.error(`✗ --users must be a positive integer, got: ${args[usersFlagIdx + 1]}`);
  process.exit(1);
}

const BATCH_SIZE = 20; // Promise.all width to stress the idempotency index
const EMAIL_PREFIX = "loadtest+";
const EMAIL_DOMAIN = "@example.com";

// 10 activity_completion (1 each) + 5 (first_steps) + 5 (streak_3) = 20
const EXPECTED_PER_USER = 20;

// Award plan per user. Reference IDs are stable per (user_index, item) so
// re-running the script hits the uniq_banana_tx_credit_idempotency index
// rather than double-crediting.
function awardsForUser(userIdx: number, userId: string) {
  const awards: Array<{
    type: "activity_completion" | "achievement_bonus";
    amount: number;
    reference_id: string;
    description: string;
  }> = [];
  for (let i = 0; i < 10; i++) {
    awards.push({
      type: "activity_completion",
      amount: 1,
      reference_id: `loadtest_u${userIdx}_act_${i}`,
      description: `loadtest activity ${i}`,
    });
  }
  awards.push({
    type: "achievement_bonus",
    amount: 5,
    reference_id: `${userId}:first_steps`,
    description: "loadtest first_steps",
  });
  awards.push({
    type: "achievement_bonus",
    amount: 5,
    reference_id: `${userId}:streak_3`,
    description: "loadtest streak_3",
  });
  return awards;
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── helpers ────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function chunkedParallel<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const batch = await Promise.all(slice.map(fn));
    results.push(...batch);
  }
  return results;
}

// ── cleanup path ───────────────────────────────────────────────────────────
async function runCleanup(): Promise<void> {
  console.log(`→ Cleanup mode: deleting ${EMAIL_PREFIX}*${EMAIL_DOMAIN} rows`);

  const { data: targets, error: selErr } = await supabase
    .from("users")
    .select("id, email")
    .like("email", `${EMAIL_PREFIX}%${EMAIL_DOMAIN}`);
  if (selErr) {
    console.error(`✗ users select failed: ${selErr.message}`);
    process.exit(1);
  }
  const ids = (targets ?? []).map((u) => u.id as string);
  console.log(`→ Found ${ids.length} loadtest users to remove`);
  if (ids.length === 0) {
    console.log("✓ Nothing to clean up");
    return;
  }

  const { error: txErr, count: txCount } = await supabase
    .from("banana_transactions")
    .delete({ count: "exact" })
    .in("user_id", ids);
  if (txErr) {
    console.error(`✗ banana_transactions delete failed: ${txErr.message}`);
    process.exit(1);
  }
  console.log(`✓ Deleted ${txCount ?? 0} banana_transactions rows`);

  const { error: usrErr, count: usrCount } = await supabase
    .from("users")
    .delete({ count: "exact" })
    .in("id", ids);
  if (usrErr) {
    console.error(`✗ users delete failed: ${usrErr.message}`);
    process.exit(1);
  }
  console.log(`✓ Deleted ${usrCount ?? 0} users rows`);
}

// ── load test phases ───────────────────────────────────────────────────────

interface SyntheticUser {
  idx: number;
  id: string;
  email: string;
}

async function upsertSyntheticUsers(): Promise<SyntheticUser[]> {
  const users: SyntheticUser[] = Array.from({ length: USERS }, (_, i) => ({
    idx: i,
    id: randomUUID(),
    email: `${EMAIL_PREFIX}${i}${EMAIL_DOMAIN}`,
  }));

  // UPSERT on email — if a previous loadtest run left rows, reuse their ids
  // so transaction reference_ids stay stable across runs (idempotency test).
  // Re-fetch after upsert to pick up the persisted id for already-existing rows.
  const { error: upErr } = await supabase
    .from("users")
    .upsert(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        display_name: `Load Test ${u.idx}`,
        banana_balance: 0,
      })),
      { onConflict: "email", ignoreDuplicates: false },
    );
  if (upErr) {
    console.error(`✗ users upsert failed: ${upErr.message}`);
    process.exit(1);
  }

  const { data: persisted, error: selErr } = await supabase
    .from("users")
    .select("id, email")
    .like("email", `${EMAIL_PREFIX}%${EMAIL_DOMAIN}`);
  if (selErr) {
    console.error(`✗ users re-select failed: ${selErr.message}`);
    process.exit(1);
  }
  const byEmail = new Map<string, string>(
    (persisted ?? []).map((r) => [r.email as string, r.id as string]),
  );
  for (const u of users) {
    const persistedId = byEmail.get(u.email);
    if (persistedId) u.id = persistedId;
  }

  return users;
}

interface WritePhaseResult {
  callsAttempted: number;
  callsSucceeded: number;
  rpcErrors: number;
  elapsedMs: number;
}

async function runWritePhase(users: SyntheticUser[]): Promise<WritePhaseResult> {
  // Flatten every (user, award) pair into a single work list, then batch.
  // This stresses the idempotency index across users — concurrent calls in
  // the same batch hit DIFFERENT (user_id, type, reference_id) rows, while
  // re-running the script hits the SAME rows and should be a clean no-op.
  type Job = { user: SyntheticUser; award: ReturnType<typeof awardsForUser>[number] };
  const jobs: Job[] = [];
  for (const u of users) {
    for (const a of awardsForUser(u.idx, u.id)) jobs.push({ user: u, award: a });
  }

  let rpcErrors = 0;
  let callsSucceeded = 0;
  const start = Date.now();

  await chunkedParallel(jobs, BATCH_SIZE, async (job) => {
    const { error } = await supabase.rpc("add_bananas", {
      p_user_id: job.user.id,
      p_amount: job.award.amount,
      p_type: job.award.type,
      p_reference_id: job.award.reference_id,
      p_description: job.award.description,
    });
    if (error) {
      // 23505 = duplicate key on uniq_banana_tx_credit_idempotency. Expected
      // on the second run (idempotency check). On the first run any error
      // is a real failure.
      const isDup =
        /duplicate key|already exists|23505|uniq_banana_tx_credit_idempotency/i.test(
          error.message,
        );
      if (!isDup) rpcErrors++;
      return { ok: false, dup: isDup };
    }
    callsSucceeded++;
    return { ok: true, dup: false };
  });

  return {
    callsAttempted: jobs.length,
    callsSucceeded,
    rpcErrors,
    elapsedMs: Date.now() - start,
  };
}

interface VerifyResult {
  usersChecked: number;
  usersAtExpected: number;
  usersWrong: Array<{ email: string; actual: number }>;
  ledgerSum: number;
  ledgerExpected: number;
  ledgerCount: number;
}

async function verify(users: SyntheticUser[]): Promise<VerifyResult> {
  // 1. Per-user balance check.
  const { data: balanceRows, error: balErr } = await supabase
    .from("users")
    .select("email, banana_balance")
    .like("email", `${EMAIL_PREFIX}%${EMAIL_DOMAIN}`);
  if (balErr) throw new Error(`balance verify failed: ${balErr.message}`);

  const usersWrong: Array<{ email: string; actual: number }> = [];
  let usersAtExpected = 0;
  for (const row of balanceRows ?? []) {
    const balance = (row.banana_balance as number) ?? 0;
    if (balance === EXPECTED_PER_USER) usersAtExpected++;
    else usersWrong.push({ email: row.email as string, actual: balance });
  }

  // 2. Ledger sum + count check. Pull the rows in pages of 1000 so we don't
  //    blow past supabase-js default limits at high --users values.
  const ids = users.map((u) => u.id);
  let ledgerSum = 0;
  let ledgerCount = 0;
  const PAGE = 1000;
  for (let i = 0; i < ids.length; i += PAGE) {
    const slice = ids.slice(i, i + PAGE);
    const { data: txRows, error: txErr } = await supabase
      .from("banana_transactions")
      .select("amount")
      .in("user_id", slice);
    if (txErr) throw new Error(`ledger select failed: ${txErr.message}`);
    for (const r of txRows ?? []) {
      ledgerSum += (r.amount as number) ?? 0;
      ledgerCount++;
    }
  }

  return {
    usersChecked: balanceRows?.length ?? 0,
    usersAtExpected,
    usersWrong,
    ledgerSum,
    ledgerExpected: USERS * EXPECTED_PER_USER,
    ledgerCount,
  };
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  if (cleanup) {
    await runCleanup();
    return;
  }

  console.log(`→ Banana economy load test`);
  console.log(`  users:   ${USERS}`);
  console.log(`  per-user expected balance: ${EXPECTED_PER_USER} bananas`);
  console.log(`  total expected ledger sum: ${USERS * EXPECTED_PER_USER}`);
  console.log(`  batch size (Promise.all width): ${BATCH_SIZE}`);
  console.log();

  // Phase 0: upsert users.
  console.log(`→ [0/4] Upserting ${USERS} synthetic users...`);
  const upStart = Date.now();
  const users = await upsertSyntheticUsers();
  console.log(`  done in ${fmtMs(Date.now() - upStart)} (${users.length} users)`);
  console.log();

  // Phase 1: first write run. Expected: every RPC call succeeds, 0 errors.
  console.log(`→ [1/4] First write run (${USERS * 12} RPC calls)...`);
  const run1 = await runWritePhase(users);
  console.log(`  attempted:  ${run1.callsAttempted}`);
  console.log(`  succeeded:  ${run1.callsSucceeded}`);
  console.log(`  rpc errors: ${run1.rpcErrors}`);
  console.log(`  elapsed:    ${fmtMs(run1.elapsedMs)}`);
  console.log(`  throughput: ${(run1.callsAttempted / (run1.elapsedMs / 1000)).toFixed(1)} req/s`);
  console.log();

  // Brief settle — UPDATE...FOR UPDATE inside add_bananas should be fully
  // serialised by Postgres, but give MV refresh / triggers room to catch up.
  await sleep(250);

  // Phase 2: balance + ledger verification.
  console.log(`→ [2/4] Verifying balances + ledger sum...`);
  const v1 = await verify(users);
  console.log(`  users at ${EXPECTED_PER_USER} bananas: ${v1.usersAtExpected} / ${v1.usersChecked}`);
  console.log(`  ledger sum:   ${v1.ledgerSum} (expected ${v1.ledgerExpected})`);
  console.log(`  ledger count: ${v1.ledgerCount} (expected ${USERS * 12})`);
  if (v1.usersWrong.length > 0) {
    console.log(`  WRONG (first 10):`);
    for (const w of v1.usersWrong.slice(0, 10)) {
      console.log(`    - ${w.email}: ${w.actual} (expected ${EXPECTED_PER_USER})`);
    }
  }
  console.log();

  // Phase 3: idempotency replay. Expected: every RPC call duplicates and the
  // unique index rejects it; rpcErrors === 0 (because we classify 23505 as
  // expected duplicate, not error); callsSucceeded === 0.
  console.log(`→ [3/4] Idempotency replay (re-running same write phase)...`);
  const run2 = await runWritePhase(users);
  console.log(`  attempted:        ${run2.callsAttempted}`);
  console.log(`  succeeded (NEW):  ${run2.callsSucceeded} (expected 0)`);
  console.log(`  rpc errors:       ${run2.rpcErrors} (expected 0 — all dups handled)`);
  console.log(`  elapsed:          ${fmtMs(run2.elapsedMs)}`);
  console.log();

  // Phase 4: confirm ledger did not grow.
  console.log(`→ [4/4] Confirming ledger did not grow...`);
  const v2 = await verify(users);
  console.log(`  ledger sum:   ${v2.ledgerSum} (expected ${v2.ledgerExpected})`);
  console.log(`  ledger count: ${v2.ledgerCount} (expected ${USERS * 12})`);
  console.log();

  // ── verdict ──────────────────────────────────────────────────────────────
  const failures: string[] = [];
  if (run1.rpcErrors > 0) failures.push(`Run 1 had ${run1.rpcErrors} unexpected RPC errors`);
  if (v1.usersAtExpected !== USERS)
    failures.push(`Only ${v1.usersAtExpected}/${USERS} users at expected balance`);
  if (v1.ledgerSum !== v1.ledgerExpected)
    failures.push(`Ledger sum ${v1.ledgerSum} != expected ${v1.ledgerExpected}`);
  if (v1.ledgerCount !== USERS * 12)
    failures.push(`Ledger row count ${v1.ledgerCount} != expected ${USERS * 12}`);
  if (run2.callsSucceeded !== 0)
    failures.push(`Idempotency BROKEN — replay credited ${run2.callsSucceeded} new transactions`);
  if (run2.rpcErrors > 0)
    failures.push(`Replay had ${run2.rpcErrors} non-duplicate RPC errors`);
  if (v2.ledgerSum !== v1.ledgerSum)
    failures.push(`Ledger sum changed between runs: ${v1.ledgerSum} → ${v2.ledgerSum}`);
  if (v2.ledgerCount !== v1.ledgerCount)
    failures.push(`Ledger row count changed between runs: ${v1.ledgerCount} → ${v2.ledgerCount}`);

  if (failures.length === 0) {
    console.log(`✓ PASS — banana economy intact`);
    console.log(`  Run --cleanup to remove the ${USERS} loadtest users + their transactions.`);
    process.exit(0);
  } else {
    console.log(`✗ FAIL — ${failures.length} assertion(s) violated:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
