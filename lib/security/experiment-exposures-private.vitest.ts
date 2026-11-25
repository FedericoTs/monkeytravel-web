import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Experiment exposures are written and read through the service role only. These guards fail if the table opens up
 * to visitors or signed-in users, or if it stops holding one arm per experiment and browser session.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");

describe("experiment exposures are server-only", () => {
  const migration = read("supabase/migrations/20261125163627_experiment_exposures.sql");

  it("the table has row level security on and no grants or policies", () => {
    expect(migration).toContain("alter table public.experiment_exposures enable row level security;");
    expect(migration).toContain("revoke all on table public.experiment_exposures from public, anon, authenticated;");
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/\bgrant\b/i);
  });

  it("holds one arm per experiment and browser session", () => {
    expect(migration).toContain("unique (experiment, session_id)");
  });

  it("the committed RLS baseline gives visitors and signed-in users no access", () => {
    const baseline = JSON.parse(read("supabase/rls-baseline.json")) as Array<{
      table: string;
      grants: Record<string, string[]>;
      policies: unknown[];
      rls_enabled: boolean;
    }>;
    const entry = baseline.find((t) => t.table === "experiment_exposures");
    expect(entry).toBeDefined();
    expect(entry?.rls_enabled).toBe(true);
    expect(entry?.grants).toEqual({});
    expect(entry?.policies).toEqual([]);
  });
});
