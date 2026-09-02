import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * messages/{es,it,pt}/trips.json must carry exactly the keys en has.
 *
 * next-intl renders a missing key as the raw key path ("wizard.step1.foo"),
 * which is what shipped in the payment-handles incident (four namespaces
 * rendered as paths in every locale but en). The wizard's step 1 gained a
 * batch of new keys in 2026-09; this guard turns a locale that missed one
 * into a red test instead of a raw string in production.
 */
const LOCALES = ["es", "it", "pt"] as const;
const FILE = "trips.json";

function keysOf(o: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (!o || typeof o !== "object" || Array.isArray(o)) return out;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const sub of keysOf(v, path)) out.add(sub);
    } else {
      out.add(path);
    }
  }
  return out;
}

function load(locale: string): Set<string> {
  const raw = readFileSync(join(process.cwd(), "messages", locale, FILE), "utf8");
  return keysOf(JSON.parse(raw));
}

describe(`messages/*/${FILE} key parity`, () => {
  const en = load("en");

  it("en is non-trivial (the guard is not vacuous)", () => {
    expect(en.size).toBeGreaterThan(100);
    expect(en.has("wizard.step1.title")).toBe(true);
  });

  for (const locale of LOCALES) {
    it(`${locale} has exactly the keys en has`, () => {
      const keys = load(locale);
      const missing = [...en].filter((k) => !keys.has(k)).sort();
      const extra = [...keys].filter((k) => !en.has(k)).sort();
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });
  }
});
