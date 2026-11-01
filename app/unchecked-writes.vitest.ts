// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * A Supabase write whose result is thrown away cannot tell a write that landed
 * from one the database refused, so the caller reports success either way.
 * Read `error` (or `.then`/`.catch` it), return the promise, or mark a
 * deliberate fire-and-forget with `void`. The count can only go down: lower
 * CEILING when a change checks some.
 */
const CEILING = 0;

const WRITES = new Set(["insert", "update", "upsert", "delete"]);
const HANDLED = new Set(["then", "catch", "finally"]);

/** Method names along a call chain, outermost first: a.from().update().eq() gives [eq, update, from]. */
function methodChain(expression: ts.Expression): string[] {
  const names: string[] = [];
  let e: ts.Expression | undefined = expression;
  while (e) {
    if (ts.isCallExpression(e)) e = e.expression;
    else if (ts.isPropertyAccessExpression(e)) {
      names.push(e.name.text);
      e = e.expression;
    } else if (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    else break;
  }
  return names;
}

/** Lines in `source` that write with Supabase and discard the result. */
export function uncheckedWrites(fileName: string, source: string): number[] {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && !ts.isVoidExpression(node.expression)) {
      const call = ts.isAwaitExpression(node.expression) ? node.expression.expression : node.expression;
      if (ts.isCallExpression(call)) {
        const names = methodChain(call);
        if (names.includes("from") && names.some((n) => WRITES.has(n)) && !HANDLED.has(names[0])) {
          lines.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

describe("Supabase writes with their result thrown away", () => {
  // Parses every source file, which takes longer than the default 5 s when
  // the whole suite runs in parallel.
  it(`stay at or under ${CEILING}`, () => {
    const files = execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /^(app|lib|components|hooks)\/.*\.(ts|tsx)$/.test(f) && !/\.vitest\.tsx?$/.test(f));
    const found = files.flatMap((f) => uncheckedWrites(f, readFileSync(f, "utf8")).map((line) => `${f}:${line}`));
    expect(found.length, `${found.length} unchecked writes (ceiling ${CEILING}):\n${found.join("\n")}`).toBeLessThanOrEqual(CEILING);
  }, 60_000);

  it("counts a discarded write, and not a checked, returned or void one", () => {
    const count = (code: string) => uncheckedWrites("x.ts", `async function f(db: any) {\n${code}\n}`).length;
    expect(count(`await db.from("trips").update({ a: 1 }).eq("id", 1);`)).toBe(1);
    expect(count(`db.from("trips").insert({ a: 1 });`)).toBe(1);
    expect(count(`const { error } = await db.from("trips").update({ a: 1 }).eq("id", 1);`)).toBe(0);
    expect(count(`return db.from("trips").delete().eq("id", 1);`)).toBe(0);
    expect(count(`void db.from("page_views").insert({ a: 1 });`)).toBe(0);
    expect(count(`db.from("trips").upsert({ a: 1 }).then(({ error }) => error);`)).toBe(0);
    expect(count(`await db.from("trips").select("id").eq("id", 1);`)).toBe(0);
  });
});
