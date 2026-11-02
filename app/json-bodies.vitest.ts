// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * A body that must be JSON is read with readJsonBody (lib/api/json-body.ts),
 * which answers a malformed one with a 400: it is the client's mistake. A
 * route that awaits request.json() with no try around it, or inside a try
 * whose catch answers 500, reports it as a server failure; one whose catch
 * answers the 400 itself repeats the helper. A read that tolerates a bad body
 * (.catch(), or a try/catch that keeps defaults or answers 204) is fine.
 */

/** Lines in a route file that read the body by hand where readJsonBody should. */
export function handReadBodies(fileName: string, source: string): number[] {
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
      !toleratesBadBody(node, file)
    ) {
      found.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function toleratesBadBody(call: ts.Node, file: ts.SourceFile): boolean {
  // .json().catch(...) and .json().then(...).catch(...) tolerate a bad body.
  for (let n = call; ts.isPropertyAccessExpression(n.parent) || ts.isCallExpression(n.parent); n = n.parent) {
    if (ts.isPropertyAccessExpression(n.parent) && n.parent.name.text === "catch") return true;
  }
  for (let n: ts.Node = call; !ts.isFunctionLike(n) && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isTryStatement(n.parent) && n.parent.tryBlock === n) {
      return !/errors\.(internal|badRequest)\(|status:\s*(400|500)/.test(n.parent.catchClause?.block.getText(file) ?? "");
    }
  }
  return false;
}

describe("route body reads", () => {
  it("go through readJsonBody, or tolerate a bad body", () => {
    const found = execSync("git ls-files app/api", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /route\.ts$/.test(f))
      .flatMap((file) => handReadBodies(file, readFileSync(file, "utf8")).map((line) => `${file}:${line}`));
    expect(found, `body reads to move to readJsonBody:\n${found.join("\n")}`).toEqual([]);
  }, 60_000);

  it("counts a read nothing guards, or whose catch answers 500 or 400 by hand", () => {
    const count = (code: string) => handReadBodies("x.ts", `export async function POST(request: Request) {\n${code}\n}`).length;
    expect(count(`try { const body = await request.json(); return ok(body); } catch { return errors.internal("x"); }`)).toBe(1);
    expect(count(`try { const body = await request.json(); } catch (e) { return NextResponse.json({}, { status: 500 }); }`)).toBe(1);
    expect(count(`const body = await request.json();`)).toBe(1);
    expect(count(`let body; try { body = await request.json(); } catch { return errors.badRequest("Invalid JSON"); }`)).toBe(1);
    expect(count(`const { body, invalidBody } = await readJsonBody(request);`)).toBe(0);
    expect(count(`const body = await request.json().catch(() => null);`)).toBe(0);
    expect(count(`const body = await request.json().then((b) => b).catch(() => null);`)).toBe(0);
    expect(count(`try { const body = await request.json(); use(body); } catch { /* keep defaults */ }`)).toBe(0);
    expect(count(`try { body = await request.json(); } catch { return new NextResponse(null, { status: 204 }); }`)).toBe(0);
  });
});
