import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as flags from "./flags";

/**
 * Keeps lib/posthog/flags.ts honest.
 *
 * Audited 2026-08-21: the file declared 23 flag constants and application code
 * read 3. Several carried a "Wired in: <file>" line naming a consumer that did
 * not reference the flag, so there was no way to tell a live flag from a dead
 * one by reading it. This test makes that state impossible to reach silently:
 * every constant must either have a real consumer or be declared unwired on
 * purpose.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const SEARCH_ROOTS = ["app", "components", "lib", "hooks"];
const SELF = path.join("lib", "posthog", "flags.ts");

/** Every FLAG_* constant exported from flags.ts, as [name, key] pairs. */
const FLAG_CONSTANTS = Object.entries(flags).filter(
  ([name, value]) => name.startsWith("FLAG_") && typeof value === "string"
) as [string, string][];

/** Source of every .ts/.tsx file outside flags.ts itself, keyed by path. */
function collectSources(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        const rel = path.relative(repoRoot, full);
        if (rel === SELF) continue;
        // Ignore the test files that exist to talk ABOUT flags.
        if (/\.vitest\.tsx?$/.test(entry.name)) continue;
        out.set(rel, fs.readFileSync(full, "utf8"));
      }
    }
  };
  for (const r of SEARCH_ROOTS) walk(path.join(repoRoot, r));
  return out;
}

const sources = collectSources();

/**
 * A constant counts as consumed only if code references the identifier outside
 * a comment. A flag mentioned solely in prose is documentation, not wiring —
 * that conflation is what produced the false "Wired in:" claims.
 */
function isConsumed(constName: string): boolean {
  const ident = new RegExp(`\\b${constName}\\b`);
  for (const src of sources.values()) {
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments, keeping "://"
    if (ident.test(code)) return true;
  }
  return false;
}

describe("flags.ts reflects what is actually wired", () => {
  it("finds the flag constants and the source tree", () => {
    // Guards against the whole suite passing vacuously if either side is empty.
    expect(FLAG_CONSTANTS.length).toBeGreaterThan(0);
    expect(sources.size).toBeGreaterThan(50);
  });

  it("every flag is either consumed by code or declared unwired", () => {
    const unwired = new Set(flags.UNWIRED_FLAGS);
    const undeclared = FLAG_CONSTANTS.filter(
      ([name, key]) => !isConsumed(name) && !unwired.has(key)
    ).map(([name]) => name);

    expect(
      undeclared,
      `These flags have no consumer. Either wire them up, delete them, or add them to UNWIRED_FLAGS in flags.ts: ${undeclared.join(", ")}`
    ).toEqual([]);
  });

  it("UNWIRED_FLAGS does not list a flag that is actually wired", () => {
    const stale = FLAG_CONSTANTS.filter(
      ([name, key]) => flags.UNWIRED_FLAGS.includes(key) && isConsumed(name)
    ).map(([name]) => name);

    expect(
      stale,
      `These are used in code but still listed as unwired — remove them from UNWIRED_FLAGS: ${stale.join(", ")}`
    ).toEqual([]);
  });

  it("every flag has a default, so a PostHog outage degrades predictably", () => {
    const missing = FLAG_CONSTANTS.filter(
      ([, key]) => !(key in flags.FLAG_DEFAULTS)
    ).map(([name]) => name);

    // The tombstone is exempt: it has no PostHog flag to fall back FROM.
    const expected = missing.filter((n) => n !== "FLAG_EXPLORE_UGC");
    expect(expected, `missing from FLAG_DEFAULTS: ${expected.join(", ")}`).toEqual([]);
  });
});
