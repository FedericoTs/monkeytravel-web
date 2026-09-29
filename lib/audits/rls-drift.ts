/**
 * Compares production's row-level security with the committed baseline
 * (supabase/rls-baseline.json). scripts/rls-baseline.mts runs it by hand and
 * on pull requests; app/api/cron/audit-rls-drift runs it nightly where the
 * service-role key already lives.
 */

/** One entry per table: grants, policies and the RLS flags, as rls_snapshot() returns them. */
export type RlsSnapshot = Array<Record<string, unknown>>;

/** The live authorization surface, through the service-role-only rls_snapshot() function. */
export async function fetchRlsSnapshot(url: string, key: string): Promise<RlsSnapshot> {
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
  return (await res.json()) as RlsSnapshot;
}

const byTable = (s: RlsSnapshot) => new Map(s.map((t) => [String(t.table), t]));

/** Stable string for one table's authorization surface. */
const fingerprint = (t: Record<string, unknown>) => JSON.stringify(t);

/** Every difference between the baseline and the live snapshot, one line each; empty when they match. */
export function rlsDrift(baseline: RlsSnapshot, live: RlsSnapshot): string[] {
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
 * The specific shape behind the 2026-08-19 incident: a permissive write
 * policy whose expression is literally `true`, reachable by anon or public.
 * Reported apart from drift because it is worth shouting about even when the
 * baseline was updated to include it.
 */
export function anonWritablePolicies(live: RlsSnapshot): string[] {
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
