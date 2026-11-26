/** @vitest-environment node */
/**
 * The home page's "at a glance" facts, and the description of the app Google reads (the SoftwareApplication
 * structured data): the two say the same things, each true of the product, so a searcher or an AI answer takes the
 * same facts from either. The page is asserted against its source: it's a server page too big to render here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { routing } from "@/lib/i18n/routing-config";
import { generateSoftwareApplicationSchema } from "@/lib/seo/structured-data";

const SRC = readFileSync(join(__dirname, "page.tsx"), "utf8").replace(/\r/g, "");
const factKeys = [...SRC.matchAll(/const FACT_KEYS = \[([^\]]*)\] as const;/g)].flatMap((m) =>
  [...m[1].matchAll(/'([^']+)'/g)].map((k) => k[1]),
);
type Facts = { title: string; items: Record<string, { term: string; detail: string }> };
const facts = (locale: string): Facts =>
  JSON.parse(readFileSync(join(process.cwd(), "messages", locale, "landing.json"), "utf8")).facts;

describe("the home page's facts", () => {
  it.each([...routing.locales])("shows every fact %s has, each with its name and what's true", (locale) => {
    const { title, items } = facts(locale);
    expect(title.trim()).not.toBe("");
    expect(factKeys).toEqual(Object.keys(items));
    for (const key of factKeys) {
      expect(items[key].term.trim()).not.toBe("");
      expect(items[key].detail.trim()).not.toBe("");
    }
  });

  it("names each fact, then says it", () => {
    expect(SRC).toContain("{t(`facts.items.${key}.term`)}</dt>");
    expect(SRC).toContain("{t(`facts.items.${key}.detail`)}</dd>");
  });

  it("sits right under the numbers strip, before the page's story starts", () => {
    const facts = SRC.indexOf('<section aria-labelledby="facts-title"');
    expect(facts).toBeGreaterThan(SRC.indexOf("2. SOCIAL PROOF"));
    expect(facts).toBeLessThan(SRC.indexOf("3. PROBLEM SECTION"));
  });
});

describe("the description of the app Google reads", () => {
  const app = generateSoftwareApplicationSchema();
  const said = [app.description, ...(app.featureList ?? [])].join(" ").toLowerCase();
  const page = Object.values(facts("en").items)
    .map((item) => item.detail)
    .join(" ")
    .toLowerCase();

  it("says what the page says about price, speed, languages and the checks", () => {
    for (const fact of ["no account", "about 30 seconds", "english, spanish, italian and portuguese", "closing days and public holidays"]) {
      expect(said).toContain(fact);
      expect(page).toContain(fact);
    }
  });

  it("runs where the app runs today: in a browser", () => {
    expect(app.operatingSystem).toBe("Web browser");
  });

  it("claims nothing the product doesn't do", () => {
    for (const claim of ["verified", "real-time", "coming soon", "sync"]) expect(said).not.toContain(claim);
  });
});
