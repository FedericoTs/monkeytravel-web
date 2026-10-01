import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * trip_today_actions stores each guest's mt_anon_voter cookie, so it has no
 * public read path: the service-role routes read and write it, and live
 * updates travel as a broadcast that carries no data. These guards fail if a
 * browser subscription to its rows or a public grant comes back.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  return readdirSync(abs).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(name) && !/\.vitest\.tsx?$/.test(name) ? [rel] : [];
  });
}

describe("trip_today_actions has no public read path", () => {
  it("no code subscribes to its row changes", () => {
    const offenders = ["app", "components", "lib", "hooks"]
      .flatMap(sourceFiles)
      .filter((file) => {
        const src = read(file);
        return src.includes("postgres_changes") && src.includes("trip_today_actions");
      });
    expect(offenders).toEqual([]);
  });

  it("the Today hook listens to the broadcast the route sends after each change", () => {
    const hook = read("lib/today/useTodayActions.ts");
    expect(hook).toMatch(/\.channel\(todayChannel\(tripId\)\)/);
    expect(hook).toMatch(/\.on\("broadcast", \{ event: TODAY_CHANGED_EVENT \}/);
    const route = read("app/api/shared/[token]/today-action/route.ts");
    expect(route).toMatch(/admin\.channel\(todayChannel\(trip\.id\)\)\.httpSend\(TODAY_CHANGED_EVENT/);
  });

  it("the migration closes the table and takes it out of realtime", () => {
    const sql = read("supabase/migrations/20261001220000_close_trip_today_actions_read.sql");
    expect(sql).toContain('drop policy if exists "Anyone can read today actions" on public.trip_today_actions;');
    expect(sql).toContain("revoke all on public.trip_today_actions from public, anon, authenticated;");
    expect(sql).toContain("alter publication supabase_realtime drop table public.trip_today_actions;");
  });

  it("the committed RLS baseline grants it to no client role", () => {
    const baseline = JSON.parse(read("supabase/rls-baseline.json")) as Array<{
      table: string;
      grants: Record<string, string[]>;
      policies: unknown[];
    }>;
    const entry = baseline.find((t) => t.table === "trip_today_actions");
    expect(entry?.grants).toEqual({});
    expect(entry?.policies).toEqual([]);
  });
});
