import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Two halves, and the second is the important one.
 *
 * The runtime filter drops DEP0169 unconditionally. That is only safe while the
 * ONLY thing calling url.parse() is a dependency — so the source scan below
 * enforces exactly that, and fails the build the moment we introduce our own
 * call. An earlier version tried to enforce it at runtime by matching the
 * emitting stack against /node_modules/@opentelemetry/; it shipped and silently
 * did nothing, because Next bundles server code and the frame is a
 * .next/server/chunks/* path. Static beats fragile-runtime here.
 *
 * Each behaviour test re-imports the module via vi.resetModules(): the install
 * guard is module-level, so without a reset only the first test would actually
 * install the wrapper and the rest would pass vacuously. (That is exactly what
 * happened on the first run of this file.)
 */

const originalEmit = process.emitWarning;

async function installFresh() {
  vi.resetModules();
  const spy = vi.fn();
  process.emitWarning = spy as typeof process.emitWarning;
  const { silenceOtelUrlParseDeprecation } = await import(
    "./silence-otel-url-parse-deprecation"
  );
  silenceOtelUrlParseDeprecation();
  return spy;
}

beforeEach(() => {
  process.emitWarning = originalEmit;
});
afterEach(() => {
  process.emitWarning = originalEmit;
});

describe("silenceOtelUrlParseDeprecation", () => {
  it("swallows DEP0169 (the string overload)", async () => {
    const spy = await installFresh();
    process.emitWarning(
      "url.parse() is deprecated",
      "DeprecationWarning",
      "DEP0169"
    );
    expect(spy, "DEP0169 should not reach the logger").not.toHaveBeenCalled();
  });

  it("swallows DEP0169 (the options-object overload)", async () => {
    const spy = await installFresh();
    process.emitWarning("url.parse() is deprecated", {
      type: "DeprecationWarning",
      code: "DEP0169",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("never touches any other warning", async () => {
    const spy = await installFresh();
    process.emitWarning("something else", "DeprecationWarning", "DEP0040");
    process.emitWarning("a plain warning");
    process.emitWarning("an experimental thing", {
      type: "ExperimentalWarning",
      code: "ExperimentalWarning",
    });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("is idempotent — repeated installs do not stack wrappers", async () => {
    vi.resetModules();
    process.emitWarning = vi.fn() as typeof process.emitWarning;
    const { silenceOtelUrlParseDeprecation } = await import(
      "./silence-otel-url-parse-deprecation"
    );
    silenceOtelUrlParseDeprecation();
    const afterFirst = process.emitWarning;
    silenceOtelUrlParseDeprecation();
    expect(process.emitWarning).toBe(afterFirst);
  });
});

/**
 * THE GUARD THAT MAKES THE BLANKET SUPPRESSION SAFE.
 *
 * If our own code ever calls url.parse(), suppressing DEP0169 would hide a
 * warning we genuinely want. Rather than trust a runtime heuristic, assert the
 * invariant against the source tree.
 */
describe("our own source must never call url.parse()", () => {
  const ROOTS = ["app", "lib", "components"];
  // `new URL()` and `fileURLToPath` are fine — only the legacy parser is not.
  const LEGACY_URL_PARSE =
    /\burl\.parse\s*\(|\bparse\s*\(\s*[^)]*\)\s*;?\s*\/\/\s*url\.parse|require\(["']url["']\)\s*\.\s*parse/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mjs|js)$/.test(p) && !/\.vitest\./.test(p)) out.push(p);
    }
    return out;
  }

  it("has no url.parse() call anywhere in app/, lib/ or components/", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const src = readFileSync(file, "utf8")
          // strip comments so prose about url.parse does not trip the scan
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        if (LEGACY_URL_PARSE.test(src)) {
          offenders.push(file.split("\\").join("/"));
        }
      }
    }
    expect(
      offenders,
      `url.parse() found in our own source. We suppress DEP0169 globally in ` +
        `lib/observability/silence-otel-url-parse-deprecation.ts, so this call ` +
        `would be silently hidden. Use the WHATWG 'new URL()' API instead, or ` +
        `narrow the suppression.`
    ).toEqual([]);
  });
});
