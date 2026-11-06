// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Gemini's kill switch and daily limit only stop what asks them. Each route that
 * can reach a Gemini client, through any chain of imports, has to reach the
 * question too, so a new route that spends on the model can't forget it.
 */

const ROOT = process.cwd();
const CLIENT = "lib/ai/genai-compat.ts";
const ASKS = /checkApiAccess\(\s*["']gemini["']/;
const IMPORTS = /(?:^|\n)\s*(import|export)\s+([^'"]*?)\s*from\s*["']([^"']+)["']|\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g;

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.vitest\.tsx?$/.test(entry.name) ? [path] : [];
  });

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const code = new Map(
  ["app", "lib", "components", "hooks"].flatMap(sourceFiles).map((file) => [file, withoutComments(readFileSync(join(ROOT, file), "utf8"))])
);

const resolved = (from: string, spec: string) => {
  const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? relative(ROOT, join(ROOT, dirname(from), spec)).replace(/\\/g, "/") : null;
  if (base === null) return undefined;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((path) => code.has(path));
};

const importsOf = (file: string) =>
  [...(code.get(file) ?? "").matchAll(IMPORTS)].flatMap((m) => {
    if (m[2]?.startsWith("type ")) return [];
    const target = resolved(file, m[3] ?? m[4]);
    return target ? [target] : [];
  });

const reachedFrom = (start: string) => {
  const seen = new Set([start]);
  const waiting = [start];
  while (waiting.length > 0) {
    for (const next of importsOf(waiting.pop()!)) {
      if (!seen.has(next)) {
        seen.add(next);
        waiting.push(next);
      }
    }
  }
  return seen;
};

const entries = [...code.keys()].filter((file) => /^app\/.*\/(route\.ts|page\.tsx|layout\.tsx)$/.test(file));
const reachesModel = entries
  .map((entry) => ({ entry, reached: reachedFrom(entry) }))
  .filter(({ reached }) => reached.has(CLIENT));

describe("Gemini's kill switch", () => {
  it("sees the routes that reach the model through other files", () => {
    const found = reachesModel.map(({ entry }) => entry);
    expect(found).toContain("app/api/ai/generate/route.ts");
    expect(found).toContain("app/api/tools/packing-list/route.ts");
    expect(found).toContain("app/api/trips/[id]/places-to-eat/route.ts");
  });

  it("is asked on the way by every route that can reach the model", () => {
    const unguarded = reachesModel
      .filter(({ reached }) => ![...reached].some((file) => ASKS.test(code.get(file) ?? "")))
      .map(({ entry }) => entry);
    expect(unguarded).toEqual([]);
  });
});
