// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A route file exports only what Next reads from it: the HTTP handlers and the
 * route segment config. Next's generated route types reject anything else, so
 * a helper exported for a test (it belongs in lib/) breaks the type check of
 * every checkout that has compiled the route in dev.
 */

const ALLOWED = new Set([
  "GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE",
  "dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime", "preferredRegion", "maxDuration",
  "generateStaticParams",
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" || name === "route.tsx" ? [path] : [];
  });
}

describe("route files", () => {
  it("export only handlers and route config", () => {
    const root = process.cwd();
    const offenders = routeFiles(join(root, "app")).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const names = [
        ...source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm),
      ].map((m) => m[1]);
      const listed = [...source.matchAll(/^export\s*\{([^}]*)\}/gm)].flatMap((m) =>
        m[1].split(",").map((part) => part.trim().split(/\s+as\s+/).pop()!).filter((n) => n && !n.startsWith("type "))
      );
      return [...names, ...listed]
        .filter((name) => !ALLOWED.has(name))
        .map((name) => `${relative(root, file).replace(/\\/g, "/")}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });
});
