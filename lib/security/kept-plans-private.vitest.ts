import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Kept plans are read by their exact token through the service role only
 * (app/api/plans). These guards fail if the table opens up to visitors or
 * signed-in users, or if anything reaches it from a client that runs as the
 * caller.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return name === "node_modules" ? [] : sources(rel);
    return /\.(ts|tsx)$/.test(name) && !/\.(vitest|test)\./.test(name) ? [rel] : [];
  });
}

describe("kept plans are server-only", () => {
  const migration = read("supabase/migrations/20261026170000_kept_plans.sql");

  it("the table has row level security on and no grants", () => {
    expect(migration).toContain("alter table public.kept_plans enable row level security;");
    expect(migration).toContain("revoke all on table public.kept_plans from public, anon, authenticated;");
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).toContain("revoke execute on function public.open_kept_plan(text) from public, anon, authenticated;");
  });

  it("the committed RLS baseline gives visitors and signed-in users no access", () => {
    const baseline = JSON.parse(read("supabase/rls-baseline.json")) as Array<{
      table: string;
      grants: Record<string, string[]>;
      policies: unknown[];
      rls_enabled: boolean;
    }>;
    const entry = baseline.find((t) => t.table === "kept_plans")!;
    expect(entry).toMatchObject({ grants: {}, policies: [], rls_enabled: true });
  });

  it("every file that touches the table uses the service role", () => {
    const users = ["app", "lib", "components", "hooks"]
      .flatMap(sources)
      .filter((f) => /from\("kept_plans"\)|rpc\("open_kept_plan"/.test(read(f)));
    expect(users.length).toBeGreaterThan(0);
    for (const f of users) {
      expect(read(f), f).toContain("createAdminClient");
      expect(f.startsWith("app") && f.includes(`${path.sep}api${path.sep}`), f).toBe(true);
    }
    // Reads every source file: slow when the whole suite runs at once.
  }, 30_000);
});
