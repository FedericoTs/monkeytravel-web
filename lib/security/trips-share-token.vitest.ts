// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { TRIP_COLUMNS } from "@/lib/trips/columns";

/**
 * Only a trip's owner and its members may read its share_token, which opens
 * the trip's private group page. The database grants anon and authenticated
 * every trips column but that one. These guards fail if a later migration
 * grants it back, if TRIP_COLUMNS drifts from the grant, or if a user-scoped
 * query asks for the token or for "*" (the grant refuses both, 42501).
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");
const MIGRATIONS = path.join("supabase", "migrations");
const GRANT_MIGRATION = "20261010200000_trips_share_token_members_only.sql";

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  return readdirSync(abs).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(name) && !/\.vitest\.tsx?$/.test(name) ? [rel] : [];
  });
}

const columns = (list: string) =>
  list
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

/** The texts a select argument can take: both sides of a ?:, the literal parts of a template. */
function selectTexts(arg: ts.Expression | undefined): string[] {
  if (!arg) return ["*"]; // select() selects every column
  if (ts.isParenthesizedExpression(arg)) return selectTexts(arg.expression);
  if (ts.isConditionalExpression(arg)) return [...selectTexts(arg.whenTrue), ...selectTexts(arg.whenFalse)];
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return [arg.text];
  if (ts.isTemplateExpression(arg)) return [arg.head.text, ...arg.templateSpans.map((s) => s.literal.text)];
  return []; // a constant such as TRIP_COLUMNS, checked against the grant above
}

const asksForStarOrToken = (text: string) => /(^|[\s,(])\*(\s*[,)]|\s*$)|\bshare_token\b/.test(text);
const embedsStarOrToken = (text: string) => /\btrips(?:![a-z_]+)?\s*\(\s*(\*|[^)]*\bshare_token\b)/.test(text);

/** Trips reads that ask for "*" or the token, as "file: what". */
function offendingReads(file: string, src = read(file)): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  // Variables holding a trips query, as in `let write = db.from("trips")...; write.select()`.
  const tripsQueries = new Set<string>();
  const onTrips = (e: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e)) return onTrips(e.expression);
    if (ts.isConditionalExpression(e)) return onTrips(e.whenTrue) || onTrips(e.whenFalse);
    if (ts.isIdentifier(e)) return tripsQueries.has(e.text);
    if (ts.isPropertyAccessExpression(e)) return onTrips(e.expression);
    if (!ts.isCallExpression(e)) return false;
    const callee = e.expression;
    const first = e.arguments[0];
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "from" && first && ts.isStringLiteralLike(first)) {
      return first.text === "trips";
    }
    return onTrips(callee);
  };
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && onTrips(node.initializer)) {
      tripsQueries.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "select") {
      const first = node.arguments[0];
      if (onTrips(node.expression.expression) && selectTexts(first).some(asksForStarOrToken)) {
        found.push(`${file}: trips .select(${first?.getText(sf).slice(0, 60) ?? ""})`);
      }
      // An embedded trips(*) from another table selects every trips column too.
      if (selectTexts(first).some(embedsStarOrToken)) found.push(`${file}: .select(${first?.getText(sf).slice(0, 60)})`);
    }
    // The shared ownership and access checks select through the caller's client.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^verifyTrip(Ownership|Access)$/.test(node.expression.text)) {
      const fields = node.arguments[3];
      if (fields && selectTexts(fields).some(asksForStarOrToken)) found.push(`${file}: ${node.expression.text}(…, ${fields.getText(sf)})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// Service-role reads of the whole row or of the token: each runs for the
// token's holder, for staff or for a cron, and none hands the token to
// anyone who is not on the trip.
const SERVICE_ROLE_READS = [
  "app/[locale]/(app)/shared/[token]/page.tsx",
  "app/[locale]/(app)/invite/[token]/page.tsx",
  "app/api/trips/duplicate/route.ts",
  "app/api/trips/[id]/view/route.ts",
  "app/api/cron/scheduled-notifications/route.ts",
  "app/api/admin/growth/route.ts",
  "app/api/admin/stats/route.ts",
  "lib/trips/share-token.ts",
].map((p) => path.normalize(p));

describe("a trip's share_token is readable by its owner and members only", () => {
  const sql = read(path.join(MIGRATIONS, GRANT_MIGRATION));
  const granted = columns(sql.match(/grant select \(([^)]*)\) on public\.trips to anon, authenticated;/)?.[1] ?? "");

  it("the migration takes table-wide SELECT away from every client role", () => {
    expect(sql).toContain("revoke select on public.trips from public, anon, authenticated;");
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });

  it("grants every other column back, and TRIP_COLUMNS is exactly that list", () => {
    expect(granted.length).toBeGreaterThan(40);
    expect(granted).not.toContain("share_token");
    expect(new Set(granted).size).toBe(granted.length);
    expect(columns(TRIP_COLUMNS)).toEqual(granted);
  });

  it("is the latest word on who may select trips", () => {
    const later = readdirSync(path.join(ROOT, MIGRATIONS))
      .filter((f) => f.endsWith(".sql") && f > GRANT_MIGRATION)
      .sort();
    const offenders = later.flatMap((f) =>
      [...read(path.join(MIGRATIONS, f)).matchAll(/\bgrant\b[^;]*\bon\s+(?:table\s+)?(?:public\.)?trips\b[^;]*;/gi)]
        .map((m) => m[0])
        // A later grant may add a new column by name, never the table or the token.
        .filter((stmt) => !/\bselect\s*\(/i.test(stmt) || /\bshare_token\b/i.test(stmt))
        .map((stmt) => `${f}: ${stmt.replace(/\s+/g, " ")}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the committed RLS baseline holds no table-wide SELECT on trips for a client role", () => {
    const baseline = JSON.parse(read("supabase/rls-baseline.json")) as Array<{ table: string; grants: Record<string, string[]> }>;
    const trips = baseline.find((t) => t.table === "trips");
    expect(trips).toBeDefined();
    expect(trips!.grants.anon).not.toContain("SELECT");
    expect(trips!.grants.authenticated).not.toContain("SELECT");
  });

  it("no user-scoped query on trips asks for * or for the token", () => {
    const offenders = ["app", "components", "hooks", "lib"]
      .flatMap(sourceFiles)
      .filter((file) => !SERVICE_ROLE_READS.includes(path.normalize(file)))
      .flatMap((file) => offendingReads(file));
    expect(offenders).toEqual([]);
  }, 30_000);

  it("the scan flags every shape the grant refuses, and nothing else", () => {
    const flagged = (line: string) => offendingReads("probe.ts", line).length;
    expect(flagged(`a.from("trips").select("*");`)).toBe(1);
    expect(flagged(`a.from("trips").select();`)).toBe(1);
    expect(flagged(`a.from("trips").select("*", { count: "exact", head: true }).eq("user_id", u);`)).toBe(1);
    expect(flagged(`a.from("trips").update(x).eq("id", i).select("id, share_token").single();`)).toBe(1);
    expect(flagged(`let write = a.from("trips").update(x).eq("id", i);\nwrite = write.eq("v", 1);\nwrite.select().single();`)).toBe(1);
    expect(flagged(`a.from("trips").select(on ? "id, share_token" : "id");`)).toBe(1);
    expect(flagged(`a.from("trip_collaborators").select("role, trips(*)");`)).toBe(1);
    expect(flagged(`verifyTripAccess(s, id, uid, "id, user_id, share_token");`)).toBe(1);
    expect(flagged(`verifyTripOwnership(s, id, uid, "*");`)).toBe(1);
    expect(flagged(`a.from("trips").select(TRIP_COLUMNS).eq("id", i); // not select("*")`)).toBe(0);
    expect(flagged(`a.from("trips").select("id", { count: "exact", head: true });`)).toBe(0);
    expect(flagged(`a.from("trip_collaborators").select(\`role, trips(\${TRIP_COLUMNS})\`);`)).toBe(0);
  });
});
