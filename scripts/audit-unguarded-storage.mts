/**
 * Which browser-storage accesses can still take a page down?
 *
 * WHY THIS EXISTS
 * ---------------
 * Sentry JAVASCRIPT-NEXTJS-28, production, Safari 26.6.2 on Mac:
 *
 *   ReferenceError: Can't find variable: localStorage
 *   components/analytics/SessionTracker.tsx:58 (trackSession)
 *   handled: no — auto.browser.global_handlers.onunhandledrejection
 *
 * Safari with "block all cookies" does not hand you an EMPTY localStorage. It
 * makes the IDENTIFIER unresolvable, so a bare `localStorage.getItem(k)` throws
 * before it can return anything. Inside an async function that becomes an
 * unhandled rejection and the page dies — which is how this reached us from
 * the login page.
 *
 * The trap is that `typeof window !== "undefined"` LOOKS like the right guard
 * and is not: `window` resolves perfectly well in that browser. Only three
 * things actually protect an access, and this script knows all three:
 *
 *   1. an enclosing try/catch;
 *   2. an enclosing `typeof localStorage !== "undefined"` test — `typeof` is
 *      the one operator that does not throw on an unresolvable name;
 *   3. a call to a local helper whose body performs (2), either enclosing the
 *      access or as an earlier `if (!isBrowser()) return` in the same function.
 *
 * Rule (3) exists because lib/consent/storage.ts was already correct via an
 * isBrowser() helper, and an audit that cannot see through one function call
 * reports it as broken. A guard script nobody trusts gets muted.
 *
 * `window.localStorage` is a property access on a resolvable object, so it
 * cannot ReferenceError and is not reported.
 *
 * Exit code 1 when anything is unprotected, so CI fails on a new one. The
 * remedy is always the same: use lib/safe-storage.ts.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["app", "components", "hooks", "lib", "contexts"];
const STORAGE = new Set(["localStorage", "sessionStorage"]);

interface Finding {
  file: string;
  line: number;
  text: string;
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      // Tests deliberately simulate blocked stores; they never ship.
      else if (/\.tsx?$/.test(e.name) && !/\.vitest\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  ROOTS.forEach(walk);
  return out;
}

/** Names of functions in this file whose body checks `typeof <storage>`. */
function guardHelpers(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    let name: string | undefined;
    let body: ts.Node | undefined;
    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
      body = node.body;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.text;
      body = node.initializer.body;
    }
    if (name && body && /typeof\s+(local|session)Storage\b/.test(body.getText(sf))) {
      names.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** Does this expression test a typeof-storage guard, directly or via a helper? */
function isGuardExpression(text: string, helpers: Set<string>): boolean {
  if (/typeof\s+(local|session)Storage\b/.test(text)) return true;
  for (const h of helpers) {
    if (new RegExp("\\b" + h + "\\s*\\(").test(text)) return true;
  }
  return false;
}

/** The nearest enclosing function body, for early-return analysis. */
function enclosingBody(node: ts.Node): ts.Block | undefined {
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n)) &&
      n.body &&
      ts.isBlock(n.body)
    ) {
      return n.body;
    }
    n = n.parent;
  }
  return undefined;
}

function auditFile(file: string): Finding[] {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helpers = guardHelpers(sf);
  const lines = src.split("\n");
  const findings: Finding[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && STORAGE.has(node.text)) {
      const parent = node.parent;
      // `window.localStorage` — a property, not a bare identifier.
      const isProperty = ts.isPropertyAccessExpression(parent) && parent.name === node;
      // `typeof localStorage` — the safe operator itself. TypeScript models
      // this as a TypeOfExpression, not a prefix-unary, so one check covers it.
      const isTypeof = ts.isTypeOfExpression(parent);
      // A property NAME in an object literal or type, not a value read.
      const isDeclarationName =
        (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) &&
        parent.name === node;

      if (!isProperty && !isTypeof && !isDeclarationName) {
        let isProtected = false;

        // (1), plus (2)/(3) as an enclosing condition.
        let n: ts.Node | undefined = node.parent;
        while (n && !isProtected) {
          if (
            ts.isTryStatement(n) &&
            n.tryBlock.pos <= node.pos &&
            node.end <= n.tryBlock.end
          ) {
            isProtected = true;
            break;
          }
          const conds: ts.Expression[] = [];
          if (ts.isIfStatement(n)) conds.push(n.expression);
          if (ts.isConditionalExpression(n)) conds.push(n.condition);
          if (
            ts.isBinaryExpression(n) &&
            n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          ) {
            conds.push(n.left);
          }
          for (const c of conds) {
            if (isGuardExpression(c.getText(sf), helpers)) isProtected = true;
          }
          n = n.parent;
        }

        // (3) as an earlier `if (!isBrowser()) return;` in the same function.
        if (!isProtected) {
          const body = enclosingBody(node);
          if (body) {
            for (const stmt of body.statements) {
              if (stmt.end > node.pos) break; // only statements BEFORE the access
              if (
                ts.isIfStatement(stmt) &&
                !stmt.elseStatement &&
                /\breturn\b|\bthrow\b/.test(stmt.thenStatement.getText(sf)) &&
                isGuardExpression(stmt.expression.getText(sf), helpers)
              ) {
                isProtected = true;
                break;
              }
            }
          }
        }

        if (!isProtected) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          findings.push({
            file: file.split(path.sep).join("/"),
            line: line + 1,
            text: (lines[line] ?? "").trim().slice(0, 100),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

const findings = sourceFiles().flatMap(auditFile);

if (findings.length === 0) {
  console.log("PASS — every browser-storage access is behind try/catch or a typeof guard.");
  process.exit(0);
}

const byFile = new Map<string, Finding[]>();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file)!.push(f);
}

console.error(
  `UNGUARDED BROWSER STORAGE — ${findings.length} access(es) in ${byFile.size} file(s)\n`
);
for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.error(`${file}  (${list.length})`);
  for (const f of list) console.error(`   :${f.line}  ${f.text}`);
}
console.error(
  '\nEach of these throws a ReferenceError in Safari with "block all cookies",' +
    "\nwhich becomes an unhandled rejection when it happens inside an async function." +
    '\n\nFIX: import { safeGet, safeSet, safeRemove } from "@/lib/safe-storage".' +
    '\nA `typeof window !== "undefined"` check is NOT a fix — window resolves fine there.'
);
process.exit(1);
