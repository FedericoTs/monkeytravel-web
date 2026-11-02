// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * A module in components/, lib/, hooks/ or types/ that nothing imports, or
 * that only its own tests import, is dead code that still has to be read,
 * typechecked and kept in step with everything around it. Delete it, or
 * import it where it is used. Resolution follows tsconfig, so @/ paths,
 * relative paths, dynamic import(), require() and vi.mock() paths all count.
 */

const isTest = (file: string) => /\.(vitest|test|spec)\.tsx?$/.test(file) || file.startsWith("tests/");

/** Importing files, keyed by the absolute, lower-cased path of the module they import. */
function importersByModule(files: string[]): Map<string, Set<string>> {
  const root = process.cwd();
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const { options } = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, root);
  const host = ts.createCompilerHost(options);
  const key = (p: string) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
  const importers = new Map<string, Set<string>>();
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
        const callee = node.expression.getText(source);
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword || /^(require|vi\.mock|vi\.doMock|vi\.importActual)$/.test(callee)) {
          specifiers.push(node.arguments[0].text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const specifier of specifiers) {
      const resolved = ts.resolveModuleName(specifier, path.resolve(file), options, host).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) continue;
      const k = key(resolved.resolvedFileName);
      if (!importers.has(k)) importers.set(k, new Set());
      importers.get(k)!.add(file);
    }
  }
  return importers;
}

describe("modules nothing uses", () => {
  it("are none: every module in components, lib, hooks and types is imported by code", () => {
    // Untracked files too, so a new module is checked before it is committed.
    const tracked = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(f) && existsSync(f));
    const importers = importersByModule(tracked);
    const unused = tracked
      .filter((f) => /^(components|lib|hooks|types)\//.test(f) && /\.tsx?$/.test(f) && !isTest(f) && !f.endsWith(".d.ts"))
      .filter((f) => {
        const by = importers.get(path.resolve(f).replace(/\\/g, "/").toLowerCase());
        return !by || [...by].every(isTest);
      });
    expect(unused, `modules nothing imports (or only their tests do):\n${unused.join("\n")}`).toEqual([]);
  }, 120_000);
});
