import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every catalog in messages/{es,it,pt}/ carries exactly the keys its en twin
 * has. next-intl renders a missing key as its raw path ("wizard.step1.foo");
 * this turns a locale that missed one into a red test instead of a raw string
 * on the page.
 */
const LOCALES = ["es", "it", "pt"] as const;
const FILES = readdirSync(join(process.cwd(), "messages", "en")).filter((f) => f.endsWith(".json"));

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

function load(locale: string, file: string): Set<string> {
  const raw = readFileSync(join(process.cwd(), "messages", locale, file), "utf8");
  return keysOf(JSON.parse(raw));
}

it("finds the catalogs (the guard is not vacuous)", () => {
  expect(FILES.length).toBeGreaterThan(15);
  expect(load("en", "trips.json").has("wizard.step1.title")).toBe(true);
});

describe.each(FILES)("messages/*/%s key parity", (file) => {
  const en = load("en", file);

  it.each(LOCALES)("%s has exactly the keys en has", (locale) => {
    const keys = load(locale, file);
    const missing = [...en].filter((k) => !keys.has(k)).sort();
    const extra = [...keys].filter((k) => !en.has(k)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});
