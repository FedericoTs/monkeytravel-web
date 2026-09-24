import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The database's editor allowlist for trips (20260924124000).
 *
 * An invited editor passes trips_update and holds UPDATE on every column, so
 * before this migration they could make the owner's private trip public,
 * kill the share link, move dates, mute the owner's reminders or rewrite
 * trip_meta straight through PostgREST. The route PATCH /api/trips/[id]
 * limits editors to EDITOR_FIELDS; the guard must allow exactly those, or an
 * editor's Save answers 403 (list too short) or the database lets through
 * what the route refuses (list too long).
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");
const sql = read("supabase/migrations/20260924124000_trips_editor_columns.sql");
const route = read("app/api/trips/[id]/route.ts");

function listed(src: string, pattern: RegExp): string[] {
  const body = src.match(pattern)?.[1] ?? "";
  return [...body.matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]).sort();
}

describe("trips editor allowlist", () => {
  const dbColumns = listed(sql, /c_editor_columns constant text\[\] := array\[([^\]]*)\]/);
  const routeFields = listed(route, /const EDITOR_FIELDS = new Set\(\[([^\]]*)\]\)/);

  it("the database allows exactly the route's editor fields (plus its three special cases)", () => {
    expect(routeFields.length).toBeGreaterThan(0);
    const special = ["public_slug", "trip_meta", "updated_at"];
    expect(dbColumns.filter((c) => !special.includes(c))).toEqual(routeFields);
    for (const s of special) expect(dbColumns).toContain(s);
  });

  it("none of the route's owner-only fields is in the database allowlist", () => {
    const ownerOnly = listed(route, /const OWNER_ONLY_FIELDS = \[([^\]]*)\]/);
    expect(ownerOnly.length).toBeGreaterThan(0);
    for (const f of ownerOnly) expect(dbColumns).not.toContain(f);
  });

  it("the owner test does not treat null = null as ownership", () => {
    // Anonymous trips have user_id null and anon has auth.uid() null.
    expect(sql).toContain("if v_uid is not null and v_uid = old.user_id then");
  });

  it("is default-deny: every column is compared, not a fixed list", () => {
    expect(sql).toMatch(/from jsonb_each\(to_jsonb\(new\)\) as n\s+where n\.key <> all \(c_editor_columns\)/);
    expect(sql).toContain("raise exception 'only the trip owner can change: %'");
  });

  it("an editor's trip_meta write keeps only packing_checked, as a list of names", () => {
    expect(sql).toContain("new.trip_meta := (coalesce(old.trip_meta, '{}'::jsonb) - 'packing_checked')");
    expect(sql).toContain("strict $[*] ? (@.type() != \"string\")");
  });

  it("keeps every rule of the guard it replaces", () => {
    const head = sql.slice(sql.indexOf("create or replace function public.trips_guard_protected_columns()"));
    expect(head.slice(0, head.indexOf("as $function$"))).toContain("security invoker");
    expect(sql).toContain("current_user in ('postgres', 'service_role', 'supabase_admin')");
    expect(sql).toContain("if new.user_id is distinct from old.user_id then");
    expect(sql).toContain("if new.parent_trip_id is distinct from old.parent_trip_id then");
    expect(sql).toContain("not public.trip_is_forkable(new.parent_trip_id)");
    for (const col of [
      "like_count", "save_count", "fork_count", "template_copy_count", "view_count",
      "trending_score", "trending_approved", "is_editors_pick", "is_hidden",
      "reported_count", "is_template", "created_at",
    ]) {
      expect(sql).toContain(`new.${col} := old.${col};`);
      expect(sql).toMatch(new RegExp(`new\\.${col} := (0|false|now\\(\\));`));
    }
    // The pins run before the owner early-return and the column check.
    expect(sql.indexOf("new.created_at := old.created_at;")).toBeLessThan(sql.indexOf("v_uid := auth.uid();"));
  });

  it("the route turns a guard refusal into 403, not 500", () => {
    expect(route).toMatch(/updateError\.code === "42501"\) \{\s*return errors\.forbidden\(/);
  });
});
