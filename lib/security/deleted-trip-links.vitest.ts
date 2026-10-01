import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Deleting a trip keeps its share token, and the service-role lookups behind
 * shared and invite links skip the RLS that hides deleted trips everywhere
 * else. Each of them has to filter deleted_at itself; these guards fail if
 * one stops doing so.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");
const DELETED_FILTER = '.is("deleted_at", null)';
const SHARE_TOKEN_LOOKUP = /\.eq\("share_token", \w+\)/;

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  return readdirSync(abs).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(name) && !/\.vitest\.tsx?$/.test(name) ? [rel] : [];
  });
}

/** Query chains from `marker` to .single()/.maybeSingle() that skip the deleted filter. */
function unfiltered(src: string, marker: RegExp): string[] {
  return [...src.matchAll(new RegExp(marker.source, "g"))]
    .map((m) => {
      const rest = src.slice(m.index);
      const end = rest.search(/\.(single|maybeSingle)\(/);
      return end === -1 ? rest : rest.slice(0, end);
    })
    .filter((chain) => !chain.includes(DELETED_FILTER))
    .map((chain) => chain.split("\n")[0]);
}

describe("links to a deleted trip stop answering", () => {
  it("every share-token lookup filters deleted trips", () => {
    // The trip card builds its query in steps, so its base query carries the filter.
    const stepwise = path.join("app", "api", "og", "trip", "route.tsx");
    const files = ["app", "lib"].flatMap(sourceFiles).filter((f) => SHARE_TOKEN_LOOKUP.test(read(f)) && f !== stepwise);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((f) => unfiltered(read(f), SHARE_TOKEN_LOOKUP).map((line) => `${f}: ${line}`));
    expect(offenders).toEqual([]);
    expect(read(stepwise)).toMatch(/\.from\("trips"\)\s*\.select\([^)]*\)\s*\.is\("deleted_at", null\);/);
  });

  it("every /api/shared/[token] route looks its trip up by share token", () => {
    const routes = sourceFiles(path.join("app", "api", "shared", "[token]")).filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(read(route), route).toMatch(/\.eq\("share_token", token\)/);
  });

  it("an invite to a deleted trip shows trip-not-found", () => {
    const byInvite = /\.eq\("id", invite\.trip_id\)/;
    expect(unfiltered(read("app/api/invites/[token]/route.ts"), byInvite)).toEqual([]);
    expect(unfiltered(read("app/[locale]/(app)/invite/[token]/page.tsx"), byInvite)).toEqual([]);
  });

  it("the latest accept_trip_invite refuses deleted trips", () => {
    const dir = path.join("supabase", "migrations");
    const latest = readdirSync(path.join(ROOT, dir))
      .sort()
      .filter((name) => /create or replace function public\.accept_trip_invite/i.test(read(path.join(dir, name))))
      .pop();
    expect(latest).toBeDefined();
    expect(read(path.join(dir, latest!))).toMatch(/FROM public\.trips\s+WHERE id = v_invite\.trip_id\s+AND deleted_at IS NULL;/);
  });
});
