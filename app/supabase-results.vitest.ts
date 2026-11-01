// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * Supabase reports a refused query in `error` instead of throwing, so a result
 * the caller never looks at turns a database failure into a success, an empty
 * list or a "not found". Both counts can only go down: lower a ceiling when a
 * change checks some.
 *
 * - A write whose result is thrown away: read `error` (or `.then`/`.catch`
 *   it), return the promise, or mark a deliberate fire-and-forget with `void`.
 * - A result taken without `error`: `const { data } = await db.from(...)...`,
 *   `(await ...).data`, the same from `await Promise.all([...])`, or a result
 *   kept whole and only ever read for `.data` or `.count`. Take `error` too,
 *   pass the result to `logReadError`, or hand it to code that checks it.
 */
const UNCHECKED_WRITES_CEILING = 0;
const DROPPED_ERRORS_CEILING = 0;

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

/** A query or RPC: `db.from(...).select(...)`, `db.rpc(...)`. */
function isQuery(expression: ts.Expression): boolean {
  const names = methodChain(expression);
  return (names.includes("from") && names.some((n) => n === "select" || WRITES.has(n))) || names.includes("rpc");
}

function unwrap(expression: ts.Expression): ts.Expression {
  let e = expression;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
  return e;
}

/** An awaited query or RPC: `await db.from(...).select(...)`, `await db.rpc(...)`. */
function isAwaitedQuery(expression: ts.Expression): boolean {
  const e = unwrap(expression);
  return ts.isAwaitExpression(e) && isQuery(e.expression);
}

/** The elements of `await Promise.all([...])`, or null for anything else. */
function promiseAllElements(expression: ts.Expression): readonly ts.Expression[] | null {
  const e = unwrap(expression);
  if (!ts.isAwaitExpression(e) || !ts.isCallExpression(e.expression)) return null;
  const { expression: callee, arguments: [list] } = e.expression;
  const isPromiseAll =
    ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Promise" && callee.name.text === "all";
  return isPromiseAll && list && ts.isArrayLiteralExpression(list) ? list.elements : null;
}

const keepsError = (pattern: ts.ObjectBindingPattern, file: ts.SourceFile) =>
  pattern.elements.some((el) => el.dotDotDotToken || (el.propertyName ?? el.name).getText(file) === "error");

/**
 * Whether a result kept whole is only ever read for its data: `r.data`,
 * `r.count`, or `const { data } = r`. Reading `r.error` or passing `r` on
 * counts as checking it.
 */
function onlyDataIsRead(name: ts.Identifier, file: ts.SourceFile): boolean {
  let scope: ts.Node = name.parent;
  while (!ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isCaseOrDefaultClause(scope) && !ts.isModuleBlock(scope)) scope = scope.parent;
  let checked = false;
  const visit = (node: ts.Node): void => {
    if (checked) return;
    if (ts.isIdentifier(node) && node !== name && node.text === name.text && isReference(node)) {
      const use = node.parent;
      const field = ts.isNonNullExpression(use) ? use.parent : use;
      const takesData =
        (ts.isPropertyAccessExpression(field) && (field.name.text === "data" || field.name.text === "count")) ||
        (ts.isVariableDeclaration(use) && use.initializer === node && ts.isObjectBindingPattern(use.name) && !keepsError(use.name, file));
      if (!takesData) checked = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return !checked;
}

/** An identifier that refers to a variable, not a property name or a new declaration. */
function isReference(node: ts.Identifier): boolean {
  const p = node.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return false;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === node) return false;
  if (ts.isBindingElement(p) && (p.propertyName === node || p.name === node)) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)) && p.name === node) return false;
  return true;
}

export interface SupabaseResultFindings {
  /** Lines that write with Supabase and discard the result. */
  uncheckedWrites: number[];
  /** Lines that take a query's data (or count) and drop its error. */
  droppedErrors: number[];
}

export function supabaseResultFindings(fileName: string, source: string): SupabaseResultFindings {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: SupabaseResultFindings = { uncheckedWrites: [], droppedErrors: [] };
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && !ts.isVoidExpression(node.expression)) {
      const call = ts.isAwaitExpression(node.expression) ? node.expression.expression : node.expression;
      if (ts.isCallExpression(call)) {
        const names = methodChain(call);
        if (names.includes("from") && names.some((n) => WRITES.has(n)) && !HANDLED.has(names[0])) {
          found.uncheckedWrites.push(lineOf(node));
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isAwaitedQuery(node.initializer)) {
      const dropped = ts.isObjectBindingPattern(node.name)
        ? !keepsError(node.name, file)
        : ts.isIdentifier(node.name) && onlyDataIsRead(node.name, file);
      if (dropped) found.droppedErrors.push(lineOf(node));
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isArrayBindingPattern(node.name)) {
      const elements = promiseAllElements(node.initializer);
      node.name.elements.forEach((binding, i) => {
        const query = elements?.[i];
        if (!ts.isBindingElement(binding) || !query || !isQuery(query)) return;
        const dropped = ts.isObjectBindingPattern(binding.name)
          ? !keepsError(binding.name, file)
          : ts.isIdentifier(binding.name) && onlyDataIsRead(binding.name, file);
        if (dropped) found.droppedErrors.push(lineOf(binding));
      });
    }
    if (ts.isPropertyAccessExpression(node) && (node.name.text === "data" || node.name.text === "count") && isAwaitedQuery(node.expression)) {
      found.droppedErrors.push(lineOf(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

let repoFindings: Array<{ file: string } & SupabaseResultFindings> | undefined;

/** Every source file, parsed once for both counts. */
function findingsInRepo() {
  repoFindings ??= execSync("git ls-files", { encoding: "utf8" })
    .split("\n")
    .filter((f) => /^(app|lib|components|hooks)\/.*\.(ts|tsx)$/.test(f) && !/\.vitest\.tsx?$/.test(f))
    .map((file) => ({ file, ...supabaseResultFindings(file, readFileSync(file, "utf8")) }));
  return repoFindings;
}

describe("Supabase results nobody checks", () => {
  // Parsing every source file takes longer than the default 5 s when the
  // whole suite runs in parallel.
  it(`writes with their result thrown away stay at or under ${UNCHECKED_WRITES_CEILING}`, () => {
    const found = findingsInRepo().flatMap((f) => f.uncheckedWrites.map((line) => `${f.file}:${line}`));
    expect(found.length, `${found.length} unchecked writes (ceiling ${UNCHECKED_WRITES_CEILING}):\n${found.join("\n")}`).toBeLessThanOrEqual(UNCHECKED_WRITES_CEILING);
  }, 60_000);

  it(`results that drop their error stay at or under ${DROPPED_ERRORS_CEILING}`, () => {
    const found = findingsInRepo().flatMap((f) => f.droppedErrors.map((line) => `${f.file}:${line}`));
    expect(found.length, `${found.length} results drop their error (ceiling ${DROPPED_ERRORS_CEILING}):\n${found.join("\n")}`).toBeLessThanOrEqual(DROPPED_ERRORS_CEILING);
  }, 60_000);

  it("counts a discarded write, and not a checked, returned or void one", () => {
    const count = (code: string) => supabaseResultFindings("x.ts", `async function f(db: any) {\n${code}\n}`).uncheckedWrites.length;
    expect(count(`await db.from("trips").update({ a: 1 }).eq("id", 1);`)).toBe(1);
    expect(count(`db.from("trips").insert({ a: 1 });`)).toBe(1);
    expect(count(`const { error } = await db.from("trips").update({ a: 1 }).eq("id", 1);`)).toBe(0);
    expect(count(`return db.from("trips").delete().eq("id", 1);`)).toBe(0);
    expect(count(`void db.from("page_views").insert({ a: 1 });`)).toBe(0);
    expect(count(`db.from("trips").upsert({ a: 1 }).then(({ error }) => error);`)).toBe(0);
    expect(count(`await db.from("trips").select("id").eq("id", 1);`)).toBe(0);
  });

  it("counts a result taken without its error, and not one that keeps it", () => {
    const count = (code: string) => supabaseResultFindings("x.ts", `async function f(db: any) {\n${code}\n}`).droppedErrors.length;
    expect(count(`const { data } = await db.from("trips").select("id").eq("id", 1).single();`)).toBe(1);
    expect(count(`const { data: trip } = await db.from("trips").select("id").maybeSingle();`)).toBe(1);
    expect(count(`const { count } = await db.from("trips").select("*", { count: "exact", head: true });`)).toBe(1);
    expect(count(`const { data } = await db.rpc("next_id", { a: 1 });`)).toBe(1);
    expect(count(`const rows = (await db.from("trips").select("id")).data;`)).toBe(1);
    expect(count(`const { data } = await db.from("trips").insert({ a: 1 }).select().single();`)).toBe(1);
    expect(count(`const { data, error } = await db.from("trips").select("id");`)).toBe(0);
    expect(count(`const { data: trip, error: tripError } = await db.from("trips").select("id");`)).toBe(0);
    expect(count(`const { data, ...rest } = await db.from("trips").select("id");`)).toBe(0);
    expect(count(`const result = await db.from("trips").select("id"); return result;`)).toBe(0);
    expect(count(`const { data } = await db.storage.from("avatars").download("a.png");`)).toBe(0);
    expect(count(`const { data } = await db.auth.getUser();`)).toBe(0);
  });

  it("counts results from Promise.all, and whole results only read for their data", () => {
    const count = (code: string) => supabaseResultFindings("x.ts", `async function f(db: any) {\n${code}\n}`).droppedErrors.length;
    expect(count(`const [{ data: a }, { count: b }] = await Promise.all([db.from("a").select("id"), db.rpc("b")]);`)).toBe(2);
    expect(count(`const [{ data: a, error }, b] = await Promise.all([db.from("a").select("id"), load()]);`)).toBe(0);
    expect(count(`const r = await db.from("trips").select("id"); return r.data;`)).toBe(1);
    expect(count(`const [r] = await Promise.all([db.from("trips").select("id")]); const { data } = r; return data ?? r?.count;`)).toBe(1);
    expect(count(`const r = await db.from("trips").select("id"); if (r.error) throw r.error; return r.data;`)).toBe(0);
    expect(count(`const [r] = await Promise.all([db.from("trips").select("id")]); return logReadError("trips", r).data;`)).toBe(0);
    expect(count(`const [r] = await Promise.all([db.from("trips").select("id")]); const { data, error } = r; return error ? null : data;`)).toBe(0);
    expect(count(`const [a, b] = await Promise.all([load(), db.from("trips").select("id")]); return [a, b];`)).toBe(0);
  });
});
