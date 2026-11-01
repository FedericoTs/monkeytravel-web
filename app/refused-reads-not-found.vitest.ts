// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * `if (error || !row) return errors.notFound(...)` answers a read the database
 * refused with a 404, so a timeout reads as "this doesn't exist". Routes read
 * the row they need with requireRow (lib/api/require-row.ts), readSharedTrip
 * or verifyTripAccess, which answer 500 for a refused read and 404 only when
 * nothing is there.
 */

/** Lines where an error-or-missing check answers 404. */
export function refusedReadsAnswered404(fileName: string, source: string): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && isErrorOrMissing(node.expression) && returnsNotFound(node.thenStatement, file)) {
      found.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** `xError || !x` (or `!x || xError`), where the first name says it is an error. */
function isErrorOrMissing(e: ts.Expression): boolean {
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.BarBarToken) return false;
  const missing = (x: ts.Expression) => ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(x.operand);
  const error = (x: ts.Expression) => ts.isIdentifier(x) && /error$/i.test(x.text);
  return (error(e.left) && missing(e.right)) || (missing(e.left) && error(e.right));
}

function returnsNotFound(s: ts.Statement, file: ts.SourceFile): boolean {
  const only = ts.isBlock(s) ? (s.statements.length === 1 ? s.statements[0] : null) : s;
  return !!only && ts.isReturnStatement(only) && !!only.expression && /^errors\.notFound\(/.test(only.expression.getText(file));
}

describe("refused reads in API routes", () => {
  it("never answer 404", () => {
    const found = execSync("git ls-files app/api", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /route\.ts$/.test(f))
      .flatMap((file) => refusedReadsAnswered404(file, readFileSync(file, "utf8")).map((line) => `${file}:${line}`));
    expect(found, `error-or-missing checks that answer 404:\n${found.join("\n")}`).toEqual([]);
  }, 60_000);

  it("counts an error-or-missing check that answers 404, and not one that tells them apart", () => {
    const count = (code: string) => refusedReadsAnswered404("x.ts", `export async function GET() {\n${code}\n}`).length;
    expect(count(`if (tripError || !trip) return errors.notFound("Trip not found");`)).toBe(1);
    expect(count(`if (error || !row) { return errors.notFound("Row not found"); }`)).toBe(1);
    expect(count(`if (!row || error) return errors.notFound("Row not found");`)).toBe(1);
    expect(count(`if (tripError) return tripError;`)).toBe(0);
    expect(count(`if (error && !isNoRow(error)) return errors.internal("x"); if (!row) return errors.notFound("Row not found");`)).toBe(0);
    expect(count(`if (inviteError || !invite) { const fallback = await statusOf(token); }`)).toBe(0);
  });
});
