import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { generateWebPageSchema } from "./structured-data";

/**
 * The point of the WebPage date signal is that it changes ONLY when the copy
 * changes. A date derived from the build clock is worse than emitting nothing:
 * it tells Google every page on the site is rewritten daily, which teaches it
 * to discount lastmod sitewide. Repo CLAUDE.md documents this as Trap 9.
 *
 * These tests pin both halves — the generator rejects malformed input, and no
 * landing page computes its CONTENT_UPDATED at runtime.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const LANDING_DIR = path.join(repoRoot, "app", "[locale]");

/** Every page.tsx that declares a CONTENT_UPDATED constant. */
const pagesWithDates: { file: string; src: string }[] = (() => {
  const out: { file: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (entry.name === "page.tsx") {
        const src = fs.readFileSync(full, "utf8");
        if (src.includes("CONTENT_UPDATED")) {
          out.push({ file: path.relative(repoRoot, full), src });
        }
      }
    }
  };
  walk(LANDING_DIR);
  return out;
})();

describe("generateWebPageSchema", () => {
  it("emits the date and the WebSite link", () => {
    const s = generateWebPageSchema({
      name: "Free AI Trip Planner",
      url: "https://monkeytravel.app/free-ai-trip-planner",
      dateModified: "2026-08-21",
    });
    expect(s["@type"]).toBe("WebPage");
    expect(s.dateModified).toBe("2026-08-21");
    expect(s.isPartOf.url).toBe("https://monkeytravel.app");
  });

  it("omits description rather than emitting an empty one", () => {
    const s = generateWebPageSchema({
      name: "x",
      url: "https://monkeytravel.app/x",
      dateModified: "2026-08-21",
    });
    expect("description" in s).toBe(false);
  });

  it("throws on a malformed date instead of shipping invalid structured data", () => {
    for (const bad of ["21-08-2026", "2026/08/21", "2026-8-1", "", "today"]) {
      expect(
        () =>
          generateWebPageSchema({
            name: "x",
            url: "https://monkeytravel.app/x",
            dateModified: bad,
          }),
        `"${bad}" should be rejected`
      ).toThrow(/YYYY-MM-DD/);
    }
  });

  it("rejects a full ISO timestamp — day precision is the contract", () => {
    expect(() =>
      generateWebPageSchema({
        name: "x",
        url: "https://monkeytravel.app/x",
        dateModified: new Date("2026-08-21T10:00:00Z").toISOString(),
      })
    ).toThrow();
  });
});

describe("landing pages hard-code their freshness date", () => {
  it("found the pages (guards against a vacuous suite)", () => {
    expect(pagesWithDates.length).toBeGreaterThanOrEqual(10);
  });

  it("every CONTENT_UPDATED is a literal YYYY-MM-DD string", () => {
    const bad: string[] = [];
    for (const { file, src } of pagesWithDates) {
      const m = src.match(/const CONTENT_UPDATED\s*=\s*(.+?);/);
      if (!m) {
        bad.push(`${file}: no assignment found`);
        continue;
      }
      if (!/^['"]\d{4}-\d{2}-\d{2}['"]$/.test(m[1].trim())) {
        bad.push(`${file}: ${m[1].trim()}`);
      }
    }
    expect(
      bad,
      `CONTENT_UPDATED must be a literal date, never computed: ${bad.join("; ")}`
    ).toEqual([]);
  });

  it("no page derives its date from the clock", () => {
    const offenders = pagesWithDates
      .filter(({ src }) => {
        const near = src.match(/const CONTENT_UPDATED[\s\S]{0,200}/)?.[0] ?? "";
        return /new Date\(\)|Date\.now\(\)/.test(near);
      })
      .map((p) => p.file);
    expect(offenders, `build-varying date in: ${offenders.join(", ")}`).toEqual([]);
  });
});
