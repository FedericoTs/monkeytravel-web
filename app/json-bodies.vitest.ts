// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * A malformed request body is the client's mistake, so it gets a 400. A route
 * that awaits request.json() with no try around it, or inside a try whose
 * catch answers 500, reports it as a server failure instead. Read the body
 * with readJsonBody (lib/api/json-body.ts), or tolerate a bad one with
 * .catch() or a try/catch that keeps defaults.
 */

/** Lines in a route file whose body read answers a malformed body with a 500. */
export function bodyReadsAnswering500(fileName: string, source: string): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "json" &&
      ts.isIdentifier(node.expression.expression) &&
      /^(request|req)$/.test(node.expression.expression.text) &&
      answers500(node, file)
    ) {
      found.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function answers500(call: ts.Node, file: ts.SourceFile): boolean {
  // .json().catch(...) and .json().then(...).catch(...) tolerate a bad body.
  for (let n = call; ts.isPropertyAccessExpression(n.parent) || ts.isCallExpression(n.parent); n = n.parent) {
    if (ts.isPropertyAccessExpression(n.parent) && n.parent.name.text === "catch") return false;
  }
  for (let n: ts.Node = call; !ts.isFunctionLike(n) && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isTryStatement(n.parent) && n.parent.tryBlock === n) {
      return /errors\.internal\(|status:\s*500/.test(n.parent.catchClause?.block.getText(file) ?? "");
    }
  }
  return true;
}

describe("route body reads", () => {
  it("never answer a malformed body with a 500", () => {
    const found = execSync("git ls-files app/api", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /route\.ts$/.test(f))
      .flatMap((file) => bodyReadsAnswering500(file, readFileSync(file, "utf8")).map((line) => `${file}:${line}`));
    expect(found, `body reads that answer a malformed body with a 500:\n${found.join("\n")}`).toEqual([]);
  }, 60_000);

  it("counts a read the route's catch-all answers, or that nothing guards", () => {
    const count = (code: string) => bodyReadsAnswering500("x.ts", `export async function POST(request: Request) {\n${code}\n}`).length;
    expect(count(`try { const body = await request.json(); return ok(body); } catch { return errors.internal("x"); }`)).toBe(1);
    expect(count(`try { const body = await request.json(); } catch (e) { return NextResponse.json({}, { status: 500 }); }`)).toBe(1);
    expect(count(`const body = await request.json();`)).toBe(1);
    expect(count(`const { body, invalidBody } = await readJsonBody(request);`)).toBe(0);
    expect(count(`const body = await request.json().catch(() => null);`)).toBe(0);
    expect(count(`const body = await request.json().then((b) => b).catch(() => null);`)).toBe(0);
    expect(count(`let body; try { body = await request.json(); } catch { return errors.badRequest("Invalid JSON"); }`)).toBe(0);
    expect(count(`try { const body = await request.json(); use(body); } catch { /* keep defaults */ }`)).toBe(0);
  });
});
