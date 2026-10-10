import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * API request logs carry every user's ids, trips and searches, so only the
 * service role reads them: the admin dashboards and the spend alert. These
 * guards fail if the table opens up to signed-in users or visitors again, or
 * if a reader moves to a client that runs as the caller.
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

describe("API request logs are server-only", () => {
  const users = ["app", "lib", "components", "hooks"]
    .flatMap(sources)
    .filter((f) => read(f).includes('from("api_request_logs")'));

  it("every file that touches the table uses the service role", () => {
    expect(users.length).toBeGreaterThan(0);
    for (const f of users) {
      const src = read(f);
      expect(src.includes("createAdminClient") || src.includes("SUPABASE_SERVICE_ROLE_KEY"), f).toBe(true);
      expect(f.startsWith("components") || f.startsWith("hooks"), f).toBe(false);
    }
  });

  it("the committed RLS baseline gives visitors and signed-in users no access", () => {
    const baseline = JSON.parse(read("supabase/rls-baseline.json")) as Array<{
      table: string;
      grants: Record<string, string[]>;
      policies: Array<{ cmd: string }>;
    }>;
    const entry = baseline.find((t) => t.table === "api_request_logs")!;
    expect(entry.grants.anon ?? []).toEqual([]);
    expect(entry.grants.authenticated ?? []).toEqual([]);
    expect(entry.policies).toEqual([]);
  });
});
