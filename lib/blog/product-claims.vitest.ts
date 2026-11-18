import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What an article may say about MonkeyTravel's own plans. Their costs are the model's estimates, not real or current
 * prices; the plan is written without calling Google, so its places aren't "Google-verified"; what is checked after is
 * a sight's closing days and, on a saved trip, its places to eat on Google Maps. A guide's own researched prices are
 * its business: only lines that name MonkeyTravel (or "our AI") are read.
 */
const ABOUT_US = /monkeytravel|our ai|nuestr[ao] ai|la nostra ai|nossa ai/i;
const UNTRUE: Record<string, RegExp> = {
  en: /\b(actual|real)[- ]prices?\b|real pricing|current prices|prices are current|prices sourced from google|google-verified|verified venues|pulls? from google places|connects? to google places/i,
  es: /precios reales|precios actuales|verificad[oa]s (por|con) google|obtenidos de google|lugares verificados|establecimientos (reales )?verificados|extraen datos de google places|se conectan? a google places/i,
  it: /prezzi reali|prezzi attuali|prezzi effettivi|prezzi sono aggiornati|verificat[ie] (da|su) google|locali verificati|attingono da google places|si collegan[oa] a google places/i,
  pt: /preços reais|preços atuais|preços de verdade|preços são atuais|verificad[oa]s pelo google|obtidos do google|lugares verificados|locais verificados|puxam dados do google places|se conectam? ao google places/i,
};
const folder = (locale: string) => join(process.cwd(), "content", "blog", locale === "en" ? "" : locale);
const articles = (locale: string) =>
  readdirSync(folder(locale)).filter((name) => name.endsWith(".md") && !statSync(join(folder(locale), name)).isDirectory());

/** "file:line: text" for each line about us that says something untrue of the plans. */
function untrueLines(locale: string): string[] {
  return articles(locale).flatMap((name) =>
    readFileSync(join(folder(locale), name), "utf8")
      .split(/\r?\n/)
      .flatMap((line, i) => (ABOUT_US.test(line) && UNTRUE[locale].test(line) ? [`${name}:${i + 1}: ${line.slice(0, 120)}`] : []))
  );
}

describe("what the articles say about MonkeyTravel's plans", () => {
  it.each(Object.keys(UNTRUE))("is true in %s: estimated costs, places not Google-verified", (locale) => {
    expect(articles(locale).length).toBeGreaterThan(20);
    expect(untrueLines(locale)).toEqual([]);
  });

  it.each([
    ["en", "MonkeyTravel's AI creates a plan with real restaurants, actual prices, and smart routing."],
    ["en", "Dedicated planners like MonkeyTravel pull from Google Places, so the prices are current."],
    ["es", "MonkeyTravel genera itinerarios con lugares verificados por Google y precios reales."],
    ["it", "MonkeyTravel genera itinerari con locali verificati su Google e prezzi attuali."],
    ["pt", "O MonkeyTravel gera roteiros com locais verificados pelo Google e preços reais."],
  ])("would catch in %s: %s", (locale, line) => {
    expect(ABOUT_US.test(line) && UNTRUE[locale].test(line)).toBe(true);
  });

  it.each([
    ["en", "MonkeyTravel's AI creates a plan with real restaurants, cost estimates, and smart routing."],
    ["en", "This guide uses real prices as of 2026."],
    ["es", "MonkeyTravel revisa sus planes y comprueba sus restaurantes en Google Maps."],
  ])("lets through in %s: %s", (locale, line) => {
    expect(ABOUT_US.test(line) && UNTRUE[locale].test(line)).toBe(false);
  });
});
